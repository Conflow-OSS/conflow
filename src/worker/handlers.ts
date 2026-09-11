import { getImageStore } from "../cards/factory.js";
import { generateCardsForRun, generateOneCard, imejisRenderer } from "../cards/run.js";
import { loadEnv } from "../config/load.js";
import { getModel } from "../models/factory.js";
import { regeneratePost } from "../pipeline/regenerate.js";
import { runGenerationForRun } from "../pipeline/run.js";
import { seedDocuments } from "../pipeline/seed.js";
import { migrate } from "../store/migrate.js";
import { getRun, setRunStatus } from "../store/runs.js";
import { NotFoundError } from "../util/errors.js";
import { logger } from "../util/logger.js";

/** The bits of a BullMQ Job the handlers actually use — kept small so tests can fake it. */
export interface JobLike {
  name: string;
  data: unknown;
  updateProgress(progress: unknown): Promise<void>;
}

export async function handleJob(job: JobLike): Promise<unknown> {
  logger.info("job started", { type: job.name });
  switch (job.name) {
    case "generate":
      return handleGenerate(job);
    case "regenerate":
      return handleRegenerate(job);
    case "cards":
      return handleCards(job);
    case "card":
      return handleCard(job);
    case "seed":
      return handleSeed(job);
    default:
      throw new Error(`unknown job type: ${job.name}`);
  }
}

async function handleGenerate(job: JobLike): Promise<unknown> {
  migrate();
  const { runId } = job.data as { runId: string };

  const run = getRun(runId);
  if (!run) {
    throw new NotFoundError(`no run with id ${runId}`);
  }

  try {
    // runGenerationForRun moves the run through running → completed / failed and
    // persists progress; we also push it onto the job for the live event stream.
    return await runGenerationForRun(run, getModel(), (progress) => job.updateProgress(progress));
  } catch (error) {
    // A failure before runGenerationForRun starts (bad model creds, say) would
    // otherwise leave the run stuck at "queued".
    setRunStatus(runId, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function handleRegenerate(job: JobLike): Promise<unknown> {
  migrate();
  const { postId } = job.data as { postId: string };
  return regeneratePost(postId, getModel());
}

async function handleCards(job: JobLike): Promise<unknown> {
  migrate();
  const { runId, limit } = job.data as { runId: string; limit?: number };
  return generateCardsForRun({
    runId,
    limit: limit ?? loadEnv().CARD_BATCH_LIMIT,
    renderer: imejisRenderer,
    store: getImageStore(),
  });
}

async function handleCard(job: JobLike): Promise<unknown> {
  migrate();
  const { postId } = job.data as { postId: string };
  return generateOneCard({ postId, renderer: imejisRenderer, store: getImageStore() });
}

async function handleSeed(job: JobLike): Promise<unknown> {
  migrate();
  const { posts } = job.data as { posts: Array<{ name: string; body: string }> };
  return seedDocuments(posts.map((post) => ({ file: post.name, body: post.body })));
}
