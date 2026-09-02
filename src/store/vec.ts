import { getDb } from "./db.js";

/**
 * sqlite-vec stores vectors and answers nearest-neighbour queries. It does NOT
 * create embeddings — every vector here came from a Voyage API call upstream.
 */

/** vec0 virtual tables reject UPSERT, so replace explicitly. */
export function upsertEmbedding(postId: string, embedding: readonly number[]): void {
  const db = getDb();
  const write = db.transaction((id: string, vec: string) => {
    db.prepare(`DELETE FROM vec_posts WHERE post_id = ?`).run(id);
    db.prepare(`INSERT INTO vec_posts (post_id, embedding) VALUES (?, ?)`).run(id, vec);
  });
  write(postId, JSON.stringify(embedding));
}

export function getEmbedding(postId: string): number[] | null {
  const row = getDb()
    .prepare(`SELECT vec_to_json(embedding) AS j FROM vec_posts WHERE post_id = ?`)
    .get(postId) as { j: string } | undefined;
  return row ? (JSON.parse(row.j) as number[]) : null;
}

export function getEmbeddings(postIds: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (postIds.length === 0) return out;
  const placeholders = postIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT post_id, vec_to_json(embedding) AS j FROM vec_posts
        WHERE post_id IN (${placeholders})`,
    )
    .all(...postIds) as Array<{ post_id: string; j: string }>;
  for (const r of rows) out.set(r.post_id, JSON.parse(r.j) as number[]);
  return out;
}

/** KNN via the cosine metric declared on the table. similarity = 1 - distance. */
export function nearest(
  embedding: readonly number[],
  k: number,
): Array<{ post_id: string; similarity: number }> {
  const rows = getDb()
    .prepare(
      `SELECT post_id, distance FROM vec_posts
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance`,
    )
    .all(JSON.stringify(embedding), k) as Array<{ post_id: string; distance: number }>;
  return rows.map((r) => ({ post_id: r.post_id, similarity: 1 - r.distance }));
}

export function countEmbeddings(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM vec_posts`).get() as { n: number };
  return row.n;
}
