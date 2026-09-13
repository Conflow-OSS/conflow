import { Router } from "express";
import { countByApproval, countByStatus } from "../../store/posts.js";
import { latestRun } from "../../store/runs.js";
import { countEmbeddings } from "../../store/vec.js";

export const statsRouter = Router();

statsRouter.get("/stats", async (_req, res) => {
  const [run, vectors] = await Promise.all([latestRun(), countEmbeddings()]);
  const latest = run
    ? {
        id: run.id,
        flow: run.flow,
        created_at: run.created_at,
        status: await countByStatus(run.id),
        approval: await countByApproval(run.id),
      }
    : null;

  res.json({ vectors, latestRun: latest });
});
