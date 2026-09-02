import { newId } from "../util/ids.js";
import { getDb } from "./db.js";
import type { Flow, InputKind, RunRow } from "./types.js";

export interface NewRun {
  flow: Flow;
  config: unknown;
  input_kind: InputKind;
  input_text?: string | null;
}

export function insertRun(r: NewRun): RunRow {
  const row: RunRow = {
    id: newId(),
    flow: r.flow,
    created_at: new Date().toISOString(),
    config_json: JSON.stringify(r.config),
    input_kind: r.input_kind,
    input_text: r.input_text ?? null,
  };
  getDb()
    .prepare(
      `INSERT INTO runs (id, flow, created_at, config_json, input_kind, input_text)
       VALUES (@id, @flow, @created_at, @config_json, @input_kind, @input_text)`,
    )
    .run(row);
  return row;
}

export function getRun(id: string): RunRow | undefined {
  return getDb().prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
}

export function latestRun(): RunRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT 1`)
    .get() as RunRow | undefined;
}
