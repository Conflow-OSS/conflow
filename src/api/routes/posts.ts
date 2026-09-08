import { Router } from "express";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors.js";
import { enqueueJob } from "../../core/job-queue.js";
import { changePostApproval } from "../../core/posts-service.js";
import { getPost } from "../../store/posts.js";
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
