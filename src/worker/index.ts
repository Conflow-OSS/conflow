import { type Job, Worker } from "bullmq";
import { loadEnv } from "../config/load.js";
import { getRedisConnection, QUEUE_NAME } from "../queue/queue.js";
import { closeDb } from "../store/db.js";
import { migrate } from "../store/migrate.js";
import { logger } from "../util/logger.js";
import { handleJob } from "./handlers.js";

const env = loadEnv();
migrate();

// No boot-time "fail anything stuck at running" sweep here on purpose — with
// more than one worker replica, a fresh replica's sweep can't tell "abandoned
// by a dead worker" from "another live replica is genuinely still on it".
// Crash recovery is BullMQ's job: a worker that dies mid-job stops renewing
// its lock, BullMQ's stalled-job detection notices, and the job is redelivered
// (or failed after maxStalledCount) independent of which/how many replicas exist.

const worker = new Worker(QUEUE_NAME, (job: Job) => handleJob(job), {
  connection: getRedisConnection(),
  concurrency: env.WORKER_CONCURRENCY,
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

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    logger.info("worker shutting down", { signal });
    await worker.close();
    closeDb();
    process.exit(0);
  });
}
