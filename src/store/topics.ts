import { newId } from "../util/ids.js";
import { getDb } from "./db.js";
import type { TopicRow } from "./types.js";

export interface NewTopic {
  run_id: string;
  base_text: string;
  base_index: number;
  angle_text: string;
  angle_index: number;
}

const COLUMN_NAMES = ["id", "run_id", "base_text", "base_index", "angle_text", "angle_index"] as const;

export async function insertTopic(t: NewTopic): Promise<TopicRow> {
  const row: TopicRow = { id: newId(), ...t };
  const sql = getDb();
  await sql`INSERT INTO topics ${sql(row, ...COLUMN_NAMES)}`;
  return row;
}

export async function listTopicsByRun(runId: string): Promise<TopicRow[]> {
  const sql = getDb();
  return sql<TopicRow[]>`SELECT * FROM topics WHERE run_id = ${runId} ORDER BY base_index, angle_index`;
}

export async function getTopic(id: string): Promise<TopicRow | undefined> {
  const sql = getDb();
  const [row] = await sql<TopicRow[]>`SELECT * FROM topics WHERE id = ${id}`;
  return row;
}
