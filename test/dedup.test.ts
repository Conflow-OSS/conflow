import { describe, expect, it } from "vitest";
import { findDuplicate, type EmbeddedPost } from "../src/pipeline/dedup.js";

const ALONG_X: number[] = [1, 0, 0, 0];
const NEAR_X: number[] = [0.97, 0.24, 0, 0]; // ~0.97 cosine with ALONG_X
const ALONG_Y: number[] = [0, 1, 0, 0];

function embedded(postId: string, embedding: number[]): EmbeddedPost {
  return { postId, embedding };
}

describe("findDuplicate", () => {
  it("returns null when nothing is close enough", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [embedded("sib-1", ALONG_Y)],
      ledgerEmbeddings: [embedded("led-1", ALONG_Y)],
      siblingThreshold: 0.93,
      ledgerThreshold: 0.85,
    });
    expect(match).toBeNull();
  });

  it("flags a sibling that crosses the tight threshold", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [embedded("sib-far", ALONG_Y), embedded("sib-near", NEAR_X)],
      ledgerEmbeddings: [],
      siblingThreshold: 0.93,
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
      ledgerEmbeddings: [embedded("led", ALONG_X)],
      siblingThreshold: 0.93,
      ledgerThreshold: 0.85,
    });
    expect(match?.duplicateOfPostId).toBe("sib");
  });

  it("flags a ledger post when the looser threshold is met and siblings are clear", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [],
      ledgerEmbeddings: [embedded("led-near", NEAR_X)],
      siblingThreshold: 0.93,
      ledgerThreshold: 0.85,
    });
    expect(match?.duplicateOfPostId).toBe("led-near");
    expect(match?.reason).toMatch(/existing post/);
  });

  it("returns the closest candidate when several cross the threshold", () => {
    const match = findDuplicate({
      postEmbedding: ALONG_X,
      siblingEmbeddings: [],
      ledgerEmbeddings: [
        embedded("led-near", NEAR_X),
        embedded("led-exact", ALONG_X),
      ],
      siblingThreshold: 0.93,
      ledgerThreshold: 0.85,
    });
    expect(match?.duplicateOfPostId).toBe("led-exact");
  });
});
