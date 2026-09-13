import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "../config/load.js";

/**
 * The queue port. Everything that enqueues or inspects a job goes through here,
 * so BullMQ can be swapped for Cloud Tasks / Pub-Sub later without touching the
 * API routes or the worker handlers.
 */

// "cards" is the only one of these three that's genuinely slow (many posts,
// throttled by CARD_RENDER_DELAY_MS) — editing a post and rendering one card
// are both fast enough to run synchronously in the API route instead.
export type JobType = "generate" | "regenerate" | "cards" | "seed";

export interface JobView {
  id: string;
  type: string;
  state: string;
  progress: unknown;
  result: unknown;
  error: string | null;
  createdAt: number | null;
  finishedAt: number | null;
}

export const QUEUE_NAME = "content-jobs";

let connection: Redis | null = null;
let queue: Queue | null = null;

/** A Redis connection configured the way BullMQ needs it. Created on first use. */
export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
): Promise<{ jobId: string }> {
  const job = await getQueue().add(type, payload, {
    removeOnComplete: { age: 60 * 60 * 24, count: 200 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  });
  return { jobId: job.id ?? "" };
}

export async function readJob(jobId: string): Promise<JobView | null> {
  const job = await getQueue().getJob(jobId);
  if (!job) return null;

  return {
    id: job.id ?? jobId,
    type: job.name,
    state: await job.getState(),
    progress: job.progress,
    result: job.returnvalue ?? null,
    error: job.failedReason || null,
    createdAt: job.timestamp ?? null,
    finishedAt: job.finishedOn ?? null,
  };
}

let queueEvents: QueueEvents | null = null;

/**
 * One shared subscriber for the whole process. BullMQ duplicates the given
 * connection internally for its own use, so this doesn't fight the Queue for
 * the same socket. Sharing it (instead of one QueueEvents per SSE connection)
 * matters once an API replica has many SSE clients open at once — one Redis
 * subscription serves all of them; each connection just adds/removes its own
 * listener, filtered to the job it cares about.
 */
function getQueueEvents(): QueueEvents {
  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queueEvents;
}

export interface JobEventHandlers {
  onProgress?: (progress: unknown) => void;
  onCompleted?: (result: unknown) => void;
  onFailed?: (reason: string) => void;
}

/**
 * Call `handlers` whenever BullMQ reports progress / completion / failure for
 * `jobId`. Returns an unsubscribe function — always call it when the caller
 * (an SSE connection) is done, or the listener leaks for the life of the process.
 */
export function subscribeToJob(jobId: string, handlers: JobEventHandlers): () => void {
  const events = getQueueEvents();

  const onProgress = ({ jobId: id, data }: { jobId: string; data: unknown }) => {
    if (id === jobId) handlers.onProgress?.(data);
  };
  const onCompleted = ({ jobId: id, returnvalue }: { jobId: string; returnvalue: unknown }) => {
    if (id === jobId) handlers.onCompleted?.(returnvalue);
  };
  const onFailed = ({ jobId: id, failedReason }: { jobId: string; failedReason: string }) => {
    if (id === jobId) handlers.onFailed?.(failedReason);
  };

  events.on("progress", onProgress);
  events.on("completed", onCompleted);
  events.on("failed", onFailed);

  return () => {
    events.off("progress", onProgress);
    events.off("completed", onCompleted);
    events.off("failed", onFailed);
  };
}

/** True if Redis answers a PING within a second. Used by the health check. */
export async function pingRedis(): Promise<boolean> {
  try {
    const pong = await Promise.race([
      getRedisConnection().ping(),
      new Promise<string>((_resolve, reject) =>
        setTimeout(() => reject(new Error("redis ping timed out")), 1000),
      ),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}
