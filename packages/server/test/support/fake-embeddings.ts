/**
 * A deterministic stand-in for a real embedding model: identical text always
 * gives the identical vector, and any two different strings give vectors that
 * are essentially unrelated (cosine near zero). 16 dimensions.
 *
 * Use it in a test file like:
 *
 *   vi.mock("../src/embeddings/voyage.js", async () => {
 *     const { textToVector } = await import("./support/fake-embeddings.js");
 *     return {
 *       embedDocuments: async (texts: string[]) => texts.map(textToVector),
 *       embedQuery: async (text: string) => textToVector(text),
 *     };
 *   });
 */
export function textToVector(text: string): number[] {
  let seed = 5381;
  for (let i = 0; i < text.length; i++) {
    seed = ((seed << 5) + seed + text.charCodeAt(i)) >>> 0;
  }

  const vector: number[] = [];
  for (let dimension = 0; dimension < 16; dimension++) {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    vector.push(seed / 0xffffffff - 0.5);
  }
  return vector;
}
