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

export async function countEmbeddings(): Promise<number> {
  const sql = getDb();
  const [row] = await sql<[{ n: number }]>`
    SELECT COUNT(*)::int AS n FROM posts WHERE embedding IS NOT NULL
  `;
  return row.n;
}
