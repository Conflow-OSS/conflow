import { type Job, Worker } from "bullmq";
import { loadEnv } from "../config/load.js";
import { getRedisConnection, QUEUE_NAME } from "../queue/queue.js";
import { closeDb } from "../store/db.js";
import { migrate } from "../store/migrate.js";
import { logger } from "../util/logger.js";
import { handleJob } from "./handlers.js";

const env = loadEnv();
await migrate();

// No boot-time "fail anything stuck at running" sweep here on purpose — with
// more than one worker replica, a fresh replica's sweep can't tell "abandoned
// by a dead worker" from "another live replica is genuinely still on it".
// Crash recovery is BullMQ's job: a worker that dies mid-job stops renewing
// its lock, BullMQ's stalled-job detection notices, and the job is redelivered
// (or failed after maxStalledCount) independent of which/how many replicas exist.

// BullMQ's default lock (30s, renewed automatically ~every 15s) assumes a
// worker that's always responsive. Generation jobs run for many minutes, and
// on a laptop the process's own timers — including that renewal — can fall
// behind for a while (the machine sleeps, a background tab gets throttled by
// the OS, etc.), which lets the lock actually expire even though the worker
// is still alive and still working. A longer lock gives real slack against
// that without materially slowing down detection of an actually-dead worker.
const LOCK_DURATION_MS = 10 * 60 * 1000;

const worker = new Worker(QUEUE_NAME, (job: Job) => handleJob(job), {
  connection: getRedisConnection(),
  concurrency: env.WORKER_CONCURRENCY,
  lockDuration: LOCK_DURATION_MS,
});

worker.on("completed", (job) => {
  logger.info("job completed", { id: job.id, type: job.name });
});
worker.on("failed", (job, error) => {
  logger.error("job failed", { id: job?.id, type: job?.name, error: error.message });
});
worker.on("error", (error) => {
  logger.error("worker error", { error: error.message });
});

logger.info("worker started", { queue: QUEUE_NAME, concurrency: env.WORKER_CONCURRENCY });

// worker.close() waits for the active job to finish — indefinitely, by
// default. If that job is genuinely stuck (a hung fetch, the lock-renewal
// mess above, anything), Ctrl-C would otherwise never actually exit. Force it
// after a short grace period rather than hang forever.
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return; // Ctrl-C can deliver both SIGINT and SIGTERM at once
    shuttingDown = true;
    logger.info("worker shutting down", { signal });

    const forceExit = setTimeout(() => {
      logger.warn("graceful shutdown timed out — forcing exit", { graceMs: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);

    await worker.close();
    clearTimeout(forceExit);
    await closeDb();
    process.exit(0);
  });
}
