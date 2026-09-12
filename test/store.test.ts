import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

useTestDatabase();
process.env.LOG_LEVEL = "error";

const { migrate } = await import("../src/store/migrate.js");
const { insertRun } = await import("../src/store/runs.js");
const { insertTopic } = await import("../src/store/topics.js");
const {
  insertPost,
  getPost,
  setStatus,
  listFlagged,
  dedupLedger,
} = await import("../src/store/posts.js");
const {
  upsertEmbedding,
  getEmbedding,
  getEmbeddings,
  nearest,
  countEmbeddings,
} = await import("../src/store/vec.js");
const { cosine } = await import("../src/util/cosine.js");
const { closeDb } = await import("../src/store/db.js");

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
});
