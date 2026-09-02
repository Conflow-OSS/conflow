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
  sqliteVec.load(db);

  handle = db;
  return db;
}

export function closeDb(): void {
  handle?.close();
  handle = null;
}
