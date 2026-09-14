import { Router } from "express";
import { addSeedPost } from "../../pipeline/seed.js";
import { deleteSeedPost, listSeedPosts } from "../../store/posts.js";
import { addSeedPostBody, parseOrThrow, seedPostListQuery } from "../validators.js";

/**
 * Individual, additive seed-post management — add or remove one at a time
 * without disturbing the rest of the corpus. Distinct from `POST /v1/seed`
 * (`seedRouter`), which wipes and replaces the whole corpus in one batch job.
 */
export const seedPostsRouter = Router();

seedPostsRouter.get("/seed-posts", async (req, res) => {
  const { limit, offset } = parseOrThrow(seedPostListQuery, req.query);
  const { posts, total } = await listSeedPosts(limit, offset);
  res.json({ posts, total, limit, offset });
});

seedPostsRouter.post("/seed-posts", async (req, res) => {
  const { body } = parseOrThrow(addSeedPostBody, req.body ?? {});
  const post = await addSeedPost(body);
  res.status(201).json({ post });
});

seedPostsRouter.delete("/seed-posts/:id", async (req, res) => {
  await deleteSeedPost(req.params.id);
  res.status(204).end();
});
