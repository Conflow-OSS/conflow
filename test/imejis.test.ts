import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.IMEJIS_API_KEY = "test-key";
process.env.IMEJIS_DESIGN_ID = "designABC";
process.env.CARD_IMAGE_FORMAT = "png";
process.env.LLM_MAX_RETRIES = "2";
process.env.RETRY_BASE_MS = "1";
process.env.LLM_TIMEOUT_MS = "1000";
process.env.LOG_LEVEL = "error";

const { renderCard, cardContentType } = await import("../src/cards/imejis.js");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function pngResponse(): Response {
  return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3]), { status: 200 });
}

describe("renderCard", () => {
  it("posts the summary to the template endpoint with the api-key header", async () => {
    fetchMock.mockResolvedValueOnce(pngResponse());

    const bytes = await renderCard("Require one approved review before any merge.");

    expect(bytes).toBeInstanceOf(Buffer);
    expect(bytes.length).toBe(7);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://render.imejis.io/v1/designABC?format=png");
    expect((init as RequestInit).headers).toMatchObject({ "dma-api-key": "test-key" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      summary: { text: "Require one approved review before any merge." },
    });
  });

  it("retries a 500 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("upstream", { status: 500 }))
      .mockResolvedValueOnce(pngResponse());

    await expect(renderCard("x")).resolves.toBeInstanceOf(Buffer);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(renderCard("x")).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the content type from the configured format", () => {
    expect(cardContentType()).toBe("image/png");
  });
});
