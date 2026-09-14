import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageStore, StoredImage } from "../src/cards/image-store.js";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

useTestDatabase();
process.env.DEDUP_SIBLING_THRESHOLD = "0.93";
process.env.DEDUP_LEDGER_THRESHOLD = "0.85";
process.env.DEDUP_LEDGER_WINDOW_DAYS = "30";
process.env.LENGTH_TOLERANCE = "0.15";
process.env.LOG_LEVEL = "error";

vi.mock("../src/embeddings/voyage.js", async () => {
  const { textToVector } = await import("./support/fake-embeddings.js");
  return {
    embedDocuments: async (texts: string[]) => texts.map(textToVector),
    embedQuery: async (text: string) => textToVector(text),
  };
});

const { migrate } = await import("../src/store/migrate.js");
const { insertRun } = await import("../src/store/runs.js");
const { insertTopic } = await import("../src/store/topics.js");
const { insertPost, getPost, setApproval, setStatus, setPostImage, publishPost } = await import(
  "../src/store/posts.js"
);
const { upsertEmbedding, getEmbedding } = await import("../src/store/vec.js");
const { editPost } = await import("../src/pipeline/edit.js");
const { closeDb } = await import("../src/store/db.js");
const { textToVector } = await import("./support/fake-embeddings.js");

await migrate();

class FakeStore implements ImageStore {
  objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<StoredImage> {
    this.objects.set(key, body);
    return { url: `https://cdn.example/${key}`, key };
  }

  async find(key: string): Promise<StoredImage | null> {
    return this.objects.has(key) ? { url: `https://cdn.example/${key}`, key } : null;
  }

  async get(key: string): Promise<Buffer> {
    return this.objects.get(key)!;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

const LONG_BODY = ("word ".repeat(200)).trim(); // ~1000 chars — inside the long-format band
const TOO_SHORT_BODY = "way too short";

let runId: string;
let topicId: string;
let store: FakeStore;

async function newEditablePost(body = LONG_BODY): Promise<string> {
  const post = await insertPost({
    kind: "generated",
    run_id: runId,
    topic_id: topicId,
    format: "long",
    body,
    status: "ok",
  });
  await upsertEmbedding(post.id, textToVector(body));
  return post.id;
}

beforeEach(async () => {
  await resetTestTables();
  runId = (await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" })).id;
  topicId = (
    await insertTopic({ run_id: runId, base_text: "t", base_index: 0, angle_text: "a", angle_index: 0 })
  ).id;
  store = new FakeStore();
});

afterAll(async () => {
  await closeDb();
});

describe("editPost — guards", () => {
  it("refuses an unknown post id", async () => {
    await expect(editPost("no-such-post", { body: "x" }, store)).rejects.toThrow(/no post with id/);
  });

  it("refuses to edit a seed post", async () => {
    const seed = await insertPost({ kind: "seed", format: "long", body: LONG_BODY });
    await expect(editPost(seed.id, { body: "x".repeat(1000) }, store)).rejects.toThrow(/not an editable/);
  });

  it("refuses to edit an already-superseded post", async () => {
    const postId = await newEditablePost();
    await setStatus(postId, "regenerated");
    await expect(editPost(postId, { body: "x".repeat(1000) }, store)).rejects.toThrow(/already replaced/);
  });

  it("refuses to edit an already-published post", async () => {
    const postId = await newEditablePost();
    await setApproval(postId, "approved");
    await publishPost(postId);
    await expect(editPost(postId, { body: "x".repeat(1000) }, store)).rejects.toThrow(/already published/);
  });
});

describe("editPost — no-op", () => {
  it("does nothing, including leaving approval alone, when nothing actually changed", async () => {
    const postId = await newEditablePost();
    await setApproval(postId, "approved");

    const result = await editPost(postId, { body: LONG_BODY }, store);
    expect(result.approval).toBe("approved");
  });
});

describe("editPost — body changes", () => {
  it("recomputes char_count, re-embeds, and resets approval to pending", async () => {
    const postId = await newEditablePost();
    await setApproval(postId, "approved");

    const newBody = LONG_BODY.replace("word", "term");
    const result = await editPost(postId, { body: newBody }, store);

    expect(result.body).toBe(newBody);
    expect(result.char_count).toBe(newBody.length);
    expect(result.approval).toBe("pending");
    expect(result.approved_at).toBeNull();
    // pgvector's `vector` column is single-precision text-round-tripped, so
    // comparing exact doubles is too strict — compare within float32 tolerance.
    const stored = (await getEmbedding(postId))!;
    const expected = textToVector(newBody);
    stored.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5));
  });

  it("flags flag_length for a body outside the format band", async () => {
    const postId = await newEditablePost();
    const result = await editPost(postId, { body: TOO_SHORT_BODY }, store);
    expect(result.status).toBe("flag_length");
    expect(result.flag_reason).toMatch(/body/);
  });

  it("flags a sibling duplicate before checking the ledger", async () => {
    const postId = await newEditablePost();
    const siblingBody = "sibling body text ".repeat(60).trim();
    const sibling = await insertPost({
      kind: "generated",
      run_id: runId,
      topic_id: topicId,
      format: "long",
      body: siblingBody,
      status: "ok",
    });
    await upsertEmbedding(sibling.id, textToVector(siblingBody));

    // Also plant a seed post with the exact same text — if the ledger tier
    // won the day instead of the sibling tier, this is what it would match.
    const seed = await insertPost({ kind: "seed", format: "long", body: siblingBody });
    await upsertEmbedding(seed.id, textToVector(siblingBody));

    const result = await editPost(postId, { body: siblingBody }, store);
    expect(result.status).toBe("flag_dup");
    expect(result.dup_of_id).toBe(sibling.id);
    expect(result.flag_reason).toMatch(/sibling/);
  });

  it("flags a ledger duplicate from a seed post regardless of its age", async () => {
    const postId = await newEditablePost();
    const seedBody = "the seed voice reference text ".repeat(40).trim();
    const seed = await insertPost({ kind: "seed", format: "long", body: seedBody });
    await upsertEmbedding(seed.id, textToVector(seedBody));

    const result = await editPost(postId, { body: seedBody }, store);
    expect(result.status).toBe("flag_dup");
    expect(result.dup_of_id).toBe(seed.id);
    expect(result.flag_reason).toMatch(/existing post/);
  });

  it("does not re-embed or re-dedup when only the summary changes", async () => {
    const postId = await newEditablePost();
    const before = (await getEmbedding(postId))!;

    const result = await editPost(postId, { summary: "a new one-line summary" }, store);
    expect(result.summary).toBe("a new one-line summary");
    expect(await getEmbedding(postId)).toEqual(before);
  });
});

describe("editPost — card cleanup on a summary change", () => {
  async function postWithCard(): Promise<string> {
    const postId = await newEditablePost();
    const key = "cards/existing.png";
    store.objects.set(key, Buffer.from("bytes"));
    await setPostImage(postId, { url: `https://cdn.example/${key}`, key });
    return postId;
  }

  it("clears the post's image fields and deletes the object when unshared", async () => {
    const postId = await postWithCard();

    const result = await editPost(postId, { summary: "changed" }, store);
    expect(result.image_url).toBeNull();
    expect(result.image_key).toBeNull();
    expect(store.objects.has("cards/existing.png")).toBe(false);
  });

  it("clears the fields but keeps the object if another post still shares that key", async () => {
    const postId = await postWithCard();
    const otherId = await newEditablePost("a completely different long body " + "x".repeat(960));
    await setPostImage(otherId, { url: "https://cdn.example/cards/existing.png", key: "cards/existing.png" });

    const result = await editPost(postId, { summary: "changed" }, store);
    expect(result.image_key).toBeNull();
    expect(store.objects.has("cards/existing.png")).toBe(true);
    expect((await getPost(otherId))!.image_key).toBe("cards/existing.png");
  });

  it("leaves the card alone when the summary is unchanged", async () => {
    const postId = await postWithCard();
    const newBody = LONG_BODY.replace("word", "phrase");

    const result = await editPost(postId, { body: newBody }, store);
    expect(result.image_key).toBe("cards/existing.png");
    expect(store.objects.has("cards/existing.png")).toBe(true);
  });
});
