import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadEnv, requireVoyage } from "../config/load.js";
import { embedDocuments } from "../embeddings/voyage.js";
import { getDb } from "../store/db.js";
import { migrate } from "../store/migrate.js";
import { charCount, insertPost } from "../store/posts.js";
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
  migrate();

  if (docs.length === 0) {
    logger.warn("no seed documents given");
    return { removed: 0, added: 0, files: [], short: 0, long: 0 };
  }

  const vectors = await embedDocuments(docs.map((d) => d.body));

  const db = getDb();
  const write = db.transaction(() => {
    const seedIds = (
      db.prepare(`SELECT id FROM posts WHERE kind = 'seed'`).all() as Array<{ id: string }>
    ).map((r) => r.id);

    if (seedIds.length > 0) {
      const ph = seedIds.map(() => "?").join(",");
      db.prepare(`UPDATE posts SET dup_of_id = NULL WHERE dup_of_id IN (${ph})`).run(...seedIds);
      db.prepare(`DELETE FROM vec_posts WHERE post_id IN (${ph})`).run(...seedIds);
      db.prepare(`DELETE FROM posts WHERE kind = 'seed'`).run();
    }

    let short = 0;
    let long = 0;
    docs.forEach((d, i) => {
      const format = charCount(d.body) <= SHORT_MAX ? "short" : "long";
      if (format === "short") short++;
      else long++;
      const post = insertPost({ kind: "seed", format, body: d.body });
      upsertEmbedding(post.id, vectors[i]!);
    });

    return { removed: seedIds.length, short, long };
  });

  const { removed, short, long } = write();
  const result: SeedResult = { removed, added: docs.length, files: docs.map((d) => d.file), short, long };
  logger.info("seed complete", result);
  return result;
}
