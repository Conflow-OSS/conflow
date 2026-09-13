import { describe, expect, it } from "vitest";
import { findDuplicate, type EmbeddedPost, type LedgerCandidate } from "../src/pipeline/dedup.js";

const ALONG_X: number[] = [1, 0, 0, 0];
const NEAR_X: number[] = [0.97, 0.24, 0, 0]; // ~0.97 cosine with ALONG_X

function embedded(postId: string, embedding: number[]): EmbeddedPost {
  return { postId, embedding };
}

function ledgerMatch(postId: string, similarity: number): LedgerCandidate {
  return { postId, similarity };
}

describe("findDuplicate", () => {
  it("returns null when nothing is close enough", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [],
      siblingThreshold: 0.93,
      ledgerMatch: ledgerMatch("led-1", 0.1),
      ledgerThreshold: 0.85,
    });
    expect(match).toBeNull();
  });

  it("flags a sibling that crosses the tight threshold", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [embedded("sib-near", NEAR_X)],
      siblingThreshold: 0.93,
      ledgerMatch: null,
      ledgerThreshold: 0.85,
    });
    expect(match?.duplicateOfPostId).toBe("sib-near");
    expect(match?.similarity).toBeGreaterThan(0.93);
    expect(match?.reason).toMatch(/sibling/);
  });

  it("checks siblings before the ledger", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [embedded("sib", NEAR_X)],
      siblingThreshold: 0.93,
      ledgerMatch: ledgerMatch("led", 1),
      ledgerThreshold: 0.85,
    });
    expect(match?.duplicateOfPostId).toBe("sib");
  });

  it("flags a ledger match when the looser threshold is met and siblings are clear", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [],
      siblingThreshold: 0.93,
      ledgerMatch: ledgerMatch("led-near", 0.9),
      ledgerThreshold: 0.85,
    });
    expect(match?.duplicateOfPostId).toBe("led-near");
    expect(match?.similarity).toBe(0.9);
    expect(match?.reason).toMatch(/existing post/);
  });

  it("does not flag a ledger match that falls short of the threshold", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [],
      siblingThreshold: 0.93,
      ledgerMatch: ledgerMatch("led-close", 0.8),
      ledgerThreshold: 0.85,
    });
    expect(match).toBeNull();
  });

  it("returns the closest sibling when several cross the threshold", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [embedded("sib-near", NEAR_X), embedded("sib-exact", ALONG_X)],
      siblingThreshold: 0.93,
      ledgerMatch: null,
      ledgerThreshold: 0.85,
    });
    expect(match?.duplicateOfPostId).toBe("sib-exact");
  });
});
