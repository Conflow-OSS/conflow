import { Router } from "express";
import { getImageStore } from "../../cards/factory.js";
import { cardContentType } from "../../cards/imejis.js";
import { generateOneCard, imejisRenderer } from "../../cards/run.js";
import { editPost } from "../../pipeline/edit.js";
import { enqueueJob } from "../../queue/queue.js";
import { changePostApproval, getPost, listPosts, publishPost } from "../../store/posts.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../util/errors.js";
import { approvalBody, editPostBody, parseOrThrow, postListQuery } from "../validators.js";

export const postsRouter = Router();

/** Every generated post across every run — never seed posts (see `/seed-posts` for those). */
postsRouter.get("/posts", async (req, res) => {
  const { limit, offset, run_id, status, approval, includeSuperseded, includeRejected, includePublished } =
    parseOrThrow(postListQuery, req.query);
  const { posts, total } = await listPosts({
    limit,
    offset,
    runId: run_id,
    status,
    approval,
    includeSuperseded,
    includeRejected,
    includePublished,
  });
  res.json({ posts, total, limit, offset });
});

postsRouter.get("/posts/:id", async (req, res) => {
  const post = await getPost(req.params.id);
  if (!post) {
    throw new NotFoundError(`no post with id ${req.params.id}`);
  }
  res.json({ post });
});

postsRouter.put("/posts/:id/approval", async (req, res) => {
  const { approval } = parseOrThrow(approvalBody, req.body ?? {});
  const { post, warning } = await changePostApproval(req.params.id, approval);
  res.json({ post, warning });
});

postsRouter.post("/posts/:id/publish", async (req, res) => {
  const post = await publishPost(req.params.id);
  res.json({ post });
});

// Synchronous, not queued: one Voyage call + a couple of indexed dedup
// queries — bounded to a second or two, well under any proxy timeout. Only
// generate/regenerate/cards go through the worker, because those call an LLM
// or render many cards and can genuinely run for minutes.
postsRouter.patch("/posts/:id", async (req, res) => {
  const { body, summary } = parseOrThrow(editPostBody, req.body ?? {});
  const post = await editPost(req.params.id, { body, summary });
  res.json({ post });
});

postsRouter.post("/posts/:id/regenerate", async (req, res) => {
  const post = await getPost(req.params.id);
  if (!post) {
    throw new NotFoundError(`no post with id ${req.params.id}`);
  }
  if (post.status === "regenerated") {
    throw new ConflictError(`post ${req.params.id} was already replaced`);
  }
  if (post.kind !== "generated" || !post.topic_id || !post.run_id) {
    throw new BadRequestError(`post ${req.params.id} is not a regeneratable generated post`);
  }

  const { jobId } = await enqueueJob("regenerate", { postId: post.id });
  res.status(202).json({ jobId });
});

// Also synchronous — one Imejis render + one object-storage put, both fast,
// and idempotent besides (an unchanged summary reuses the cached render).
// The batch version (`POST /v1/runs/:id/cards`) stays queued: many posts,
// throttled by CARD_RENDER_DELAY_MS, genuinely slow for a big run.
postsRouter.post("/posts/:id/card", async (req, res) => {
  const post = await getPost(req.params.id);
  if (!post) {
    throw new NotFoundError(`no post with id ${req.params.id}`);
  }
  if (!post.summary) {
    throw new BadRequestError(`post ${req.params.id} has no summary to put on a card`);
  }

  await generateOneCard({ postId: post.id, renderer: imejisRenderer, store: getImageStore() });
  res.json({ post: await getPost(post.id) });
});

postsRouter.get("/posts/:id/card.png", async (req, res) => {
  const post = await getPost(req.params.id);
  if (!post) {
    throw new NotFoundError(`no post with id ${req.params.id}`);
  }
  if (!post.image_key) {
    throw new NotFoundError(`post ${req.params.id} has no card yet`);
  }

  const bytes = await getImageStore().get(post.image_key);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type(cardContentType()).send(bytes);
});
