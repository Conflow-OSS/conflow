import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-api-"));
process.env.DB_PATH = join(workDir, "api.db");
process.env.EMBED_DIM = "8";
process.env.API_TOKEN = "test-token";
process.env.LOG_LEVEL = "error";

const { createApp } = await import("../src/api/app.js");
const { migrate } = await import("../src/store/migrate.js");
const { insertRun } = await import("../src/store/runs.js");
const { insertTopic } = await import("../src/store/topics.js");
const { insertPost, setStatus } = await import("../src/store/posts.js");
const { closeDb } = await import("../src/store/db.js");
const { getDb } = await import("../src/store/db.js");

migrate();
const app = createApp();
const auth = { Authorization: "Bearer test-token" };

function seedRun() {
  const run = insertRun({ flow: "matrix", config: { topics: 1 }, input_kind: "topic_list" });
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
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("health", () => {
  it("is open without a token", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: "ok" });
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
    expect(res.body.runs[0].status).toMatchObject({ ok: 1, flag_dup: 1 });
    expect(res.body.runs[0].config).toEqual({ topics: 1 });
  });

  it("returns one run with its breakdown", async () => {
    const { run } = seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.run.id).toBe(run.id);
    expect(res.body).toMatchObject({ topics: 1, posts: 2 });
    expect(res.body.approval).toMatchObject({ pending: 2 });
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
});

describe("unmatched routes", () => {
  it("404s with a json body", async () => {
    const res = await request(app).get("/v1/nonsense").set(auth);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not found" });
  });
});
