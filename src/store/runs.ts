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

const COLUMN_NAMES = [
  "id",
  "flow",
  "created_at",
  "config_json",
  "input_kind",
  "input_text",
  "status",
  "job_id",
  "error",
  "progress_json",
] as const;

export async function insertRun(r: NewRun): Promise<RunRow> {
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

  const sql = getDb();
  await sql`INSERT INTO runs ${sql(row, ...COLUMN_NAMES)}`;
  return row;
}

export async function getRun(id: string): Promise<RunRow | undefined> {
  const sql = getDb();
  const [row] = await sql<RunRow[]>`SELECT * FROM runs WHERE id = ${id}`;
  return row;
}

export async function latestRun(): Promise<RunRow | undefined> {
  const sql = getDb();
  const [row] = await sql<RunRow[]>`SELECT * FROM runs ORDER BY created_at DESC LIMIT 1`;
  return row;
}

/** Runs newest first, for the API's run list. */
export async function listRuns(limit: number, offset: number): Promise<RunRow[]> {
  const sql = getDb();
  return sql<RunRow[]>`SELECT * FROM runs ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
}

export async function setRunStatus(id: string, status: RunStatus, error?: string | null): Promise<void> {
  const sql = getDb();
  await sql`UPDATE runs SET status = ${status}, error = ${error ?? null} WHERE id = ${id}`;
}

export async function setRunJobId(id: string, jobId: string): Promise<void> {
  const sql = getDb();
  await sql`UPDATE runs SET job_id = ${jobId} WHERE id = ${id}`;
}

export async function setRunProgress(id: string, progress: unknown): Promise<void> {
  const sql = getDb();
  await sql`UPDATE runs SET progress_json = ${JSON.stringify(progress)} WHERE id = ${id}`;
}
