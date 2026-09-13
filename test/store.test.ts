import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

useTestDatabase();
process.env.LOG_LEVEL = "error";

const { migrate } = await import("../src/store/migrate.js");
const { insertRun } = await import("../src/store/runs.js");
const { insertTopic, listDistinctTopics } = await import("../src/store/topics.js");
const {
  insertPost,
  getPost,
  setStatus,
  listFlagged,
  dedupLedger,
  listPosts,
} = await import("../src/store/posts.js");
const {
  upsertEmbedding,
  getEmbedding,
  getEmbeddings,
  nearest,
  nearestLedgerMatch,
  countEmbeddings,
} = await import("../src/store/vec.js");
const { cosine } = await import("../src/util/cosine.js");
const { closeDb, getDb } = await import("../src/store/db.js");

beforeAll(async () => {
  await migrate();
  await resetTestTables();
});

afterAll(async () => {
  await closeDb();
});

describe("schema + rows", () => {
  it("round-trips a run, topic and post", async () => {
    const run = await insertRun({ flow: "matrix", config: { GEN_Y: 2 }, input_kind: "topic_list" });
    const topic = await insertTopic({
      run_id: run.id,
      base_text: "SLOs on GKE",
      base_index: 0,
      angle_text: "error budgets for CTOs",
      angle_index: 0,
    });
    const post = await insertPost({
      kind: "generated",
      run_id: run.id,
      topic_id: topic.id,
      variant_index: 0,
      format: "long",
      hook_style: "questions",
      body: "What if your team could measure reliability instead of guessing it??",
      model_channel: "zai",
      model_id: "glm-4.7",
    });
    const fetched = await getPost(post.id);
    expect(fetched?.body).toBe(post.body);
    expect(fetched?.char_count).toBe([...post.body].length);
    expect(fetched?.status).toBe("ok");
  });

  it("flags and status patches persist", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const a = await insertPost({ kind: "generated", run_id: run.id, format: "short", body: "first" });
    const b = await insertPost({ kind: "generated", run_id: run.id, format: "short", body: "second" });
    await setStatus(b.id, "flag_dup", { flag_reason: "too close", dup_of_id: a.id, dup_score: 0.91 });

    const flagged = await listFlagged(run.id);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.dup_of_id).toBe(a.id);
    expect(flagged[0]!.dup_score).toBeCloseTo(0.91);
  });

  it("dedupLedger excludes the current topic and non-ok generated posts", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const t1 = await insertTopic({ run_id: run.id, base_text: "a", base_index: 0, angle_text: "a", angle_index: 0 });
    const t2 = await insertTopic({ run_id: run.id, base_text: "b", base_index: 1, angle_text: "b", angle_index: 0 });
    const keep = await insertPost({ kind: "generated", run_id: run.id, topic_id: t2.id, format: "long", body: "keep me" });
    await insertPost({ kind: "generated", run_id: run.id, topic_id: t2.id, format: "long", body: "drop me", status: "regenerated" });
    await insertPost({ kind: "seed", format: "long", body: "a seed post" });

    const ledger = await dedupLedger({ excludeTopicId: t1.id });
    const ids = ledger.map((r) => r.id);
    expect(ids).toContain(keep.id);
    expect(ledger.some((r) => r.status === "regenerated")).toBe(false);
    expect(ledger.some((r) => r.kind === "seed")).toBe(true);
  });
});

describe("vectors", () => {
  const dims = 16;
  const near = [1, ...Array(dims - 1).fill(0)];
  const alsoNear = [0.9, 0.1, ...Array(dims - 2).fill(0)];
  const far = [...Array(dims - 1).fill(0), 1];

  it("stores and reads back a vector", async () => {
    const p = await insertPost({ kind: "seed", format: "long", body: "vec target" });
    await upsertEmbedding(p.id, near);
    expect(await getEmbedding(p.id)).toEqual(near);
  });

  it("cosine query returns a sane ranking", async () => {
    const a = await insertPost({ kind: "seed", format: "long", body: "A" });
    const b = await insertPost({ kind: "seed", format: "long", body: "B" });
    const c = await insertPost({ kind: "seed", format: "long", body: "C" });
    await upsertEmbedding(a.id, near);
    await upsertEmbedding(b.id, alsoNear);
    await upsertEmbedding(c.id, far);

    const ranked = await nearest(near, 20);
    expect(ranked[0]!.similarity).toBeGreaterThan(0.99);
    const aRank = ranked.findIndex((r) => r.post_id === a.id);
    const cRank = ranked.findIndex((r) => r.post_id === c.id);
    expect(aRank).toBeGreaterThanOrEqual(0);
    expect(aRank).toBeLessThan(cRank); // the aligned vector beats the orthogonal one
    expect(ranked.find((r) => r.post_id === c.id)!.similarity).toBeLessThan(0.2);

    const map = await getEmbeddings([a.id, b.id]);
    expect(cosine(map.get(a.id)!, map.get(b.id)!)).toBeCloseTo(cosine(near, alsoNear));
    expect(await countEmbeddings()).toBeGreaterThanOrEqual(3);
  });

  // A dedicated axis, distinct from `near`/`alsoNear`/`far` above and from
  // anything any other test in this shared table could have inserted — these
  // tests search the whole `posts` table with no run scoping, by design, so
  // a probe vector that overlapped an earlier test's fixture would silently
  // match the wrong row.
  const probe = [...Array(9).fill(0), 1, ...Array(dims - 10).fill(0)];
  const probeNear = [...Array(9).fill(0), 0.95, 0.05, ...Array(dims - 11).fill(0)];

  it("nearestLedgerMatch skips old generated posts but not old seed posts", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const otherTopic = await insertTopic({
      run_id: run.id,
      base_text: "o",
      base_index: 0,
      angle_text: "o",
      angle_index: 0,
    });
    const thisTopic = await insertTopic({
      run_id: run.id,
      base_text: "t",
      base_index: 1,
      angle_text: "t",
      angle_index: 0,
    });

    const oldGenerated = await insertPost({
      kind: "generated",
      run_id: run.id,
      topic_id: otherTopic.id,
      format: "long",
      body: "old generated",
    });
    await upsertEmbedding(oldGenerated.id, probeNear);
    await backdateCreatedAt(oldGenerated.id, 40);

    const oldSeed = await insertPost({ kind: "seed", format: "long", body: "old seed" });
    await upsertEmbedding(oldSeed.id, probeNear);
    await backdateCreatedAt(oldSeed.id, 400);

    // Both candidates are equally close — the too-old generated post must be
    // excluded, leaving the seed post (no age limit) as the match.
    const match = await nearestLedgerMatch(probe, { excludeTopicId: thisTopic.id, windowDays: 30 });
    expect(match?.postId).toBe(oldSeed.id);

    // A fresh generated post within the window should win over both.
    const recentGenerated = await insertPost({
      kind: "generated",
      run_id: run.id,
      topic_id: otherTopic.id,
      format: "long",
      body: "recent generated",
    });
    await upsertEmbedding(recentGenerated.id, probe);

    const matchWithRecent = await nearestLedgerMatch(probe, {
      excludeTopicId: thisTopic.id,
      windowDays: 30,
    });
    expect(matchWithRecent?.postId).toBe(recentGenerated.id);
  });

  it("nearestLedgerMatch excludes the current topic", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const topic = await insertTopic({
      run_id: run.id,
      base_text: "s",
      base_index: 0,
      angle_text: "s",
      angle_index: 0,
    });
    const sameTopicPost = await insertPost({
      kind: "generated",
      run_id: run.id,
      topic_id: topic.id,
      format: "long",
      body: "same topic",
    });
    await upsertEmbedding(sameTopicPost.id, probe);

    const match = await nearestLedgerMatch(probe, { excludeTopicId: topic.id, windowDays: 30 });
    expect(match?.postId).not.toBe(sameTopicPost.id);
  });
});

describe("listPosts", () => {
  it("excludes seed posts, paginates, and reports a total", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    for (let i = 0; i < 3; i++) {
      await insertPost({ kind: "generated", run_id: run.id, format: "long", body: `post ${i} ` + "x".repeat(990) });
    }
    await insertPost({ kind: "seed", format: "long", body: "y".repeat(1000) });

    const page1 = await listPosts({ limit: 2, offset: 0, runId: run.id, status: "all", includeSuperseded: false, includeRejected: false });
    expect(page1.total).toBe(3);
    expect(page1.posts).toHaveLength(2);
    expect(page1.posts.every((p) => p.kind === "generated")).toBe(true);

    const page2 = await listPosts({ limit: 2, offset: 2, runId: run.id, status: "all", includeSuperseded: false, includeRejected: false });
    expect(page2.posts).toHaveLength(1);
  });

  it("excludes regenerated posts unless includeSuperseded is set", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const ok = await insertPost({ kind: "generated", run_id: run.id, format: "long", body: "a".repeat(1000) });
    const superseded = await insertPost({ kind: "generated", run_id: run.id, format: "long", body: "b".repeat(1000) });
    await setStatus(superseded.id, "regenerated");

    const hidden = await listPosts({ limit: 50, offset: 0, runId: run.id, status: "all", includeSuperseded: false, includeRejected: false });
    expect(hidden.posts.map((p) => p.id)).toEqual([ok.id]);

    const shown = await listPosts({
      limit: 50,
      offset: 0,
      runId: run.id,
      status: "all",
      includeSuperseded: true,
      includeRejected: false,
    });
    expect(shown.total).toBe(2);
  });

  it("filters by status and approval", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const ok = await insertPost({ kind: "generated", run_id: run.id, format: "long", body: "a".repeat(1000) });
    const flagged = await insertPost({ kind: "generated", run_id: run.id, format: "long", body: "b".repeat(1000), status: "flag_dup" });
    const { setApproval } = await import("../src/store/posts.js");
    await setApproval(ok.id, "approved");

    const okOnly = await listPosts({ limit: 50, offset: 0, runId: run.id, status: "ok", includeSuperseded: false, includeRejected: false });
    expect(okOnly.posts.map((p) => p.id)).toEqual([ok.id]);

    const flaggedOnly = await listPosts({ limit: 50, offset: 0, runId: run.id, status: "flagged", includeSuperseded: false, includeRejected: false });
    expect(flaggedOnly.posts.map((p) => p.id)).toEqual([flagged.id]);

    const approvedOnly = await listPosts({
      limit: 50,
      offset: 0,
      runId: run.id,
      status: "all",
      approval: "approved",
      includeSuperseded: false,
      includeRejected: false,
    });
    expect(approvedOnly.posts.map((p) => p.id)).toEqual([ok.id]);
  });

  it("excludes rejected posts unless includeRejected is set, or approval=rejected is asked for explicitly", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const ok = await insertPost({ kind: "generated", run_id: run.id, format: "long", body: "a".repeat(1000) });
    const rejected = await insertPost({ kind: "generated", run_id: run.id, format: "long", body: "b".repeat(1000) });
    const { setApproval } = await import("../src/store/posts.js");
    await setApproval(rejected.id, "rejected");

    const hidden = await listPosts({
      limit: 50,
      offset: 0,
      runId: run.id,
      status: "all",
      includeSuperseded: false,
      includeRejected: false,
    });
    expect(hidden.posts.map((p) => p.id)).toEqual([ok.id]);

    const shown = await listPosts({
      limit: 50,
      offset: 0,
      runId: run.id,
      status: "all",
      includeSuperseded: false,
      includeRejected: true,
    });
    expect(shown.total).toBe(2);

    // An explicit approval=rejected filter wins even with includeRejected left false —
    // the default-hide only applies to an otherwise-unfiltered view.
    const explicit = await listPosts({
      limit: 50,
      offset: 0,
      runId: run.id,
      status: "all",
      approval: "rejected",
      includeSuperseded: false,
      includeRejected: false,
    });
    expect(explicit.posts.map((p) => p.id)).toEqual([rejected.id]);
  });
});

describe("listDistinctTopics", () => {
  it("groups by base_text across runs, aggregating run ids and angles", async () => {
    const runA = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const runB = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    const base = "zz-unique-listDistinctTopics-subject";

    await insertTopic({ run_id: runA.id, base_text: base, base_index: 0, angle_text: "angle one", angle_index: 0 });
    await insertTopic({ run_id: runA.id, base_text: base, base_index: 0, angle_text: "angle two", angle_index: 1 });
    await insertTopic({ run_id: runB.id, base_text: base, base_index: 0, angle_text: "angle one", angle_index: 0 });

    const { topics, total } = await listDistinctTopics({ limit: 50, offset: 0, q: "zz-unique-listDistinctTopics" });
    expect(total).toBe(1);
    expect(topics).toHaveLength(1);
    expect(topics[0]!.base_text).toBe(base);
    expect(topics[0]!.run_ids.sort()).toEqual([runA.id, runB.id].sort());
    expect(topics[0]!.angles.sort()).toEqual(["angle one", "angle two"]);
  });

  it("filters by a substring match, case-insensitively", async () => {
    const run = await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" });
    await insertTopic({
      run_id: run.id,
      base_text: "zz-unique-Kubernetes cost optimization",
      base_index: 0,
      angle_text: "a",
      angle_index: 0,
    });

    const found = await listDistinctTopics({ limit: 50, offset: 0, q: "kubernetes cost" });
    expect(found.total).toBe(1);

    const notFound = await listDistinctTopics({ limit: 50, offset: 0, q: "zz-unique-nothing-matches-this" });
    expect(notFound.total).toBe(0);
  });
});

async function backdateCreatedAt(postId: string, daysAgo: number): Promise<void> {
  const sql = getDb();
  const backdated = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  await sql`UPDATE posts SET created_at = ${backdated} WHERE id = ${postId}`;
}
