import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageStore, StoredImage } from "../src/cards/image-store.js";
import type { CardRenderer } from "../src/cards/run.js";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-cards-"));
process.env.DB_PATH = join(workDir, "cards.db");
process.env.EMBED_DIM = "8";
process.env.CARD_IMAGE_FORMAT = "png";
process.env.LOG_LEVEL = "error";

const { migrate } = await import("../src/store/migrate.js");
const { insertRun } = await import("../src/store/runs.js");
const { insertPost, getPost, setApproval } = await import("../src/store/posts.js");
const { generateCardsForRun, generateOneCard } = await import("../src/cards/run.js");
const { closeDb } = await import("../src/store/db.js");

migrate();

const renderer: CardRenderer = {
  render: vi.fn(async (summary: string) => Buffer.from(`png-for:${summary}`)),
  contentType: () => "image/png",
};

class FakeStore implements ImageStore {
  puts: Array<{ key: string; size: number; contentType: string }> = [];
  failNextKeys = new Set<string>();

  async put(key: string, body: Buffer, contentType: string): Promise<StoredImage> {
    if (this.failNextKeys.has(key)) {
      this.failNextKeys.delete(key);
      throw new Error("storage unavailable");
    }
    this.puts.push({ key, size: body.length, contentType });
    return { url: `https://cdn.example/${key}`, key };
  }
}

let runId: string;
let store: FakeStore;

function approvedPost(summary: string | null): string {
  const post = insertPost({
    kind: "generated",
    run_id: runId,
    format: "long",
    body: "a".repeat(1000),
    summary,
    status: "ok",
  });
  setApproval(post.id, "approved");
  return post.id;
}

beforeEach(() => {
  runId = insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" }).id;
  store = new FakeStore();
  vi.clearAllMocks();
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("generateCardsForRun", () => {
  it("renders and stores a card for each approved post, recording the url", async () => {
    const a = approvedPost("first summary");
    const b = approvedPost("second summary");

    const result = await generateCardsForRun({ runId, limit: 10, renderer, store });

    expect(result).toEqual({ attempted: 2, succeeded: 2, failed: 0 });
    expect(getPost(a)!.image_url).toBe(`https://cdn.example/cards/${a}.png`);
    expect(getPost(b)!.image_key).toBe(`cards/${b}.png`);
    expect(store.puts).toHaveLength(2);
  });

  it("respects the limit and leaves the rest for a later run", async () => {
    approvedPost("one");
    approvedPost("two");
    approvedPost("three");

    const first = await generateCardsForRun({ runId, limit: 2, renderer, store });
    expect(first.succeeded).toBe(2);

    const second = await generateCardsForRun({ runId, limit: 10, renderer, store });
    expect(second.succeeded).toBe(1); // only the un-carded one
  });

  it("records the error on a failed upload and keeps going", async () => {
    const a = approvedPost("will fail");
    const b = approvedPost("will succeed");
    store.failNextKeys.add(`cards/${a}.png`);

    const result = await generateCardsForRun({ runId, limit: 10, renderer, store });

    expect(result).toEqual({ attempted: 2, succeeded: 1, failed: 1 });
    expect(getPost(a)!.image_url).toBeNull();
    expect(getPost(a)!.image_error).toMatch(/storage unavailable/);
    expect(getPost(b)!.image_url).not.toBeNull();
  });

  it("skips posts that are not approved or have no summary", async () => {
    const post = insertPost({ kind: "generated", run_id: runId, format: "long", body: "x".repeat(1000), summary: "s", status: "ok" });
    void post; // pending, not approved
    approvedPost(null); // approved but no summary

    const result = await generateCardsForRun({ runId, limit: 10, renderer, store });
    expect(result.attempted).toBe(0);
  });

  it("retries only the upload on a re-run (never re-renders a stored card)", async () => {
    const a = approvedPost("retry me");
    store.failNextKeys.add(`cards/${a}.png`);

    await generateCardsForRun({ runId, limit: 10, renderer, store }); // fails
    expect(getPost(a)!.image_url).toBeNull();

    await generateCardsForRun({ runId, limit: 10, renderer, store }); // succeeds
    expect(getPost(a)!.image_url).not.toBeNull();
    expect(renderer.render).toHaveBeenCalledTimes(2); // once per attempt — cache would make this 1
  });
});

describe("generateOneCard", () => {
  it("re-renders a specific post even if it already has a card", async () => {
    const a = approvedPost("v1");
    await generateCardsForRun({ runId, limit: 10, renderer, store });
    const firstUrl = getPost(a)!.image_url;

    const { url } = await generateOneCard({ postId: a, renderer, store });
    expect(url).toBe(firstUrl); // same key, overwritten
    expect(store.puts.filter((p) => p.key === `cards/${a}.png`)).toHaveLength(2);
  });

  it("refuses a post with no summary", async () => {
    const a = approvedPost(null);
    await expect(generateOneCard({ postId: a, renderer, store })).rejects.toThrow(/no summary/);
  });
});
