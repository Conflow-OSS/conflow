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
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // The API server, the worker, and the occasional CLI command all open this
  // same file. WAL already lets reads run during a write; this makes a writer
  // wait up to 5s for another writer instead of failing with SQLITE_BUSY.
  db.pragma("busy_timeout = 5000");
  sqliteVec.load(db);

  handle = db;
  return db;
}

export function closeDb(): void {
  handle?.close();
  handle = null;
}
