import { loadEnv } from "../config/load.js";
import { logger } from "../util/logger.js";
import { getDb } from "./db.js";

/**
 * Idempotent schema creation. Safe to run on every startup — every statement
 * is CREATE ... IF NOT EXISTS (Postgres supports this natively, unlike
 * SQLite, so there's no need for the column-by-column ALTER dance the old
 * store had). The embedding column's dimension is pinned in `meta`; a
 * mismatch is a hard error because the existing vectors would be unusable.
 */
export async function migrate(): Promise<void> {
  const sql = getDb();
  const env = loadEnv();

  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  // EMBED_DIM is a validated positive integer, safe to interpolate into DDL.
  // sql.unsafe() is postgres.js's raw-SQL escape hatch — needed here because
  // a vector(N) type parameter can't be a bound query parameter.
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id            TEXT PRIMARY KEY,
      flow          TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      config_json   TEXT NOT NULL,
      input_kind    TEXT NOT NULL,
      input_text    TEXT,
      status        TEXT NOT NULL DEFAULT 'completed',
      job_id        TEXT,
      error         TEXT,
      progress_json TEXT
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
      id                 TEXT PRIMARY KEY,
      kind               TEXT NOT NULL,
      run_id             TEXT REFERENCES runs(id),
      topic_id           TEXT REFERENCES topics(id),
      variant_index      INTEGER,
      format             TEXT NOT NULL,
      hook_style         TEXT,
      topic_angle        TEXT,
      lesson_text        TEXT,
      body               TEXT NOT NULL,
      char_count         INTEGER NOT NULL,
      summary            TEXT,
      summary_char_count INTEGER,
      status             TEXT NOT NULL,
      flag_reason        TEXT,
      dup_of_id          TEXT REFERENCES posts(id),
      dup_score          DOUBLE PRECISION,
      approval           TEXT NOT NULL DEFAULT 'pending',
      approved_at        TEXT,
      image_url          TEXT,
      image_key          TEXT,
      image_generated_at TEXT,
      image_error        TEXT,
      model_channel      TEXT,
      model_id           TEXT,
      created_at         TEXT NOT NULL,
      embedding          vector(${env.EMBED_DIM})
    );

    CREATE INDEX IF NOT EXISTS idx_posts_kind   ON posts(kind);
    CREATE INDEX IF NOT EXISTS idx_posts_run    ON posts(run_id);
    CREATE INDEX IF NOT EXISTS idx_posts_topic  ON posts(topic_id);
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_topics_run   ON topics(run_id);
  `);

  const [row] = await sql<{ value: string }[]>`SELECT value FROM meta WHERE key = 'embed_dim'`;

  if (!row) {
    await sql`
      INSERT INTO meta (key, value) VALUES ('embed_dim', ${String(env.EMBED_DIM)})
      ON CONFLICT (key) DO NOTHING
    `;
  } else if (row.value !== String(env.EMBED_DIM)) {
    throw new Error(
      `EMBED_DIM changed (${row.value} -> ${env.EMBED_DIM}). The embedding column must be ` +
        `rebuilt: ALTER TABLE posts ALTER COLUMN embedding TYPE vector(${env.EMBED_DIM}), ` +
        `delete the 'embed_dim' meta row, re-embed.`,
    );
  }

  logger.debug("schema ready", { embed_dim: env.EMBED_DIM });
}
