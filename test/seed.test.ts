import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

const root = mkdtempSync(join(tmpdir(), "content-engine-seed-"));
useTestDatabase();
process.env.VOYAGE_API_KEY = "test-key";
process.env.LOG_LEVEL = "error";

// Never hit the network — hand back a deterministic 16-dim vector per input
// (16, to match the shared test database's embedding column — see test-db.ts).
const embedDocuments = vi.fn(async (texts: string[]) =>
  texts.map((_, i) => Array.from({ length: 16 }, (_unused, dim) => i + dim / 100)),
);
vi.mock("../src/embeddings/voyage.js", () => ({ embedDocuments }));

const { seedCorpus, addSeedPost } = await import("../src/pipeline/seed.js");
const { migrate } = await import("../src/store/migrate.js");
const { listSeedPosts, deleteSeedPost, insertPost, setStatus } = await import("../src/store/posts.js");
const { getDb, closeDb } = await import("../src/store/db.js");

await migrate();

function writeCorpus(dir: string): void {
  writeFileSync(join(dir, "README.md"), "# ignore me\n");
  writeFileSync(join(dir, "01-short.md"), "Honestly, a short take on pod sizing.\n");
  writeFileSync(join(dir, "02-long.md"), "x ".repeat(500).trim() + "\n"); // ~1000 chars
  writeFileSync(join(dir, "03-blank.md"), "   \n");
}

let corpus: string;

beforeEach(async () => {
  await resetTestTables();
  embedDocuments.mockClear();
  corpus = mkdtempSync(join(root, "corpus-"));
  writeCorpus(corpus);
});

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("seedCorpus", () => {
  it("imports non-empty .md files, skips README and blanks, infers format", async () => {
    const r = await seedCorpus(corpus);
    expect(r.added).toBe(2);
    expect(r.short).toBe(1);
    expect(r.long).toBe(1);
    expect(r.removed).toBe(0);
    expect(r.files).toEqual(["01-short.md", "02-long.md"]);

    const sql = getDb();
    const posts = await sql`SELECT kind, format FROM posts WHERE kind = 'seed'`;
    expect(posts).toHaveLength(2);
    const [vecs] = await sql<[{ n: number }]>`
      SELECT COUNT(*)::int AS n FROM posts WHERE kind = 'seed' AND embedding IS NOT NULL
    `;
    expect(vecs!.n).toBe(2);
    expect(embedDocuments).toHaveBeenCalledOnce();
  });

  it("re-seeding replaces the corpus rather than duplicating it", async () => {
    await seedCorpus(corpus);
    const second = await seedCorpus(corpus);
    expect(second.removed).toBe(2);
    expect(second.added).toBe(2);

    const sql = getDb();
    const [count] = await sql<[{ n: number }]>`
      SELECT COUNT(*)::int AS n FROM posts WHERE kind = 'seed'
    `;
    expect(count!.n).toBe(2);
    const [vecs] = await sql<[{ n: number }]>`
      SELECT COUNT(*)::int AS n FROM posts WHERE kind = 'seed' AND embedding IS NOT NULL
    `;
    expect(vecs!.n).toBe(2);
  });

  it("rejects a missing directory", async () => {
    await expect(seedCorpus(join(root, "does-not-exist"))).rejects.toThrow(/not a directory/);
  });
});

describe("addSeedPost", () => {
  it("adds one seed post without touching the existing corpus", async () => {
    await seedCorpus(corpus); // 2 existing seed posts
    embedDocuments.mockClear();

    const added = await addSeedPost("a freshly hand-written post, added on its own");
    expect(added.kind).toBe("seed");
    expect(embedDocuments).toHaveBeenCalledOnce();

    const { total } = await listSeedPosts(50, 0);
    expect(total).toBe(3);
  });

  it("infers short vs long format the same way the batch import does", async () => {
    const short = await addSeedPost("a short one");
    const long = await addSeedPost("x ".repeat(500).trim());
    expect(short.format).toBe("short");
    expect(long.format).toBe("long");
  });
});

describe("listSeedPosts", () => {
  it("paginates and only ever returns kind=seed", async () => {
    await seedCorpus(corpus); // 2 seed posts
    await insertPost({ kind: "generated", format: "long", body: "x".repeat(1000) });

    const page1 = await listSeedPosts(1, 0);
    expect(page1.total).toBe(2);
    expect(page1.posts).toHaveLength(1);
    expect(page1.posts[0]!.kind).toBe("seed");

    const page2 = await listSeedPosts(1, 1);
    expect(page2.posts).toHaveLength(1);
    expect(page2.posts[0]!.id).not.toBe(page1.posts[0]!.id);
  });
});

describe("deleteSeedPost", () => {
  it("removes the post and clears any dup_of_id pointing at it", async () => {
    const seed = await addSeedPost("a seed post about to be deleted");
    const generated = await insertPost({ kind: "generated", format: "long", body: "x".repeat(1000) });
    await setStatus(generated.id, "flag_dup", { flag_reason: "too close", dup_of_id: seed.id, dup_score: 0.9 });

    await deleteSeedPost(seed.id);

    const { total } = await listSeedPosts(50, 0);
    expect(total).toBe(0);
    const sql = getDb();
    const [row] = await sql<[{ dup_of_id: string | null }]>`
      SELECT dup_of_id FROM posts WHERE id = ${generated.id}
    `;
    expect(row!.dup_of_id).toBeNull();
  });

  it("refuses to delete a non-seed post through this path", async () => {
    const generated = await insertPost({ kind: "generated", format: "long", body: "x".repeat(1000) });
    await expect(deleteSeedPost(generated.id)).rejects.toThrow(/no seed post with id/);
  });

  it("throws for an unknown id", async () => {
    await expect(deleteSeedPost("no-such-post")).rejects.toThrow(/no seed post with id/);
  });
});
