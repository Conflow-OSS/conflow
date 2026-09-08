import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { DomainError } from "../core/errors.js";
import { logger } from "../util/logger.js";

/** Final handler for any request that matched no route. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "not found" });
};

/** Turns thrown errors into JSON responses. Must be registered last. */
export const errorMiddleware: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof DomainError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({ error: "invalid request", details: error.issues });
    return;
  }

  logger.error("api error", {
    method: req.method,
    path: req.path,
    error: error instanceof Error ? error.message : String(error),
  });
  res.status(500).json({ error: "internal error" });
};
