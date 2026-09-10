import { NotFoundError } from "../util/errors.js";
import { getModel } from "../models/factory.js";
import { regeneratePost } from "../pipeline/regenerate.js";
import { runGenerationForRun } from "../pipeline/run.js";
import { migrate } from "../store/migrate.js";
import { getRun, setRunStatus } from "../store/runs.js";
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
