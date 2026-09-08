import { Router } from "express";
import { NotFoundError } from "../../core/errors.js";
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
