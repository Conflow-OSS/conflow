import { logger } from "./logger.js";

export interface RetryOptions {
  retries: number;
  /** base backoff in ms; delay is base * 2^attempt + jitter */
  baseMs?: number;
  /** per-attempt timeout; the AbortSignal fires when it elapses */
  timeoutMs?: number;
  label?: string;
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
      if (attempt === retries) break;
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
