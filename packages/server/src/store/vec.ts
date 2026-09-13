import { getDb, type Queryable } from "./db.js";

/**
 * The embedding lives on `posts.embedding` (a pgvector column), not a
 * sidecar table — Postgres, unlike SQLite, has a real vector column type, so
 * there's no need for a virtual table to bolt one on. This module stays a
 * thin wrapper around that column so nothing outside it has to know that.
 */

/** pgvector's text format is exactly `[0.1,0.2,...]` — also valid JSON, conveniently. */
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

function fromVectorLiteral(literal: string): number[] {
  return JSON.parse(literal) as number[];
}

/** `db` defaults to the pool — `pipeline/seed.ts` passes a transaction's scoped connection instead. */
export async function upsertEmbedding(
  postId: string,
  embedding: readonly number[],
  db: Queryable = getDb(),
): Promise<void> {
  await db`UPDATE posts SET embedding = ${toVectorLiteral(embedding)}::vector WHERE id = ${postId}`;
}

export async function getEmbedding(postId: string): Promise<number[] | null> {
  const sql = getDb();
  const [row] = await sql<Array<{ embedding: string | null }>>`
    SELECT embedding FROM posts WHERE id = ${postId}
  `;
  return row?.embedding ? fromVectorLiteral(row.embedding) : null;
}

export async function getEmbeddings(postIds: readonly string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (postIds.length === 0) return out;

  const sql = getDb();
  const rows = await sql<Array<{ id: string; embedding: string | null }>>`
    SELECT id, embedding FROM posts WHERE id = ANY(${sql.array(postIds as string[])})
  `;
  for (const row of rows) {
    if (row.embedding) out.set(row.id, fromVectorLiteral(row.embedding));
  }
  return out;
}

/** KNN via pgvector's cosine-distance operator. similarity = 1 - distance. */
export async function nearest(
  embedding: readonly number[],
  k: number,
): Promise<Array<{ post_id: string; similarity: number }>> {
  const sql = getDb();
  const rows = await sql<Array<{ post_id: string; distance: number }>>`
    SELECT id AS post_id, embedding <=> ${toVectorLiteral(embedding)}::vector AS distance
    FROM posts
    WHERE embedding IS NOT NULL
    ORDER BY distance
    LIMIT ${k}
  `;
  return rows.map((r) => ({ post_id: r.post_id, similarity: 1 - r.distance }));
}

export interface LedgerMatch {
  postId: string;
  similarity: number;
}

/**
 * Closest ledger candidate for the cross-topic dedup check: every seed post
 * (the voice reference — always in scope, it doesn't go stale), plus standing
 * generated posts from other topics created within the last `windowDays`.
 * Older generated posts are deliberately not compared: the goal is "don't
 * repeat yourself again soon," not "never repeat yourself, ever" — echoing a
 * point from months back is fine, near-identical text days apart isn't. As a
 * side effect this also keeps the query cheap forever, since the candidate
 * pool is bounded by posting cadence, not by how much history has piled up.
 */
export async function nearestLedgerMatch(
  embedding: readonly number[],
  opts: { excludeTopicId: string; windowDays: number },
): Promise<LedgerMatch | null> {
  const sql = getDb();
  // created_at is stored as an ISO-8601 string, not a real timestamp column
  // (a holdover from SQLite, which has no native datetime type) — ISO-8601
  // sorts the same lexicographically as chronologically, so a plain text
  // comparison against a JS-computed cutoff works correctly.
  const cutoff = new Date(Date.now() - opts.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const [row] = await sql<Array<{ id: string; distance: number }>>`
    SELECT id, embedding <=> ${toVectorLiteral(embedding)}::vector AS distance
    FROM posts
    WHERE embedding IS NOT NULL
      AND (topic_id IS NULL OR topic_id != ${opts.excludeTopicId})
      AND (
        kind = 'seed'
        OR (kind = 'generated' AND status = 'ok' AND approval != 'rejected' AND created_at >= ${cutoff})
      )
    ORDER BY distance ASC
    LIMIT 1
  `;
  return row ? { postId: row.id, similarity: 1 - row.distance } : null;
}

export async function countEmbeddings(): Promise<number> {
  const sql = getDb();
  const [row] = await sql<[{ n: number }]>`
    SELECT COUNT(*)::int AS n FROM posts WHERE embedding IS NOT NULL
  `;
  return row.n;
}
