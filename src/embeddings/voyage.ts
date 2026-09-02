import { loadEnv } from "../config/load.js";
import { HttpError, NonRetryableError, retryableHttp } from "../util/http.js";
import { logger } from "../util/logger.js";
import { withRetry } from "../util/retry.js";

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
/** Voyage allows up to 1000 inputs per request; stay well under, and under any token cap. */
const MAX_BATCH = 100;

export type InputType = "document" | "query";

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { total_tokens: number };
}

async function embedBatch(
  texts: string[],
  inputType: InputType,
  signal: AbortSignal,
): Promise<number[][]> {
  const env = loadEnv();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: env.EMBED_MODEL,
      input_type: inputType,
      output_dimension: env.EMBED_DIM,
      truncation: true,
    }),
  });

  if (!res.ok) {
    throw new HttpError(res.status, await res.text().catch(() => ""));
  }

  const json = (await res.json()) as VoyageResponse;
  if (!Array.isArray(json.data) || json.data.length !== texts.length) {
    throw new NonRetryableError(
      `Voyage returned ${json.data?.length ?? 0} embeddings for ${texts.length} inputs`,
    );
  }

  const ordered = json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);

  for (const v of ordered) {
    if (v.length !== env.EMBED_DIM) {
      throw new NonRetryableError(
        `Voyage returned dimension ${v.length}, expected EMBED_DIM=${env.EMBED_DIM} ` +
          `(model ${env.EMBED_MODEL})`,
      );
    }
  }
  return ordered;
}

/**
 * Embed texts, preserving input order. `document` for anything stored (post
 * bodies, seed corpus); `query` for a topic string used to retrieve examples.
 */
export async function embed(texts: string[], inputType: InputType): Promise<number[][]> {
  if (texts.length === 0) return [];
  const env = loadEnv();
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const chunk = texts.slice(i, i + MAX_BATCH);
    const vecs = await withRetry((signal) => embedBatch(chunk, inputType, signal), {
      retries: env.LLM_MAX_RETRIES,
      baseMs: env.RETRY_BASE_MS,
      timeoutMs: env.LLM_TIMEOUT_MS,
      label: `voyage embed [${i}..${i + chunk.length})`,
      shouldRetry: retryableHttp,
    });
    out.push(...vecs);
  }

  logger.info("embedded", { count: out.length, model: env.EMBED_MODEL, input_type: inputType });
  return out;
}

export const embedDocuments = (texts: string[]): Promise<number[][]> => embed(texts, "document");

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embed([text], "query");
  return vec!;
}
