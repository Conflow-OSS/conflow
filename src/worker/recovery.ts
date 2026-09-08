import { runsWithStatus, setRunStatus } from "../store/runs.js";
import { logger } from "../util/logger.js";

/**
 * A run left in `running` when the worker starts can only be a crash from a
 * previous process — nothing is processing it now (concurrency is 1). Mark it
 * failed. Any posts it already created stay in the database and are still usable.
 */
export function failOrphanedRuns(): number {
  const orphaned = runsWithStatus("running");
  for (const run of orphaned) {
    setRunStatus(run.id, "failed", "the worker restarted while this run was in progress");
    logger.warn("failed an orphaned run on worker boot", { runId: run.id });
  }
  return orphaned.length;
}
