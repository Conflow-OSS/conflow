import { Router } from "express";
import { NotFoundError } from "../../core/errors.js";
import { buildRunExport } from "../../export/index.js";
import {
  approvePendingInRun,
  countByApproval,
  countByStatus,
  listByRun,
} from "../../store/posts.js";
import { getRun, listRuns } from "../../store/runs.js";
import { listTopicsByRun } from "../../store/topics.js";
import type { PostRow, RunRow } from "../../store/types.js";
import {
  approveAllBody,
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

runsRouter.get("/runs", (req, res) => {
  const { limit, offset } = parseOrThrow(runListQuery, req.query);
  const runs = listRuns(limit, offset).map((run) => ({
    ...withParsedConfig(run),
    status: countByStatus(run.id),
    approval: countByApproval(run.id),
  }));
  res.json({ runs });
});

runsRouter.get("/runs/:id", (req, res) => {
  const run = requireRun(req.params.id);
  res.json({
    run: withParsedConfig(run),
    status: countByStatus(run.id),
    approval: countByApproval(run.id),
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
