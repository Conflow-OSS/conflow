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
process.env.CARD_RENDER_DELAY_MS = "0";
process.env.IMEJIS_DESIGN_ID = "designX";
process.env.LOG_LEVEL = "error";

const { migrate } = await import("../src/store/migrate.js");
const { insertRun } = await import("../src/store/runs.js");
const { insertPost, getPost, setApproval } = await import("../src/store/posts.js");
const { generateCardsForRun, generateOneCard } = await import("../src/cards/run.js");
const { closeDb } = await import("../src/store/db.js");

migrate();

const renderer: CardRenderer = {
  render: vi.fn(async (summary: string) => Buffer.from(`png:${summary}`)),
  contentType: () => "image/png",
};

class FakeStore implements ImageStore {
  objects = new Map<string, Buffer>();
  failPutsBefore = 0; // fail the first N put() calls
  putCount = 0;

  async put(key: string, body: Buffer): Promise<StoredImage> {
    this.putCount++;
    if (this.putCount <= this.failPutsBefore) {
      throw new Error("storage unavailable");
    }
    this.objects.set(key, body);
    return { url: `https://cdn.example/${key}`, key };
  }

  async find(key: string): Promise<StoredImage | null> {
    return this.objects.has(key) ? { url: `https://cdn.example/${key}`, key } : null;
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
  it("renders a card for each approved post and records the url", async () => {
    const a = approvedPost("first summary");
    const b = approvedPost("second summary");

    const result = await generateCardsForRun({ runId, limit: 10, renderer, store });

    expect(result).toMatchObject({ attempted: 2, rendered: 2, reused: 0, failed: 0 });
    expect(getPost(a)!.image_url).toContain("https://cdn.example/cards/");
    expect(getPost(b)!.image_url).toContain(".png");
    expect(store.objects.size).toBe(2);
  });

  it("reuses a cached render for an identical summary instead of rendering again", async () => {
    const a = approvedPost("the same line");
    const b = approvedPost("the same line");

    const result = await generateCardsForRun({ runId, limit: 10, renderer, store });

    expect(result).toMatchObject({ rendered: 1, reused: 1 });
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(getPost(a)!.image_url).toBe(getPost(b)!.image_url);
  });

  it("re-running only renders the posts that were added since", async () => {
    approvedPost("one");
    approvedPost("two");
    await generateCardsForRun({ runId, limit: 10, renderer, store });
    vi.clearAllMocks();

    approvedPost("three");
    const second = await generateCardsForRun({ runId, limit: 10, renderer, store });

    expect(second).toMatchObject({ attempted: 1, rendered: 1 });
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it("respects the limit", async () => {
    approvedPost("a");
    approvedPost("b");
    approvedPost("c");
    const first = await generateCardsForRun({ runId, limit: 2, renderer, store });
    expect(first.attempted).toBe(2);
  });

  it("records the error on a failed upload and keeps going", async () => {
    const a = approvedPost("first post");
    const b = approvedPost("second post");
    store.failPutsBefore = 1; // the first upload fails, the second succeeds

    const result = await generateCardsForRun({ runId, limit: 10, renderer, store });

    expect(result).toMatchObject({ attempted: 2, rendered: 1, failed: 1 });
    expect(getPost(a)!.image_url).toBeNull();
    expect(getPost(a)!.image_error).toMatch(/storage unavailable/);
    expect(getPost(b)!.image_url).not.toBeNull();
  });

  it("skips posts that are not approved or have no summary", async () => {
    insertPost({ kind: "generated", run_id: runId, format: "long", body: "x".repeat(1000), summary: "s", status: "ok" });
    approvedPost(null);

    const result = await generateCardsForRun({ runId, limit: 10, renderer, store });
    expect(result.attempted).toBe(0);
  });
});

describe("generateOneCard", () => {
  it("always renders fresh, even for a summary already cached", async () => {
    const a = approvedPost("cached line");
    await generateCardsForRun({ runId, limit: 10, renderer, store });
    vi.clearAllMocks();

    await generateOneCard({ postId: a, renderer, store });
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it("refuses a post with no summary", async () => {
    const a = approvedPost(null);
    await expect(generateOneCard({ postId: a, renderer, store })).rejects.toThrow(/no summary/);
  });
});
