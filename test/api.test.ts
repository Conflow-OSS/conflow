import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-api-"));
process.env.DB_PATH = join(workDir, "api.db");
process.env.EMBED_DIM = "8";
process.env.API_TOKEN = "test-token";
process.env.IMAGE_STORE = "disk";
process.env.CARD_DIR = join(workDir, "cards");
process.env.SSE_MAX_DURATION_MS = "300"; // short on purpose — see the "times out" SSE test
process.env.LOG_LEVEL = "error";

const enqueueJob = vi.fn(async (type: string) => ({ jobId: `job-${type}` }));
const readJob = vi.fn(
  async (id: string): Promise<Record<string, unknown> | null> => ({
    id,
    type: "generate",
    state: "completed",
    progress: { phase: "done" },
    result: { runId: "r1" },
    error: null,
    createdAt: 1,
    finishedAt: 2,
  }),
);

interface JobEventHandlers {
  onProgress?: (progress: unknown) => void;
  onCompleted?: (result: unknown) => void;
  onFailed?: (reason: string) => void;
}
let subscribed: { jobId: string; handlers: JobEventHandlers } | null = null;
let notifySubscribed: (() => void) | null = null;
const subscribeToJob = vi.fn((jobId: string, handlers: JobEventHandlers) => {
  subscribed = { jobId, handlers };
  notifySubscribed?.();
  return vi.fn(); // unsubscribe
});
/** Resolves once the route under test has called subscribeToJob. */
function waitForSubscription(): Promise<void> {
  return new Promise((resolve) => {
    notifySubscribed = resolve;
  });
}

vi.mock("../src/queue/queue.js", () => ({
  enqueueJob: (...args: [string]) => enqueueJob(...args),
  readJob: (...args: [string]) => readJob(...args),
  subscribeToJob: (...args: [string, JobEventHandlers]) => subscribeToJob(...args),
  pingRedis: async () => true,
}));

const { createApp } = await import("../src/api/app.js");
const { migrate } = await import("../src/store/migrate.js");
const { insertRun, setRunJobId } = await import("../src/store/runs.js");
const { insertTopic } = await import("../src/store/topics.js");
const { insertPost, setStatus, setPostImage } = await import("../src/store/posts.js");
const { getRun } = await import("../src/store/runs.js");
const { closeDb } = await import("../src/store/db.js");
const { getDb } = await import("../src/store/db.js");
const { LocalDiskImageStore } = await import("../src/cards/disk-store.js");

migrate();
const app = createApp();
const auth = { Authorization: "Bearer test-token" };

function seedRun() {
  const run = insertRun({
    flow: "matrix",
    config: { topics: 1 },
    input_kind: "topic_list",
    status: "completed",
  });
  const topic = insertTopic({
    run_id: run.id,
    base_text: "incident reviews",
    base_index: 0,
    angle_text: "why blameless matters",
    angle_index: 0,
  });
  const ok = insertPost({
    kind: "generated",
    run_id: run.id,
    topic_id: topic.id,
    format: "long",
    body: "a".repeat(1000),
    summary: "one-line summary",
    status: "ok",
  });
  const flagged = insertPost({
    kind: "generated",
    run_id: run.id,
    topic_id: topic.id,
    format: "short",
    body: "b".repeat(400),
    summary: "another summary",
    status: "flag_dup",
  });
  return { run, topic, ok, flagged };
}

beforeEach(() => {
  getDb().exec("DELETE FROM posts; DELETE FROM topics; DELETE FROM runs; DELETE FROM vec_posts;");
  enqueueJob.mockClear();
  readJob.mockClear();
  subscribeToJob.mockClear();
  subscribed = null;
  notifySubscribed = null;
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("health", () => {
  it("is open without a token", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: "ok", redis: "ok" });
  });
});

describe("auth", () => {
  it("rejects a missing token", async () => {
    expect((await request(app).get("/v1/stats")).status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const res = await request(app).get("/v1/stats").set({ Authorization: "Bearer nope" });
    expect(res.status).toBe(401);
  });

  it("accepts the right token", async () => {
    expect((await request(app).get("/v1/stats").set(auth)).status).toBe(200);
  });
});

describe("runs", () => {
  it("lists runs newest first with counts", async () => {
    seedRun();
    const res = await request(app).get("/v1/runs").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].run.status).toBe("completed");
    expect(res.body.runs[0].counts.status).toMatchObject({ ok: 1, flag_dup: 1 });
    expect(res.body.runs[0].run.config).toEqual({ topics: 1 });
  });

  it("returns one run with its breakdown", async () => {
    const { run } = seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.run.id).toBe(run.id);
    expect(res.body).toMatchObject({ topics: 1, posts: 2 });
    expect(res.body.counts.approval).toMatchObject({ pending: 2 });
  });

  it("404s an unknown run", async () => {
    const res = await request(app).get("/v1/runs/nope").set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no run/);
  });

  it("filters posts by status=flagged", async () => {
    const { run, flagged } = seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/posts?status=flagged`).set(auth);
    expect(res.body.posts.map((p: { id: string }) => p.id)).toEqual([flagged.id]);
  });

  it("filters posts by approval", async () => {
    const { run, ok } = seedRun();
    await request(app).put(`/v1/posts/${ok.id}/approval`).set(auth).send({ approval: "approved" });
    const res = await request(app).get(`/v1/runs/${run.id}/posts?approval=approved`).set(auth);
    expect(res.body.posts.map((p: { id: string }) => p.id)).toEqual([ok.id]);
  });

  it("rejects a bad status filter with 400", async () => {
    const { run } = seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/posts?status=weird`).set(auth);
    expect(res.status).toBe(400);
  });

  it("lists topics", async () => {
    const { run } = seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/topics`).set(auth);
    expect(res.body.topics).toHaveLength(1);
    expect(res.body.topics[0].angle_text).toBe("why blameless matters");
  });

  it("approve-all approves pending ok posts, skipping flagged by default", async () => {
    const { run } = seedRun();
    const res = await request(app).post(`/v1/runs/${run.id}/approve-all`).set(auth).send({});
    expect(res.body).toEqual({ approved: 1 });
  });

  it("approve-all --include-flagged approves the flagged one too", async () => {
    const { run } = seedRun();
    const res = await request(app)
      .post(`/v1/runs/${run.id}/approve-all`)
      .set(auth)
      .send({ includeFlagged: true });
    expect(res.body).toEqual({ approved: 2 });
  });

  it("exports a run as json", async () => {
    const { run } = seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/export?format=json`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.run.id).toBe(run.id);
    expect(res.body.posts).toHaveLength(2);
  });

  it("exports a run as markdown", async () => {
    const { run } = seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/export?format=md`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/markdown/);
    expect(res.text).toContain(`# Run ${run.id}`);
  });
});

describe("posts", () => {
  it("returns one post", async () => {
    const { ok } = seedRun();
    const res = await request(app).get(`/v1/posts/${ok.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.post.id).toBe(ok.id);
  });

  it("404s an unknown post", async () => {
    expect((await request(app).get("/v1/posts/nope").set(auth)).status).toBe(404);
  });

  it("approves a post", async () => {
    const { ok } = seedRun();
    const res = await request(app)
      .put(`/v1/posts/${ok.id}/approval`)
      .set(auth)
      .send({ approval: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.post.approval).toBe("approved");
    expect(res.body.post.approved_at).not.toBeNull();
    expect(res.body.warning).toBeUndefined();
  });

  it("approving a flagged post succeeds but reports a warning", async () => {
    const { flagged } = seedRun();
    const res = await request(app)
      .put(`/v1/posts/${flagged.id}/approval`)
      .set(auth)
      .send({ approval: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/flag_dup/);
  });

  it("409s approving a regenerated post", async () => {
    const { ok } = seedRun();
    setStatus(ok.id, "regenerated");
    const res = await request(app)
      .put(`/v1/posts/${ok.id}/approval`)
      .set(auth)
      .send({ approval: "approved" });
    expect(res.status).toBe(409);
  });

  it("400s an invalid approval value", async () => {
    const { ok } = seedRun();
    const res = await request(app)
      .put(`/v1/posts/${ok.id}/approval`)
      .set(auth)
      .send({ approval: "maybe" });
    expect(res.status).toBe(400);
  });

  it("queues a regenerate job for a generated post", async () => {
    const { flagged } = seedRun();
    const res = await request(app).post(`/v1/posts/${flagged.id}/regenerate`).set(auth);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe("job-regenerate");
    expect(enqueueJob).toHaveBeenCalledWith("regenerate", { postId: flagged.id });
  });

  it("409s regenerating an already-replaced post", async () => {
    const { ok } = seedRun();
    setStatus(ok.id, "regenerated");
    const res = await request(app).post(`/v1/posts/${ok.id}/regenerate`).set(auth);
    expect(res.status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("queues a card render for a post with a summary", async () => {
    const { ok } = seedRun();
    const res = await request(app).post(`/v1/posts/${ok.id}/card`).set(auth);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe("job-card");
    expect(enqueueJob).toHaveBeenCalledWith("card", { postId: ok.id });
  });

  it("400s a card render for a post with no summary", async () => {
    const run = insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const post = insertPost({
      kind: "generated",
      run_id: run.id,
      format: "long",
      body: "a".repeat(1000),
      summary: null,
      status: "ok",
    });
    const res = await request(app).post(`/v1/posts/${post.id}/card`).set(auth);
    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("serves the card image from the store", async () => {
    const { ok } = seedRun();
    const stored = await new LocalDiskImageStore().put(
      "cards/test.png",
      Buffer.from("fake-png-bytes"),
      "image/png",
    );
    setPostImage(ok.id, stored);

    const res = await request(app).get(`/v1/posts/${ok.id}/card.png`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(res.body).toEqual(Buffer.from("fake-png-bytes"));
  });

  it("404s the card image when the post has none yet", async () => {
    const { ok } = seedRun();
    const res = await request(app).get(`/v1/posts/${ok.id}/card.png`).set(auth);
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/runs/:id/cards", () => {
  it("queues a card batch for the run", async () => {
    const { run } = seedRun();
    const res = await request(app).post(`/v1/runs/${run.id}/cards`).set(auth).send({ limit: 5 });
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe("job-cards");
    expect(enqueueJob).toHaveBeenCalledWith("cards", { runId: run.id, limit: 5 });
  });

  it("404s for an unknown run", async () => {
    const res = await request(app).post("/v1/runs/nope/cards").set(auth).send({});
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/seed", () => {
  it("queues a seed job with the given posts", async () => {
    const res = await request(app)
      .post("/v1/seed")
      .set(auth)
      .send({ posts: [{ name: "one.md", body: "a post" }] });
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe("job-seed");
    expect(enqueueJob).toHaveBeenCalledWith("seed", {
      posts: [{ name: "one.md", body: "a post" }],
    });
  });

  it("400s an empty posts list", async () => {
    const res = await request(app).post("/v1/seed").set(auth).send({ posts: [] });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/runs/:id/events", () => {
  it("404s an unknown run", async () => {
    const res = await request(app).get("/v1/runs/nope/events").set(auth);
    expect(res.status).toBe(404);
  });

  it("sends a terminal event immediately for an already-finished run, no subscription", async () => {
    const { run } = seedRun(); // seedRun() creates status: "completed"
    const res = await request(app).get(`/v1/runs/${run.id}/events`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("event: completed");
    expect(subscribeToJob).not.toHaveBeenCalled();
  });

  it("reports 'unavailable' for a running CLI-created run with no job_id", async () => {
    const run = insertRun({
      flow: "matrix",
      config: {},
      input_kind: "topic_list",
      status: "running",
    });
    const res = await request(app).get(`/v1/runs/${run.id}/events`).set(auth);
    expect(res.text).toContain("event: unavailable");
    expect(subscribeToJob).not.toHaveBeenCalled();
  });

  it("relays progress then completion from the subscribed job, and closes", async () => {
    const run = insertRun({
      flow: "matrix",
      config: {},
      input_kind: "topic_list",
      status: "running",
    });
    setRunJobId(run.id, "job-xyz");

    // supertest/superagent doesn't dispatch until .end()/.then() — call .end()
    // explicitly so the request is actually in flight before we wait on it,
    // since we need the server to reach subscribeToJob() before we drive it.
    const reqPromise = new Promise<request.Response>((resolve, reject) => {
      request(app)
        .get(`/v1/runs/${run.id}/events`)
        .set(auth)
        .end((err, res) => (err ? reject(err) : resolve(res)));
    });

    await waitForSubscription();
    expect(subscribed?.jobId).toBe("job-xyz");

    subscribed!.handlers.onProgress?.({ phase: "generating", postsCreated: 1, postsExpected: 4 });
    subscribed!.handlers.onCompleted?.({ postsCreated: 4 });

    const res = await reqPromise;
    expect(res.status).toBe(200);
    expect(res.text).toContain("event: progress");
    expect(res.text).toContain("event: completed");
  });

  it("times out and closes when the job never settles (SSE_MAX_DURATION_MS=300 in this suite)", async () => {
    const run = insertRun({
      flow: "matrix",
      config: {},
      input_kind: "topic_list",
      status: "running",
    });
    setRunJobId(run.id, "job-stuck");

    const res = await new Promise<request.Response>((resolve, reject) => {
      request(app)
        .get(`/v1/runs/${run.id}/events`)
        .set(auth)
        .end((err, r) => (err ? reject(err) : resolve(r)));
    });

    // No handler was ever invoked — the connection had to close on its own.
    expect(res.status).toBe(200);
    expect(res.text).toContain("event: timeout");
  });
});

describe("POST /v1/runs", () => {
  it("queues a topic-list run and returns 202 with the ids", async () => {
    const res = await request(app)
      .post("/v1/runs")
      .set(auth)
      .send({ flow: "matrix", input: { kind: "topics", topics: ["a", "b"] } });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe("job-generate");
    expect(enqueueJob).toHaveBeenCalledWith("generate", { runId: res.body.runId });

    const run = getRun(res.body.runId)!;
    expect(run.status).toBe("queued");
    expect(run.job_id).toBe("job-generate");
    expect(run.input_kind).toBe("topic_list");
    expect(run.input_text).toBe("a\nb");
  });

  it("queues a grounded case-study run from a story", async () => {
    const res = await request(app)
      .post("/v1/runs")
      .set(auth)
      .send({ flow: "casestudy", input: { kind: "story", text: "the whole story" } });
    expect(res.status).toBe(202);
    expect(getRun(res.body.runId)!.flow).toBe("casestudy");
  });

  it("400s a case-study run given a topic list", async () => {
    const res = await request(app)
      .post("/v1/runs")
      .set(auth)
      .send({ flow: "casestudy", input: { kind: "topics", topics: ["a"] } });
    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("400s an empty topic list", async () => {
    const res = await request(app)
      .post("/v1/runs")
      .set(auth)
      .send({ flow: "matrix", input: { kind: "topics", topics: [] } });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/jobs/:id", () => {
  it("returns the job view", async () => {
    const res = await request(app).get("/v1/jobs/abc").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ id: "abc", state: "completed" });
  });

  it("404s when the queue has no such job", async () => {
    readJob.mockResolvedValueOnce(null);
    const res = await request(app).get("/v1/jobs/gone").set(auth);
    expect(res.status).toBe(404);
  });
});

describe("unmatched routes", () => {
  it("404s with a json body", async () => {
    const res = await request(app).get("/v1/nonsense").set(auth);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not found" });
  });
});
