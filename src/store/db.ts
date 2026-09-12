import postgres from "postgres";
import { loadEnv } from "../config/load.js";
import { logger } from "../util/logger.js";

export type Sql = postgres.Sql;
/** What a plain pool connection and a transaction's scoped connection have in
 *  common — the shape functions that might run inside a transaction should
 *  accept (see insertPost/upsertEmbedding), since a transaction's sql isn't a
 *  full Sql (no .end(), etc.). */
export type Queryable = postgres.ISql;

let sql: Sql | null = null;

/** The Postgres connection pool (created once, lazily, on first use). */
export function getDb(): Sql {
  if (!sql) {
    const env = loadEnv();
    sql = postgres(env.DATABASE_URL, {
      max: env.DB_POOL_MAX,
      // migrate() is idempotent CREATE/ALTER ... IF NOT EXISTS, run on every
      // process boot — Postgres logs a NOTICE for each no-op, which is just
      // noise here, not a warning worth surfacing the way logger.warn is.
      onnotice: (notice) => logger.debug("postgres notice", { message: notice.message }),
    });
  }
  return sql;
}

export async function closeDb(): Promise<void> {
  await sql?.end();
  sql = null;
}
