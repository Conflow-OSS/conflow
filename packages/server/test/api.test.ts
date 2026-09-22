import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

useTestDatabase();
const cardDir = mkdtempSync(join(tmpdir(), "content-engine-api-cards-"));
process.env.API_TOKEN = "test-token";
process.env.IMAGE_STORE = "disk";
process.env.CARD_DIR = cardDir;
process.env.SSE_MAX_DURATION_MS = "300"; // short on purpose — see the "times out" SSE test
process.env.EMBED_DIM = "16"; // matches fake-embeddings.ts, shared with every other DB-backed test file
process.env.VOYAGE_API_KEY = "test-key"; // embedDocuments is mocked below, but addSeedPost still checks this is set
process.env.LOG_LEVEL = "error";

vi.mock("../src/embeddings/voyage.js", async () => {
  const { textToVector } = await import("./support/fake-embeddings.js");
  return {
    embedDocuments: async (texts: string[]) => texts.map(textToVector),
    embedQuery: async (text: string) => textToVector(text),
  };
});

vi.mock("../src/cards/imejis.js", () => ({
  renderCard: async (summary: string) => Buffer.from(`png:${summary}`),
  cardContentType: () => "image/png",
}));

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
const { loadEnv } = await import("../src/config/load.js");
const { migrate } = await import("../src/store/migrate.js");
const { insertRun, setRunJobId } = await import("../src/store/runs.js");
const { insertTopic } = await import("../src/store/topics.js");
const { insertPost, setStatus, setPostImage } = await import("../src/store/posts.js");
const { getRun } = await import("../src/store/runs.js");
const { insertGoldenPost } = await import("../src/store/golden-posts.js");
const { insertDesignTemplate } = await import("../src/store/design-templates.js");
const { closeDb } = await import("../src/store/db.js");
const { LocalDiskImageStore } = await import("../src/cards/disk-store.js");

/** A golden post with a design template assigned — for posts that need a card. */
async function cardReadyGoldenPostId(): Promise<string> {
  const designTemplate = await insertDesignTemplate({
    name: "Default",
    imejis_design_id: "designX",
    preview_image_url: "https://cdn.example/preview.png",
    preview_image_key: "design-templates/preview.png",
  });
  const goldenPost = await insertGoldenPost({
    body: "a golden post",
    format: "long",
    hook_style: "questions",
    design_template_id: designTemplate.id,
  });
  return goldenPost.id;
}

await migrate();
const app = await createApp();
const auth = { Authorization: "Bearer test-token" };

async function seedRun() {
  const run = await insertRun({
    flow: "matrix",
    config: { topics: 1 },
    input_kind: "topic_list",
    status: "completed",
  });
  const topic = await insertTopic({
    run_id: run.id,
    base_text: "incident reviews",
    base_index: 0,
    angle_text: "why blameless matters",
    angle_index: 0,
  });
  const ok = await insertPost({
    kind: "generated",
    run_id: run.id,
    topic_id: topic.id,
    format: "long",
    body: "a".repeat(1000),
    summary: "one-line summary",
    status: "ok",
    golden_post_id: await cardReadyGoldenPostId(),
  });
  const flagged = await insertPost({
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

beforeEach(async () => {
  await resetTestTables();
  enqueueJob.mockClear();
  readJob.mockClear();
  subscribeToJob.mockClear();
  subscribed = null;
  notifySubscribed = null;
});

afterAll(async () => {
  await closeDb();
  rmSync(cardDir, { recursive: true, force: true });
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
    await seedRun();
    const res = await request(app).get("/v1/runs").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].run.status).toBe("completed");
    expect(res.body.runs[0].counts.status).toMatchObject({ ok: 1, flag_dup: 1 });
    expect(res.body.runs[0].run.config).toEqual({ topics: 1 });
  });

  it("returns one run with its breakdown", async () => {
    const { run } = await seedRun();
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
    const { run, flagged } = await seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/posts?status=flagged`).set(auth);
    expect(res.body.posts.map((p: { id: string }) => p.id)).toEqual([flagged.id]);
  });

  it("filters posts by approval", async () => {
    const { run, ok } = await seedRun();
    await request(app).put(`/v1/posts/${ok.id}/approval`).set(auth).send({ approval: "approved" });
    const res = await request(app).get(`/v1/runs/${run.id}/posts?approval=approved`).set(auth);
    expect(res.body.posts.map((p: { id: string }) => p.id)).toEqual([ok.id]);
  });

  it("rejects a bad status filter with 400", async () => {
    const { run } = await seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/posts?status=weird`).set(auth);
    expect(res.status).toBe(400);
  });

  it("hides rejected posts by default, shows them with includeRejected=true", async () => {
    const { run, ok, flagged } = await seedRun();
    await request(app).put(`/v1/posts/${flagged.id}/approval`).set(auth).send({ approval: "rejected" });

    const hidden = await request(app).get(`/v1/runs/${run.id}/posts`).set(auth);
    expect(hidden.body.posts.map((p: { id: string }) => p.id)).toEqual([ok.id]);

    const shown = await request(app).get(`/v1/runs/${run.id}/posts?includeRejected=true`).set(auth);
    expect(shown.body.posts.map((p: { id: string }) => p.id).sort()).toEqual([flagged.id, ok.id].sort());

    // An explicit approval=rejected filter wins regardless of includeRejected.
    const explicit = await request(app).get(`/v1/runs/${run.id}/posts?approval=rejected`).set(auth);
    expect(explicit.body.posts.map((p: { id: string }) => p.id)).toEqual([flagged.id]);
  });

  it("hides published posts by default, shows them with includePublished=true", async () => {
    const { run, ok, flagged } = await seedRun();
    await request(app).put(`/v1/posts/${ok.id}/approval`).set(auth).send({ approval: "approved" });
    await request(app).post(`/v1/posts/${ok.id}/publish`).set(auth);

    const hidden = await request(app).get(`/v1/runs/${run.id}/posts`).set(auth);
    expect(hidden.body.posts.map((p: { id: string }) => p.id)).toEqual([flagged.id]);

    const shown = await request(app).get(`/v1/runs/${run.id}/posts?includePublished=true`).set(auth);
    expect(shown.body.posts.map((p: { id: string }) => p.id).sort()).toEqual([flagged.id, ok.id].sort());
  });

  it("lists topics", async () => {
    const { run } = await seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/topics`).set(auth);
    expect(res.body.topics).toHaveLength(1);
    expect(res.body.topics[0].angle_text).toBe("why blameless matters");
  });

  it("approve-all approves pending ok posts, skipping flagged by default", async () => {
    const { run } = await seedRun();
    const res = await request(app).post(`/v1/runs/${run.id}/approve-all`).set(auth).send({});
    expect(res.body).toEqual({ approved: 1 });
  });

  it("approve-all --include-flagged approves the flagged one too", async () => {
    const { run } = await seedRun();
    const res = await request(app)
      .post(`/v1/runs/${run.id}/approve-all`)
      .set(auth)
      .send({ includeFlagged: true });
    expect(res.body).toEqual({ approved: 2 });
  });

  it("exports a run as json", async () => {
    const { run } = await seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/export?format=json`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.run.id).toBe(run.id);
    expect(res.body.posts).toHaveLength(2);
  });

  it("exports a run as markdown", async () => {
    const { run } = await seedRun();
    const res = await request(app).get(`/v1/runs/${run.id}/export?format=md`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/markdown/);
    expect(res.text).toContain(`# Run ${run.id}`);
  });
});

describe("GET /v1/posts", () => {
  it("lists across runs, paginated, excluding seed posts", async () => {
    await seedRun(); // 2 generated posts
    await insertPost({ kind: "seed", format: "long", body: "z".repeat(1000) });

    const res = await request(app).get("/v1/posts?limit=1&offset=0").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0].kind).toBe("generated");
  });

  it("filters by run_id", async () => {
    const { run } = await seedRun();
    const otherRun = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    await insertPost({ kind: "generated", run_id: otherRun.id, format: "long", body: "a".repeat(1000) });

    const res = await request(app).get(`/v1/posts?run_id=${run.id}`).set(auth);
    expect(res.body.posts.every((p: { run_id: string }) => p.run_id === run.id)).toBe(true);
  });

  it("excludes published posts unless includePublished is set", async () => {
    const { ok } = await seedRun(); // ok + flagged, 2 generated posts
    await request(app).put(`/v1/posts/${ok.id}/approval`).set(auth).send({ approval: "approved" });
    await request(app).post(`/v1/posts/${ok.id}/publish`).set(auth);

    const hidden = await request(app).get("/v1/posts").set(auth);
    expect(hidden.body.posts.some((p: { id: string }) => p.id === ok.id)).toBe(false);

    const shown = await request(app).get("/v1/posts?includePublished=true").set(auth);
    expect(shown.body.posts.some((p: { id: string }) => p.id === ok.id)).toBe(true);
  });
});

describe("posts", () => {
  it("returns one post", async () => {
    const { ok } = await seedRun();
    const res = await request(app).get(`/v1/posts/${ok.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.post.id).toBe(ok.id);
  });

  it("404s an unknown post", async () => {
    expect((await request(app).get("/v1/posts/nope").set(auth)).status).toBe(404);
  });

  it("approves a post", async () => {
    const { ok } = await seedRun();
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
    const { flagged } = await seedRun();
    const res = await request(app)
      .put(`/v1/posts/${flagged.id}/approval`)
      .set(auth)
      .send({ approval: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/flag_dup/);
  });

  it("409s approving a regenerated post", async () => {
    const { ok } = await seedRun();
    await setStatus(ok.id, "regenerated");
    const res = await request(app)
      .put(`/v1/posts/${ok.id}/approval`)
      .set(auth)
      .send({ approval: "approved" });
    expect(res.status).toBe(409);
  });

  it("400s an invalid approval value", async () => {
    const { ok } = await seedRun();
    const res = await request(app)
      .put(`/v1/posts/${ok.id}/approval`)
      .set(auth)
      .send({ approval: "maybe" });
    expect(res.status).toBe(400);
  });

  it("queues a regenerate job for a generated post", async () => {
    const { flagged } = await seedRun();
    const res = await request(app).post(`/v1/posts/${flagged.id}/regenerate`).set(auth);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe("job-regenerate");
    expect(enqueueJob).toHaveBeenCalledWith("regenerate", { postId: flagged.id });
  });

  it("409s regenerating an already-replaced post", async () => {
    const { ok } = await seedRun();
    await setStatus(ok.id, "regenerated");
    const res = await request(app).post(`/v1/posts/${ok.id}/regenerate`).set(auth);
    expect(res.status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("edits a post synchronously — no job involved", async () => {
    const { ok } = await seedRun();
    const res = await request(app)
      .patch(`/v1/posts/${ok.id}`)
      .set(auth)
      .send({ body: "b".repeat(1000), summary: "new summary" });
    expect(res.status).toBe(200);
    expect(res.body.post.body).toBe("b".repeat(1000));
    expect(res.body.post.summary).toBe("new summary");
    expect(res.body.post.approval).toBe("pending");
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("400s an edit with neither body nor summary", async () => {
    const { ok } = await seedRun();
    const res = await request(app).patch(`/v1/posts/${ok.id}`).set(auth).send({});
    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("publishes an approved post", async () => {
    const { ok } = await seedRun();
    await request(app).put(`/v1/posts/${ok.id}/approval`).set(auth).send({ approval: "approved" });

    const res = await request(app).post(`/v1/posts/${ok.id}/publish`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.post.published_at).not.toBeNull();
  });

  it("409s publishing a post that isn't approved", async () => {
    const { ok } = await seedRun();
    const res = await request(app).post(`/v1/posts/${ok.id}/publish`).set(auth);
    expect(res.status).toBe(409);
  });

  it("renders a card synchronously — no job involved", async () => {
    const { ok } = await seedRun();
    const res = await request(app).post(`/v1/posts/${ok.id}/card`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.post.image_url).toContain("file://");
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("400s a card render for a post with no summary", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const post = await insertPost({
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
    const { ok } = await seedRun();
    const stored = await new LocalDiskImageStore().put(
      "cards/test.png",
      Buffer.from("fake-png-bytes"),
      "image/png",
    );
    await setPostImage(ok.id, stored);

    const res = await request(app).get(`/v1/posts/${ok.id}/card.png`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(res.body).toEqual(Buffer.from("fake-png-bytes"));
  });

  it("404s the card image when the post has none yet", async () => {
    const { ok } = await seedRun();
    const res = await request(app).get(`/v1/posts/${ok.id}/card.png`).set(auth);
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/topics", () => {
  it("groups by base topic across runs, for the reuse-check use case", async () => {
    const runA = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const runB = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    await insertTopic({
      run_id: runA.id,
      base_text: "zz-api-unique incident reviews",
      base_index: 0,
      angle_text: "blameless culture",
      angle_index: 0,
    });
    await insertTopic({
      run_id: runB.id,
      base_text: "zz-api-unique incident reviews",
      base_index: 0,
      angle_text: "postmortem timing",
      angle_index: 0,
    });

    const res = await request(app).get("/v1/topics?q=zz-api-unique incident").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.topics[0].run_ids.sort()).toEqual([runA.id, runB.id].sort());
    expect(res.body.topics[0].angles.sort()).toEqual(["blameless culture", "postmortem timing"]);
  });
});

describe("seed-posts", () => {
  it("adds one seed post without touching existing ones, then lists it", async () => {
    const first = await request(app).post("/v1/seed-posts").set(auth).send({ body: "a".repeat(50) });
    expect(first.status).toBe(201);
    expect(first.body.post.kind).toBe("seed");

    const second = await request(app).post("/v1/seed-posts").set(auth).send({ body: "b".repeat(50) });
    expect(second.status).toBe(201);

    const list = await request(app).get("/v1/seed-posts").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
  });

  it("400s an add with no body", async () => {
    const res = await request(app).post("/v1/seed-posts").set(auth).send({});
    expect(res.status).toBe(400);
  });

  it("deletes a seed post", async () => {
    const added = await request(app).post("/v1/seed-posts").set(auth).send({ body: "c".repeat(50) });
    const del = await request(app).delete(`/v1/seed-posts/${added.body.post.id}`).set(auth);
    expect(del.status).toBe(204);

    const list = await request(app).get("/v1/seed-posts").set(auth);
    expect(list.body.total).toBe(0);
  });

  it("404s deleting an unknown seed post", async () => {
    const res = await request(app).delete("/v1/seed-posts/nope").set(auth);
    expect(res.status).toBe(404);
  });
});

describe("design-templates", () => {
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);

  it("adds a design template with an uploaded preview image, then lists it", async () => {
    const add = await request(app)
      .post("/v1/design-templates")
      .set(auth)
      .field("name", "Blue gradient")
      .field("imejisDesignId", "designABC")
      .attach("image", png, { filename: "preview.png", contentType: "image/png" });
    expect(add.status).toBe(201);
    expect(add.body.designTemplate.name).toBe("Blue gradient");
    expect(add.body.designTemplate.imejis_design_id).toBe("designABC");
    expect(add.body.designTemplate.preview_image_url).toContain("file://");

    const list = await request(app).get("/v1/design-templates").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.designTemplates).toHaveLength(1);
  });

  it("400s an add with no image", async () => {
    const res = await request(app)
      .post("/v1/design-templates")
      .set(auth)
      .field("name", "No image")
      .field("imejisDesignId", "designXYZ");
    expect(res.status).toBe(400);
  });

  it("updates a design template's name without replacing its image", async () => {
    const add = await request(app)
      .post("/v1/design-templates")
      .set(auth)
      .field("name", "Original")
      .field("imejisDesignId", "designABC")
      .attach("image", png, { filename: "preview.png", contentType: "image/png" });

    const patch = await request(app)
      .patch(`/v1/design-templates/${add.body.designTemplate.id}`)
      .set(auth)
      .field("name", "Renamed");
    expect(patch.status).toBe(200);
    expect(patch.body.designTemplate.name).toBe("Renamed");
    expect(patch.body.designTemplate.preview_image_url).toBe(add.body.designTemplate.preview_image_url);
  });

  it("deletes a design template and reports how many golden posts were detached", async () => {
    const add = await request(app)
      .post("/v1/design-templates")
      .set(auth)
      .field("name", "To delete")
      .field("imejisDesignId", "designABC")
      .attach("image", png, { filename: "preview.png", contentType: "image/png" });

    await request(app)
      .post("/v1/golden-posts")
      .set(auth)
      .send({
        title: "A golden post",
        body: "a golden post",
        format: "short",
        idealLengthMin: 300,
        idealLengthMax: 600,
        designTemplateId: add.body.designTemplate.id,
      });

    const del = await request(app).delete(`/v1/design-templates/${add.body.designTemplate.id}`).set(auth);
    expect(del.status).toBe(200);
    expect(del.body.detachedGoldenPosts).toBe(1);
  });

  it("404s deleting an unknown design template", async () => {
    const res = await request(app).delete("/v1/design-templates/nope").set(auth);
    expect(res.status).toBe(404);
  });
});

describe("golden-posts", () => {
  function validGoldenPostBody(overrides: Record<string, unknown> = {}) {
    return {
      title: "A golden post",
      body: "a golden post",
      format: "short",
      idealLengthMin: 300,
      idealLengthMax: 600,
      ...overrides,
    };
  }

  it("400s an add with no body", async () => {
    const res = await request(app)
      .post("/v1/golden-posts")
      .set(auth)
      .send(validGoldenPostBody({ body: undefined, format: "long", hookStyle: "questions" }));
    expect(res.status).toBe(400);
  });

  it("400s a long post with no hook_style", async () => {
    const res = await request(app)
      .post("/v1/golden-posts")
      .set(auth)
      .send(validGoldenPostBody({ format: "long" }));
    expect(res.status).toBe(400);
  });

  it("400s an add with no title, or a title over 80 characters", async () => {
    const noTitle = await request(app)
      .post("/v1/golden-posts")
      .set(auth)
      .send(validGoldenPostBody({ title: undefined }));
    expect(noTitle.status).toBe(400);

    const longTitle = await request(app)
      .post("/v1/golden-posts")
      .set(auth)
      .send(validGoldenPostBody({ title: "x".repeat(81) }));
    expect(longTitle.status).toBe(400);
  });

  it("400s when idealLengthMin is greater than idealLengthMax", async () => {
    const res = await request(app)
      .post("/v1/golden-posts")
      .set(auth)
      .send(validGoldenPostBody({ idealLengthMin: 600, idealLengthMax: 300 }));
    expect(res.status).toBe(400);
  });

  it("adds a golden post, then lists and fetches it", async () => {
    const add = await request(app).post("/v1/golden-posts").set(auth).send(validGoldenPostBody());
    expect(add.status).toBe(201);
    expect(add.body.goldenPost.hook_style).toBeNull();
    expect(add.body.goldenPost.title).toBe("A golden post");
    expect(add.body.goldenPost.ideal_length_min).toBe(300);
    expect(add.body.goldenPost.ideal_length_max).toBe(600);

    const list = await request(app).get("/v1/golden-posts").set(auth);
    expect(list.body.goldenPosts).toHaveLength(1);

    const get = await request(app).get(`/v1/golden-posts/${add.body.goldenPost.id}`).set(auth);
    expect(get.status).toBe(200);
    expect(get.body.goldenPost.body).toBe("a golden post");
  });

  it("409s adding a 6th golden post", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/v1/golden-posts")
        .set(auth)
        .send(validGoldenPostBody({ body: `golden ${i}` }));
      expect(res.status).toBe(201);
    }
    const sixth = await request(app)
      .post("/v1/golden-posts")
      .set(auth)
      .send(validGoldenPostBody({ body: "one too many" }));
    expect(sixth.status).toBe(409);
  });

  it("updates a golden post", async () => {
    const add = await request(app)
      .post("/v1/golden-posts")
      .set(auth)
      .send(validGoldenPostBody({ body: "original" }));
    const patch = await request(app)
      .patch(`/v1/golden-posts/${add.body.goldenPost.id}`)
      .set(auth)
      .send({ body: "updated", title: "Renamed" });
    expect(patch.status).toBe(200);
    expect(patch.body.goldenPost.body).toBe("updated");
    expect(patch.body.goldenPost.title).toBe("Renamed");
  });

  it("400s an update where idealLengthMin is greater than idealLengthMax", async () => {
    const add = await request(app).post("/v1/golden-posts").set(auth).send(validGoldenPostBody());
    const patch = await request(app)
      .patch(`/v1/golden-posts/${add.body.goldenPost.id}`)
      .set(auth)
      .send({ idealLengthMin: 600, idealLengthMax: 300 });
    expect(patch.status).toBe(400);
  });

  it("404s updating an unknown golden post", async () => {
    const res = await request(app).patch("/v1/golden-posts/nope").set(auth).send({ body: "x" });
    expect(res.status).toBe(404);
  });

  it("deletes a golden post", async () => {
    const add = await request(app)
      .post("/v1/golden-posts")
      .set(auth)
      .send(validGoldenPostBody({ body: "to delete" }));
    const del = await request(app).delete(`/v1/golden-posts/${add.body.goldenPost.id}`).set(auth);
    expect(del.status).toBe(204);

    const list = await request(app).get("/v1/golden-posts").set(auth);
    expect(list.body.goldenPosts).toHaveLength(0);
  });

  it("404s deleting an unknown golden post", async () => {
    const res = await request(app).delete("/v1/golden-posts/nope").set(auth);
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/runs/:id/cards", () => {
  it("queues a card batch for the run", async () => {
    const { run } = await seedRun();
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
    const { run } = await seedRun(); // seedRun() creates status: "completed"
    const res = await request(app).get(`/v1/runs/${run.id}/events`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("event: completed");
    expect(subscribeToJob).not.toHaveBeenCalled();
  });

  it("reports 'unavailable' for a running CLI-created run with no job_id", async () => {
    const run = await insertRun({
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
    const run = await insertRun({
      flow: "matrix",
      config: {},
      input_kind: "topic_list",
      status: "running",
    });
    await setRunJobId(run.id, "job-xyz");

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
    const run = await insertRun({
      flow: "matrix",
      config: {},
      input_kind: "topic_list",
      status: "running",
    });
    await setRunJobId(run.id, "job-stuck");

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

    const run = (await getRun(res.body.runId))!;
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
    expect((await getRun(res.body.runId))!.flow).toBe("casestudy");
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

  it("records an overridden angles/posts-per-angle in the run's own config, not just env defaults", async () => {
    const res = await request(app)
      .post("/v1/runs")
      .set(auth)
      .send({
        flow: "matrix",
        input: { kind: "topics", topics: ["a"] },
        anglesPerTopic: 7,
        postsPerAngle: 3,
      });
    expect(res.status).toBe(202);

    const run = (await getRun(res.body.runId))!;
    const config = JSON.parse(run.config_json);
    expect(config.anglesPerTopic).toBe(7);
    expect(config.postsPerAngle).toBe(3);
  });

  it("falls back to env defaults for anything not overridden", async () => {
    const res = await request(app)
      .post("/v1/runs")
      .set(auth)
      .send({ flow: "matrix", input: { kind: "topics", topics: ["a"] } });

    const run = (await getRun(res.body.runId))!;
    const config = JSON.parse(run.config_json);
    expect(config.anglesPerTopic).toBe(loadEnv().GEN_Y);
    expect(config.postsPerAngle).toBe(loadEnv().GEN_Z);
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
