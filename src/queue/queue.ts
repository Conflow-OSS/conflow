import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "../config/load.js";

/**
 * The queue port. Everything that enqueues or inspects a job goes through here,
 * so BullMQ can be swapped for Cloud Tasks / Pub-Sub later without touching the
 * API routes or the worker handlers.
 */

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
