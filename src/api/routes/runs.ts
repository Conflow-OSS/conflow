import { Router } from "express";
import { loadEnv } from "../../config/load.js";
import { buildRunExport } from "../../export/index.js";
import { enqueueJob, subscribeToJob } from "../../queue/queue.js";
import {
  approvePendingInRun,
  countByApproval,
  countByStatus,
  listByRun,
} from "../../store/posts.js";
import { getRun, insertRun, listRuns, setRunJobId } from "../../store/runs.js";
import { listTopicsByRun } from "../../store/topics.js";
import type { InputKind, PostRow, RunRow } from "../../store/types.js";
import { NotFoundError } from "../../util/errors.js";
import {
  approveAllBody,
  cardsBatchBody,
  createRunBody,
  exportQuery,
  parseOrThrow,
  postFilterQuery,
  runListQuery,
} from "../validators.js";

export const runsRouter = Router();

/** Look the run up or fail with a 404. */
async function requireRun(id: string): Promise<RunRow> {
  const run = await getRun(id);
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

  const run = await insertRun({
    flow: body.flow,
    config: { anglesPerTopic: env.GEN_Y, postsPerAngle: env.GEN_Z, model: env.MODEL_ID },
    input_kind: inputKind,
    input_text: inputText,
    status: "queued",
  });

  const { jobId } = await enqueueJob("generate", { runId: run.id });
  await setRunJobId(run.id, jobId);

  res.status(202).json({ runId: run.id, jobId });
});

/** Post counts for a run, kept under their own key so they don't shadow `run.status`. */
async function runCounts(runId: string) {
  const [status, approval] = await Promise.all([countByStatus(runId), countByApproval(runId)]);
  return { status, approval };
}

runsRouter.get("/runs", async (req, res) => {
  const { limit, offset } = parseOrThrow(runListQuery, req.query);
  const rows = await listRuns(limit, offset);
  const runs = await Promise.all(
    rows.map(async (run) => ({ run: withParsedConfig(run), counts: await runCounts(run.id) })),
  );
  res.json({ runs });
});

runsRouter.get("/runs/:id", async (req, res) => {
  const run = await requireRun(req.params.id);
  const [counts, topics, posts] = await Promise.all([
    runCounts(run.id),
    listTopicsByRun(run.id),
    listByRun(run.id),
  ]);
  res.json({ run: withParsedConfig(run), counts, topics: topics.length, posts: posts.length });
});

runsRouter.get("/runs/:id/posts", async (req, res) => {
  const run = await requireRun(req.params.id);
  const { status, approval } = parseOrThrow(postFilterQuery, req.query);

  let posts = await listByRun(run.id);
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

runsRouter.get("/runs/:id/topics", async (req, res) => {
  const run = await requireRun(req.params.id);
  res.json({ topics: await listTopicsByRun(run.id) });
});

runsRouter.post("/runs/:id/approve-all", async (req, res) => {
  const run = await requireRun(req.params.id);
  const { includeFlagged } = parseOrThrow(approveAllBody, req.body ?? {});
  const approved = await approvePendingInRun(run.id, includeFlagged);
  res.json({ approved });
});

runsRouter.get("/runs/:id/export", async (req, res) => {
  const { format } = parseOrThrow(exportQuery, req.query);
  const payload = await buildRunExport(req.params.id, format);
  res.type(payload.contentType).send(payload.body);
});

runsRouter.post("/runs/:id/cards", async (req, res) => {
  const run = await requireRun(req.params.id);
  const { limit } = parseOrThrow(cardsBatchBody, req.body ?? {});
  const { jobId } = await enqueueJob("cards", { runId: run.id, limit });
  res.status(202).json({ jobId });
});

const HEARTBEAT_MS = 15_000;

/**
 * Live progress for the run's generation job — SSE, not polling. The DB stays
 * the source of truth: this stream is a nudge to re-fetch, not a replacement
 * for GET /runs/:id. Scoped to generation only; a card batch on this run is
 * not relayed here (poll GET /v1/jobs/:id for that) — see the M12c plan note.
 */
runsRouter.get("/runs/:id/events", async (req, res) => {
  const run = await requireRun(req.params.id);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (run.status === "completed" || run.status === "failed") {
    send(run.status, { status: run.status, error: run.error });
    res.end();
    return;
  }
  if (!run.job_id) {
    // A run created outside the API (the CLI runs synchronously, no queue job)
    // has nothing to subscribe to. Say so plainly rather than hang forever.
    send("unavailable", { reason: "no live job is tracked for this run" });
    res.end();
    return;
  }

  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  const unsubscribe = subscribeToJob(run.job_id, {
    onProgress: (progress) => send("progress", progress),
    onCompleted: (result) => {
      send("completed", result);
      cleanup();
    },
    onFailed: (reason) => {
      send("failed", { error: reason });
      cleanup();
    },
  });

  // A hard ceiling on how long this connection waits, independent of whether
  // the job's own outcome ever arrives. The heartbeat defeats idle-timeouts
  // upstream, but nothing before this bounded the connection itself — a job
  // whose worker died with nothing left running to ever notice (no worker
  // process at all means BullMQ's own stalled-job check never runs either)
  // would otherwise sit here forever: open socket, live timer, live Redis
  // listener, for a result that will never come. This ends it and tells the
  // client to fall back to a plain GET — same reconnect-and-catch-up pattern
  // as any other disconnect.
  const maxDuration = setTimeout(() => {
    send("timeout", {
      reason: "no result within the max SSE session duration — poll GET /v1/runs/:id",
    });
    cleanup();
  }, loadEnv().SSE_MAX_DURATION_MS);

  // Runs once whether it's triggered by the job settling (above), the max
  // duration elapsing, or the client disconnecting (req.on("close"), which
  // also fires as a side effect of the res.end() the other paths call — the
  // guard makes that explicit instead of relying on clearInterval/off/end
  // each happening to be safe to call twice.
  let closed = false;
  function cleanup(): void {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(maxDuration);
    unsubscribe();
    res.end();
  }

  req.on("close", cleanup);
});

function isFlagged(post: PostRow): boolean {
  return post.status === "flag_dup" || post.status === "flag_length";
}
