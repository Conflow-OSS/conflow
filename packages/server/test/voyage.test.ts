import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.VOYAGE_API_KEY = "test-key";
process.env.EMBED_MODEL = "voyage-3.5-lite";
process.env.EMBED_DIM = "4";
process.env.LLM_MAX_RETRIES = "2";
process.env.LLM_TIMEOUT_MS = "1000";
process.env.RETRY_BASE_MS = "1";
process.env.LOG_LEVEL = "error";

const { embed, embedDocuments } = await import("../src/embeddings/voyage.js");

function ok(embeddings: number[][], shuffle = false): Response {
  let data = embeddings.map((embedding, index) => ({ embedding, index }));
  if (shuffle) data = data.slice().reverse();
  return new Response(JSON.stringify({ data, usage: { total_tokens: 10 } }), { status: 200 });
}

const dim4 = (n: number) => [n, n + 0.1, n + 0.2, n + 0.3];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("voyage embed", () => {
  it("returns vectors in input order even when the API reorders them", async () => {
    fetchMock.mockResolvedValueOnce(ok([dim4(0), dim4(1), dim4(2)], true));
    const out = await embed(["a", "b", "c"], "document");
    expect(out).toEqual([dim4(0), dim4(1), dim4(2)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.input_type).toBe("document");
    expect(body.output_dimension).toBe(4);
  });

  it("splits >100 inputs across requests and concatenates in order", async () => {
    const texts = Array.from({ length: 150 }, (_, i) => `t${i}`);
    fetchMock
      .mockResolvedValueOnce(ok(texts.slice(0, 100).map((_, i) => dim4(i))))
      .mockResolvedValueOnce(ok(texts.slice(100).map((_, i) => dim4(100 + i))));
    const out = await embedDocuments(texts);
    expect(out).toHaveLength(150);
    expect(out[0]).toEqual(dim4(0));
    expect(out[149]).toEqual(dim4(149));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a dimension mismatch", async () => {
    fetchMock.mockResolvedValueOnce(ok([[1, 2, 3]]));
    await expect(embed(["x"], "document")).rejects.toThrow(/dimension 3, expected EMBED_DIM=4/);
  });

  it("retries a 500 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("upstream", { status: 500 }))
      .mockResolvedValueOnce(ok([dim4(7)]));
    const out = await embed(["x"], "query");
    expect(out).toEqual([dim4(7)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    fetchMock.mockResolvedValue(new Response("bad input", { status: 400 }));
    await expect(embed(["x"], "document")).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
