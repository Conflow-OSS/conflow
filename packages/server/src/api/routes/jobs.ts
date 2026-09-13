import { Router } from "express";
import { NotFoundError } from "../../util/errors.js";
import { readJob } from "../../queue/queue.js";

export const jobsRouter = Router();

jobsRouter.get("/jobs/:id", async (req, res) => {
  const job = await readJob(req.params.id);
  if (!job) {
    throw new NotFoundError(`no job with id ${req.params.id}`);
  }
  res.json({ job });
});
