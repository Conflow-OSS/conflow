import { loadEnv } from "../config/load.js";
import { HttpError } from "../util/http.js";
import { apiRetry, withRetry } from "../util/retry.js";

const RENDER_BASE_URL = "https://render.imejis.io/v1";

/**
 * Render one card from the Imejis template and return the image bytes.
 *
 * The request body is keyed by template layer name. We only override the
 * `summary` text layer; every other layer (background, artwork) keeps its
 * template default because we leave it out of the body. Imejis expects the
 * layer value as an object, so a bare string will not take effect.
 */
export async function renderCard(summary: string): Promise<Buffer> {
  const env = loadEnv();
  if (!env.IMEJIS_API_KEY) {
    throw new Error("IMEJIS_API_KEY is required to render cards");
  }

  const url = `${RENDER_BASE_URL}/${env.IMEJIS_DESIGN_ID}?format=${env.CARD_IMAGE_FORMAT}`;

  return withRetry(async (signal) => {
    const response = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "dma-api-key": env.IMEJIS_API_KEY!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ summary: { text: summary } }),
    });

    if (!response.ok) {
      throw new HttpError(response.status, await response.text().catch(() => ""));
    }
    return Buffer.from(await response.arrayBuffer());
  }, apiRetry("imejis render"));
}

export function cardContentType(): string {
  return `image/${loadEnv().CARD_IMAGE_FORMAT}`;
}
