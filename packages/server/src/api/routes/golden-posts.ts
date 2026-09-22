import { Router } from "express";
import {
  deleteGoldenPost,
  getGoldenPost,
  insertGoldenPost,
  listGoldenPosts,
  updateGoldenPost,
} from "../../store/golden-posts.js";
import { NotFoundError } from "../../util/errors.js";
import { createGoldenPostBody, parseOrThrow, updateGoldenPostBody } from "../validators.js";

export const goldenPostsRouter = Router();

goldenPostsRouter.get("/golden-posts", async (_req, res) => {
  res.json({ goldenPosts: await listGoldenPosts() });
});

goldenPostsRouter.post("/golden-posts", async (req, res) => {
  const body = parseOrThrow(createGoldenPostBody, req.body ?? {});
  const goldenPost = await insertGoldenPost({
    title: body.title,
    body: body.body,
    format: body.format,
    hook_style: body.hookStyle ?? null,
    design_template_id: body.designTemplateId ?? null,
    ideal_length_min: body.idealLengthMin,
    ideal_length_max: body.idealLengthMax,
  });
  res.status(201).json({ goldenPost });
});

goldenPostsRouter.get("/golden-posts/:id", async (req, res) => {
  const goldenPost = await getGoldenPost(req.params.id);
  if (!goldenPost) {
    throw new NotFoundError(`no golden post with id ${req.params.id}`);
  }
  res.json({ goldenPost });
});

goldenPostsRouter.patch("/golden-posts/:id", async (req, res) => {
  const body = parseOrThrow(updateGoldenPostBody, req.body ?? {});
  const goldenPost = await updateGoldenPost(req.params.id, {
    title: body.title,
    body: body.body,
    format: body.format,
    hook_style: body.hookStyle,
    design_template_id: body.designTemplateId,
    ideal_length_min: body.idealLengthMin,
    ideal_length_max: body.idealLengthMax,
  });
  res.json({ goldenPost });
});

goldenPostsRouter.delete("/golden-posts/:id", async (req, res) => {
  await deleteGoldenPost(req.params.id);
  res.status(204).end();
});
