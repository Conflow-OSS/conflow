/**
 * Errors the store and pipeline throw when a request can't be honoured. Each
 * carries the HTTP status the API should send; the CLI just lets them surface
 * as ordinary errors. (Transport-level HTTP errors live in `http.ts`.)
 */

export class DomainError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The requested thing does not exist. → 404 */
export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, 404);
  }
}

/** The request is valid but the thing is in a state that does not allow it. → 409 */
export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 409);
  }
}

/** The request itself is malformed or missing something. → 400 */
export class BadRequestError extends DomainError {
  constructor(message: string) {
    super(message, 400);
  }
}

/** The bearer token is missing or wrong. → 401 */
export class UnauthorizedError extends DomainError {
  constructor(message = "missing or invalid bearer token") {
    super(message, 401);
  }
}
