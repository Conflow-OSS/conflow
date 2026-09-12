/**
 * Every test file shares one Postgres database (`content_engine_test`,
 * created automatically the first time `docker compose up` starts postgres —
 * see scripts/postgres-init/) instead of getting its own throwaway SQLite
 * file the way the store used to work. vitest.config.ts runs test files
 * sequentially (fileParallelism: false), so a shared database is safe as
 * long as each file clears the tables it cares about before it starts.
 *
 * Call useTestDatabase() before importing anything that reads env at import
 * time, same as the old `process.env.DB_PATH = ...` lines this replaces.
 */
export const TEST_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/content_engine_test";

/**
 * Every DB-backed test file must agree on this: the embedding column's
 * dimension is fixed for the whole shared database (migrate() hard-errors on
 * a mismatch, by design), and test/support/fake-embeddings.ts always returns
 * 16 numbers regardless of what a caller asks for.
 */
export const TEST_EMBED_DIM = "16";

export function useTestDatabase(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.EMBED_DIM = TEST_EMBED_DIM;
}

/** Wipe every row so this file starts from the same clean slate a fresh SQLite file used to give it. */
export async function resetTestTables(): Promise<void> {
  const { getDb } = await import("../../src/store/db.js");
  await getDb()`TRUNCATE posts, topics, runs CASCADE`;
}
