import type DatabaseConstructor from "better-sqlite3";
import { loadEnv } from "../config/load.js";
import { logger } from "../util/logger.js";
import { getDb } from "./db.js";

type SqliteDatabase = DatabaseConstructor.Database;

function addColumnIfMissing(
  db: SqliteDatabase,
  table: string,
  column: string,
  columnType: string,
): void {
  const existingColumns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const alreadyThere = existingColumns.some((existing) => existing.name === column);
  if (alreadyThere) return;

  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnType}`);
  } catch (error) {
    // The API and the worker both migrate on startup; against a brand-new
    // database they can both pass the check above and then both ALTER. SQLite
    // has no `ADD COLUMN IF NOT EXISTS`, so the loser sees "duplicate column".
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate column name")) throw error;
  }
}

/**
 * Idempotent schema creation. Safe to run on every startup.
 * The vector table's dimension is pinned in `meta`; a mismatch is a hard error
 * because the existing vectors would be unusable.
 */
export function migrate(): void {
  const db = getDb();
  const env = loadEnv();

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY,
      flow        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      config_json TEXT NOT NULL,
      input_kind  TEXT NOT NULL,
      input_text  TEXT
    );

    CREATE TABLE IF NOT EXISTS topics (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES runs(id),
      base_text   TEXT NOT NULL,
      base_index  INTEGER NOT NULL,
      angle_text  TEXT NOT NULL,
      angle_index INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id            TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      run_id        TEXT REFERENCES runs(id),
      topic_id      TEXT REFERENCES topics(id),
      variant_index INTEGER,
      format        TEXT NOT NULL,
      hook_style    TEXT,
      topic_angle   TEXT,
      body          TEXT NOT NULL,
      char_count    INTEGER NOT NULL,
      status        TEXT NOT NULL,
      flag_reason   TEXT,
      dup_of_id     TEXT REFERENCES posts(id),
      dup_score     REAL,
      model_channel TEXT,
      model_id      TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_kind   ON posts(kind);
    CREATE INDEX IF NOT EXISTS idx_posts_run    ON posts(run_id);
    CREATE INDEX IF NOT EXISTS idx_posts_topic  ON posts(topic_id);
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_topics_run   ON topics(run_id);
  `);

  // Columns added after the first release — applied only if the database predates them.
  // Runs made before the queue existed are treated as already finished.
  addColumnIfMissing(db, "runs", "status", "TEXT NOT NULL DEFAULT 'completed'");
  addColumnIfMissing(db, "runs", "job_id", "TEXT");
  addColumnIfMissing(db, "runs", "error", "TEXT");
  addColumnIfMissing(db, "runs", "progress_json", "TEXT");

  addColumnIfMissing(db, "posts", "lesson_text", "TEXT");
  addColumnIfMissing(db, "posts", "summary", "TEXT");
  addColumnIfMissing(db, "posts", "summary_char_count", "INTEGER");
  addColumnIfMissing(db, "posts", "approval", "TEXT NOT NULL DEFAULT 'pending'");
  addColumnIfMissing(db, "posts", "approved_at", "TEXT");
  addColumnIfMissing(db, "posts", "image_url", "TEXT");
  addColumnIfMissing(db, "posts", "image_key", "TEXT");
  addColumnIfMissing(db, "posts", "image_generated_at", "TEXT");
  addColumnIfMissing(db, "posts", "image_error", "TEXT");

  // EMBED_DIM is a validated positive integer, safe to interpolate.
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_posts USING vec0(
       post_id   TEXT PRIMARY KEY,
       embedding FLOAT[${env.EMBED_DIM}] distance_metric=cosine
     );`,
  );

  const row = db
    .prepare(`SELECT value FROM meta WHERE key = 'embed_dim'`)
    .get() as { value: string } | undefined;

  if (!row) {
    // OR IGNORE: the API and worker can both reach this on a fresh database.
    db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('embed_dim', ?)`).run(
      String(env.EMBED_DIM),
    );
  } else if (row.value !== String(env.EMBED_DIM)) {
    throw new Error(
      `EMBED_DIM changed (${row.value} -> ${env.EMBED_DIM}). ` +
        `The vector table must be rebuilt: drop vec_posts, delete the 'embed_dim' meta row, re-embed.`,
    );
  }

  logger.debug("schema ready", { db: env.DB_PATH, embed_dim: env.EMBED_DIM });
}
