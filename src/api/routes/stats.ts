import { Router } from "express";
import { countByApproval, countByStatus } from "../../store/posts.js";
import { latestRun } from "../../store/runs.js";
import { countEmbeddings } from "../../store/vec.js";

export const statsRouter = Router();

statsRouter.get("/stats", (_req, res) => {
  const run = latestRun();
  res.json({
    vectors: countEmbeddings(),
    latestRun: run
      ? {
          id: run.id,
          flow: run.flow,
          created_at: run.created_at,
          status: countByStatus(run.id),
          approval: countByApproval(run.id),
        }
      : null,
  });
});
