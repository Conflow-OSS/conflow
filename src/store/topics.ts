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

export interface DistinctTopic {
  base_text: string;
  run_ids: string[];
  angles: string[];
  last_used_at: string;
}

/**
 * Every base topic ever used, across every run, grouped with every angle
 * already explored under it — a human-facing check for "have I covered this
 * before" at topic-selection time, before a run is even started. Deliberately
 * separate from (and earlier than) the embedding-based dedup, which only ever
 * catches near-duplicate *text* after generation already happened — this
 * catches "I'm about to spend a whole run on a topic I already did," which a
 * human recognizes from the topic string itself, no embedding needed.
 */
export async function listDistinctTopics(opts: {
  limit: number;
  offset: number;
  q?: string;
}): Promise<{ topics: DistinctTopic[]; total: number }> {
  const sql = getDb();
  const params: string[] = [];
  let where = "";
  if (opts.q) {
    params.push(`%${opts.q}%`);
    where = `WHERE t.base_text ILIKE $${params.length}`;
  }

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const [topics, [{ n }]] = await Promise.all([
    sql.unsafe<DistinctTopic[]>(
      `SELECT t.base_text,
              ARRAY_AGG(DISTINCT t.run_id) AS run_ids,
              ARRAY_AGG(DISTINCT t.angle_text) AS angles,
              MAX(r.created_at) AS last_used_at
         FROM topics t
         JOIN runs r ON r.id = t.run_id
         ${where}
        GROUP BY t.base_text
        ORDER BY last_used_at DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, opts.limit, opts.offset],
    ),
    sql.unsafe<[{ n: number }]>(
      `SELECT COUNT(DISTINCT t.base_text)::int AS n FROM topics t ${where}`,
      params,
    ),
  ]);

  return { topics, total: n };
}
