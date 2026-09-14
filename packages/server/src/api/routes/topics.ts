import { Router } from "express";
import { listDistinctTopics } from "../../store/topics.js";
import { parseOrThrow, topicListQuery } from "../validators.js";

export const topicsRouter = Router();

/**
 * Every base topic ever used, across every run — a reviewer's "have I
 * covered this before" check, before starting a new run. `q` does a
 * substring match against the topic text. See `GET /v1/runs/:id/topics`
 * for one run's own topics instead.
 */
topicsRouter.get("/topics", async (req, res) => {
  const { limit, offset, q } = parseOrThrow(topicListQuery, req.query);
  const { topics, total } = await listDistinctTopics({ limit, offset, q });
  res.json({ topics, total, limit, offset });
});
