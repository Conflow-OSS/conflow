import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadEnv, requireVoyage } from "../config/load.js";
import { embedDocuments } from "../embeddings/voyage.js";
import { getDb } from "../store/db.js";
import { migrate } from "../store/migrate.js";
import { charCount, insertPost } from "../store/posts.js";
import type { PostRow } from "../store/types.js";
import { upsertEmbedding } from "../store/vec.js";
import { logger } from "../util/logger.js";

/** Below this code-point count a seed post is treated as short-form. */
const SHORT_MAX = 700;

export interface SeedDoc {
  /** a name for logging/reporting — a filename for the CLI, whatever the caller likes for the API */
  file: string;
  body: string;
}

export interface SeedResult {
  removed: number;
  added: number;
  files: string[];
  short: number;
  long: number;
}

/**
 * Re-import the seed corpus from a directory of hand-written `.md` files.
 * The folder is the source of truth: existing seeds are dropped and replaced,
 * so editing or removing a file is reflected on the next run.
 */
export async function seedCorpus(dir: string): Promise<SeedResult> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`not a directory: ${dir}`);
  }

  const files = readdirSync(dir)
    .filter((f) => extname(f).toLowerCase() === ".md")
    .filter((f) => basename(f).toLowerCase() !== "readme.md")
    .sort();

  const docs = files
    .map((f) => ({ file: f, body: readFileSync(join(dir, f), "utf8").trim() }))
    .filter((d) => d.body.length > 0);

  return seedDocuments(docs);
}

/**
 * The same re-import, from documents already in memory — what the API/worker
 * use, since a request body has no filesystem path to read from.
 */
export async function seedDocuments(docs: SeedDoc[]): Promise<SeedResult> {
  const env = loadEnv();
  requireVoyage(env);
  await migrate();

  if (docs.length === 0) {
    logger.warn("no seed documents given");
    return { removed: 0, added: 0, files: [], short: 0, long: 0 };
  }

  const vectors = await embedDocuments(docs.map((d) => d.body));
  const sql = getDb();

  const { removed, short, long } = await sql.begin(async (tx) => {
    const seedRows = await tx<Array<{ id: string }>>`SELECT id FROM posts WHERE kind = 'seed'`;
    const seedIds = seedRows.map((r) => r.id);

    if (seedIds.length > 0) {
      // Embeddings live on the posts row itself now, so deleting the seed
      // rows takes their vectors with them — no separate table to clean up.
      await tx`UPDATE posts SET dup_of_id = NULL WHERE dup_of_id = ANY(${tx.array(seedIds)})`;
      await tx`DELETE FROM posts WHERE kind = 'seed'`;
    }

    let short = 0;
    let long = 0;
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]!;
      const format = charCount(doc.body) <= SHORT_MAX ? "short" : "long";
      if (format === "short") short++;
      else long++;
      const post = await insertPost({ kind: "seed", format, body: doc.body }, tx);
      await upsertEmbedding(post.id, vectors[i]!, tx);
    }

    return { removed: seedIds.length, short, long };
  });

  const result: SeedResult = { removed, added: docs.length, files: docs.map((d) => d.file), short, long };
  logger.info("seed complete", result);
  return result;
}

/**
 * Add one seed post without touching the rest of the corpus — unlike
 * `seedDocuments`/`seedCorpus`, which wipe and replace all of them. This is
 * the path a UI's "add a seed post" action uses; the bulk wipe-and-replace
 * stays for the `content seed <dir>` / whole-folder-is-source-of-truth flow.
 */
export async function addSeedPost(body: string): Promise<PostRow> {
  const env = loadEnv();
  requireVoyage(env);
  await migrate();

  const [vector] = await embedDocuments([body]);
  const format = charCount(body) <= SHORT_MAX ? "short" : "long";
  const post = await insertPost({ kind: "seed", format, body });
  await upsertEmbedding(post.id, vector!);

  logger.info("seed post added", { postId: post.id, format });
  return post;
}
