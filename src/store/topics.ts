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

export function insertTopic(t: NewTopic): TopicRow {
  const row: TopicRow = { id: newId(), ...t };
  getDb()
    .prepare(
      `INSERT INTO topics (id, run_id, base_text, base_index, angle_text, angle_index)
       VALUES (@id, @run_id, @base_text, @base_index, @angle_text, @angle_index)`,
    )
    .run(row);
  return row;
}

export function listTopicsByRun(runId: string): TopicRow[] {
  return getDb()
    .prepare(`SELECT * FROM topics WHERE run_id = ? ORDER BY base_index, angle_index`)
    .all(runId) as TopicRow[];
}
