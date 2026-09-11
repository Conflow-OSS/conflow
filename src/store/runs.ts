import { newId } from "../util/ids.js";
import { getDb } from "./db.js";
import type { Flow, InputKind, RunRow, RunStatus } from "./types.js";

export interface NewRun {
  flow: Flow;
  config: unknown;
  input_kind: InputKind;
  input_text?: string | null;
  status?: RunStatus;
}

export function insertRun(r: NewRun): RunRow {
  const row: RunRow = {
    id: newId(),
    flow: r.flow,
    created_at: new Date().toISOString(),
    config_json: JSON.stringify(r.config),
    input_kind: r.input_kind,
    input_text: r.input_text ?? null,
    status: r.status ?? "queued",
    job_id: null,
    error: null,
    progress_json: null,
  };
  getDb()
    .prepare(
      `INSERT INTO runs (id, flow, created_at, config_json, input_kind, input_text,
                         status, job_id, error, progress_json)
       VALUES (@id, @flow, @created_at, @config_json, @input_kind, @input_text,
               @status, @job_id, @error, @progress_json)`,
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

/** Runs newest first, for the API's run list. */
export function listRuns(limit: number, offset: number): RunRow[] {
  return getDb()
    .prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as RunRow[];
}

export function setRunStatus(id: string, status: RunStatus, error?: string | null): void {
  getDb()
    .prepare(`UPDATE runs SET status = @status, error = @error WHERE id = @id`)
    .run({ id, status, error: error ?? null });
}

export function setRunJobId(id: string, jobId: string): void {
  getDb().prepare(`UPDATE runs SET job_id = ? WHERE id = ?`).run(jobId, id);
}

export function setRunProgress(id: string, progress: unknown): void {
  getDb()
    .prepare(`UPDATE runs SET progress_json = ? WHERE id = ?`)
    .run(JSON.stringify(progress), id);
}
