import { dedupLedger } from "../store/posts.js";
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

/**
 * Decide whether a freshly generated post is a near-duplicate.
 *
 * It is checked twice, tightest first:
 *   - against its siblings (other variants of the same angle-topic) — these are
 *     meant to be about the same thing, so only near-identical text is flagged
 *   - against the ledger (seed posts + earlier standing posts on other topics) —
 *     a looser threshold, because repeating a whole point across topics is the
 *     repetition we actually care about
 *
 * Returns the closest match that crosses a threshold, or null.
 */
export function findDuplicate(input: {
  postEmbedding: number[];
  siblingEmbeddings: EmbeddedPost[];
  ledgerEmbeddings: EmbeddedPost[];
  siblingThreshold: number;
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

  const ledgerMatch = closestAboveThreshold(
    input.postEmbedding,
    input.ledgerEmbeddings,
    input.ledgerThreshold,
  );
  if (ledgerMatch) {
    return {
      ...ledgerMatch,
      reason: `too close to an existing post (similarity ${ledgerMatch.similarity.toFixed(2)})`,
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

/** Seed posts + earlier standing generated posts on other topics, with their vectors. */
export async function loadLedgerEmbeddings(excludeTopicId: string): Promise<EmbeddedPost[]> {
  const ledgerPosts = await dedupLedger({ excludeTopicId });
  return attachEmbeddings(ledgerPosts.map((post) => post.id));
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
