import { Router } from "express";
import { getImageStore } from "../../cards/factory.js";
import { cardContentType } from "../../cards/imejis.js";
import { enqueueJob } from "../../queue/queue.js";
import { changePostApproval, getPost } from "../../store/posts.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../util/errors.js";
import { approvalBody, parseOrThrow } from "../validators.js";

export const postsRouter = Router();

postsRouter.get("/posts/:id", (req, res) => {
  const post = getPost(req.params.id);
  if (!post) {
    throw new NotFoundError(`no post with id ${req.params.id}`);
  }
  res.json({ post });
});

postsRouter.put("/posts/:id/approval", (req, res) => {
  const { approval } = parseOrThrow(approvalBody, req.body ?? {});
  const { post, warning } = changePostApproval(req.params.id, approval);
  res.json({ post, warning });
});

postsRouter.post("/posts/:id/regenerate", async (req, res) => {
  const post = getPost(req.params.id);
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

postsRouter.post("/posts/:id/card", async (req, res) => {
  const post = getPost(req.params.id);
  if (!post) {
    throw new NotFoundError(`no post with id ${req.params.id}`);
  }
  if (!post.summary) {
    throw new BadRequestError(`post ${req.params.id} has no summary to put on a card`);
  }

  const { jobId } = await enqueueJob("card", { postId: post.id });
  res.status(202).json({ jobId });
});

postsRouter.get("/posts/:id/card.png", async (req, res) => {
  const post = getPost(req.params.id);
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
