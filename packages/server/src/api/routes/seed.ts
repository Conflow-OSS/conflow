import { Router } from "express";
import { enqueueJob } from "../../queue/queue.js";
import { parseOrThrow, seedBody } from "../validators.js";

export const seedRouter = Router();

/** Embeds the given posts as the voice-reference corpus, replacing the old one. */
seedRouter.post("/seed", async (req, res) => {
  const { posts } = parseOrThrow(seedBody, req.body ?? {});
  const { jobId } = await enqueueJob("seed", { posts });
  res.status(202).json({ jobId });
});
