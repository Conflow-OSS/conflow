/** Thrown by API clients on a non-2xx response, carrying the status for retry logic. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/** A deterministic failure (bad response shape, config mismatch) — retrying won't help. */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Retry network/abort errors and transient HTTP statuses; give up on 4xx and deterministic failures. */
export function retryableHttp(err: unknown): boolean {
  if (err instanceof NonRetryableError) return false;
  if (err instanceof HttpError) return isRetryableStatus(err.status);
  return true;
}
