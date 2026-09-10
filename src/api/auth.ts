import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { UnauthorizedError } from "../util/errors.js";

/** Rejects any request whose `Authorization: Bearer <token>` does not match. */
export function bearerAuth(expectedToken: string): RequestHandler {
  const expected = Buffer.from(expectedToken);

  return (req, _res, next) => {
    const header = req.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? Buffer.from(header.slice(7)) : Buffer.alloc(0);

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedError();
    }
    next();
  };
}
