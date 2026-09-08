import { Router } from "express";
import { loadEnv } from "../../config/load.js";
import { NotFoundError } from "../../core/errors.js";
import { enqueueJob } from "../../core/job-queue.js";
import { buildRunExport } from "../../export/index.js";
import {
  approvePendingInRun,
  countByApproval,
  countByStatus,
  listByRun,
} from "../../store/posts.js";
import { getRun, insertRun, listRuns, setRunJobId } from "../../store/runs.js";
import { listTopicsByRun } from "../../store/topics.js";
import type { InputKind, PostRow, RunRow } from "../../store/types.js";
import {
  approveAllBody,
  createRunBody,
  exportQuery,
  parseOrThrow,
  postFilterQuery,
  runListQuery,
} from "../validators.js";

export const runsRouter = Router();

/** Look the run up or fail with a 404. */
function requireRun(id: string): RunRow {
  const run = getRun(id);
  if (!run) {
    throw new NotFoundError(`no run with id ${id}`);
  }
  return run;
}

function withParsedConfig(run: RunRow) {
  let config: unknown = run.config_json;
  try {
    config = JSON.parse(run.config_json);
  } catch {
    // leave it as the raw string
  }
  return { ...run, config };
}

runsRouter.post("/runs", async (req, res) => {
  const env = loadEnv();
  const body = parseOrThrow(createRunBody, req.body ?? {});

  const inputKind: InputKind = body.input.kind === "topics" ? "topic_list" : "story";
  const inputText =
    body.input.kind === "topics" ? body.input.topics.join("\n") : body.input.text;

  const run = insertRun({
    flow: body.flow,
    config: { anglesPerTopic: env.GEN_Y, postsPerAngle: env.GEN_Z, model: env.MODEL_ID },
    input_kind: inputKind,
    input_text: inputText,
    status: "queued",
  });

  const { jobId } = await enqueueJob("generate", { runId: run.id });
  setRunJobId(run.id, jobId);

  res.status(202).json({ runId: run.id, jobId });
});

/** Post counts for a run, kept under their own key so they don't shadow `run.status`. */
function runCounts(runId: string) {
  return { status: countByStatus(runId), approval: countByApproval(runId) };
}

runsRouter.get("/runs", (req, res) => {
  const { limit, offset } = parseOrThrow(runListQuery, req.query);
  const runs = listRuns(limit, offset).map((run) => ({
    run: withParsedConfig(run),
    counts: runCounts(run.id),
  }));
  res.json({ runs });
});

runsRouter.get("/runs/:id", (req, res) => {
  const run = requireRun(req.params.id);
  res.json({
    run: withParsedConfig(run),
    counts: runCounts(run.id),
    topics: listTopicsByRun(run.id).length,
    posts: listByRun(run.id).length,
  });
});

runsRouter.get("/runs/:id/posts", (req, res) => {
  const run = requireRun(req.params.id);
  const { status, approval } = parseOrThrow(postFilterQuery, req.query);

  let posts = listByRun(run.id);
  if (status === "ok") {
    posts = posts.filter((post) => post.status === "ok");
  } else if (status === "flagged") {
    posts = posts.filter(isFlagged);
  }
  if (approval) {
    posts = posts.filter((post) => post.approval === approval);
  }
  res.json({ posts });
});

runsRouter.get("/runs/:id/topics", (req, res) => {
  const run = requireRun(req.params.id);
  res.json({ topics: listTopicsByRun(run.id) });
});

runsRouter.post("/runs/:id/approve-all", (req, res) => {
  const run = requireRun(req.params.id);
  const { includeFlagged } = parseOrThrow(approveAllBody, req.body ?? {});
  const approved = approvePendingInRun(run.id, includeFlagged);
  res.json({ approved });
});

runsRouter.get("/runs/:id/export", (req, res) => {
  const { format } = parseOrThrow(exportQuery, req.query);
  const payload = buildRunExport(req.params.id, format);
  res.type(payload.contentType).send(payload.body);
});

function isFlagged(post: PostRow): boolean {
  return post.status === "flag_dup" || post.status === "flag_length";
}
