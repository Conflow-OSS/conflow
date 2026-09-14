import { loadEnv } from "../config/load.js";
import { retryableHttp } from "./http.js";
import { logger } from "./logger.js";

export interface RetryOptions {
  retries: number;
  /** base backoff in ms; delay is base * 2^attempt + jitter */
  baseMs?: number;
  /** per-attempt timeout; the AbortSignal fires when it elapses */
  timeoutMs?: number;
  label?: string;
  /** return false to stop retrying a given error (defaults to always retry) */
  shouldRetry?: (err: unknown) => boolean;
}

/**
 * Run `fn` with exponential backoff. `fn` receives an AbortSignal that trips on
 * the per-attempt timeout — pass it to fetch so a hung request doesn't wedge the run.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { retries, baseMs = 500, timeoutMs, label = "op" } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = timeoutMs
      ? setTimeout(() => ac.abort(new Error(`${label}: timeout after ${timeoutMs}ms`)), timeoutMs)
      : undefined;
    try {
      return await fn(ac.signal);
    } catch (err) {
      lastErr = err;
      const retryable = opts.shouldRetry ? opts.shouldRetry(err) : true;
      if (attempt === retries || !retryable) break;
      const delay = Math.round(baseMs * 2 ** attempt + Math.random() * baseMs);
      logger.warn(`${label}: attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Standard retry policy for outbound API calls: env-tuned backoff + retry only transient failures. */
export function apiRetry(label: string): RetryOptions {
  const env = loadEnv();
  return {
    retries: env.LLM_MAX_RETRIES,
    baseMs: env.RETRY_BASE_MS,
    timeoutMs: env.LLM_TIMEOUT_MS,
    label,
    shouldRetry: retryableHttp,
  };
}
