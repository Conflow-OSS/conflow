import { getEmbeddings } from "../store/vec.js";
import { cosine } from "../util/cosine.js";

export interface EmbeddedPost {
  postId: string;
  embedding: number[];
}

export interface DuplicateMatch {
  duplicateOfPostId: string;
  similarity: number;
  reason: string;
}

export interface LedgerCandidate {
  postId: string;
  similarity: number;
}

/**
 * Decide whether a freshly generated post is a near-duplicate.
 *
 * It is checked twice, tightest first:
 *   - against its siblings (other variants of the same angle-topic) — these are
 *     meant to be about the same thing, so only near-identical text is flagged
 *   - against the ledger's single closest match (seed posts + recent standing
 *     posts on other topics — `store/vec.ts`'s `nearestLedgerMatch` has already
 *     narrowed this to one candidate via SQL) — a looser threshold, because
 *     repeating a whole point across topics soon after is what actually matters
 *
 * Returns the closest match that crosses a threshold, or null.
 */
export function findDuplicate(input: {
  postEmbedding: number[];
  siblingEmbeddings: EmbeddedPost[];
  siblingThreshold: number;
  ledgerMatch: LedgerCandidate | null;
  ledgerThreshold: number;
}): DuplicateMatch | null {
  const siblingMatch = closestAboveThreshold(
    input.postEmbedding,
    input.siblingEmbeddings,
    input.siblingThreshold,
  );
  if (siblingMatch) {
    return {
      ...siblingMatch,
      reason: `too close to a sibling variant (similarity ${siblingMatch.similarity.toFixed(2)})`,
    };
  }

  if (input.ledgerMatch && input.ledgerMatch.similarity >= input.ledgerThreshold) {
    return {
      duplicateOfPostId: input.ledgerMatch.postId,
      similarity: input.ledgerMatch.similarity,
      reason: `too close to an existing post (similarity ${input.ledgerMatch.similarity.toFixed(2)})`,
    };
  }

  return null;
}

function closestAboveThreshold(
  target: number[],
  candidates: EmbeddedPost[],
  threshold: number,
): { duplicateOfPostId: string; similarity: number } | null {
  let closest: { duplicateOfPostId: string; similarity: number } | null = null;
  for (const candidate of candidates) {
    const similarity = cosine(target, candidate.embedding);
    if (similarity >= threshold && (closest === null || similarity > closest.similarity)) {
      closest = { duplicateOfPostId: candidate.postId, similarity };
    }
  }
  return closest;
}

export async function loadEmbeddingsForPosts(postIds: string[]): Promise<EmbeddedPost[]> {
  return attachEmbeddings(postIds);
}

async function attachEmbeddings(postIds: string[]): Promise<EmbeddedPost[]> {
  const embeddingByPostId = await getEmbeddings(postIds);
  const embedded: EmbeddedPost[] = [];
  for (const postId of postIds) {
    const embedding = embeddingByPostId.get(postId);
    if (embedding) {
      embedded.push({ postId, embedding });
    }
  }
  return embedded;
}
