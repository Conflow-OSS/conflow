import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { loadEnv } from "../config/load.js";

let handle: Database.Database | null = null;

/** Open (once) the SQLite database with the sqlite-vec extension loaded. */
export function getDb(): Database.Database {
  if (handle) return handle;
  const env = loadEnv();
  mkdirSync(dirname(env.DB_PATH), { recursive: true });

  const db = new Database(env.DB_PATH);
  // Set this first: the API server, the worker, and the occasional CLI command
  // all open this same file, and even switching on WAL needs a brief exclusive
  // lock. With the timeout a contended writer waits up to 5s instead of failing
  // with SQLITE_BUSY.
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);

  handle = db;
  return db;
}

export function closeDb(): void {
  handle?.close();
  handle = null;
}
