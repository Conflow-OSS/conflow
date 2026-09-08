import { Router } from "express";
import { pingRedis } from "../../core/job-queue.js";
import { getDb } from "../../store/db.js";

export const healthRouter = Router();

/**
 * Liveness plus a check of each dependency. No auth — a load balancer needs it.
 * `ok` follows the database (reads still work without Redis); `redis` is reported
 * separately so a client can show that generation is unavailable.
 */
healthRouter.get("/health", async (_req, res) => {
  let db = "ok";
  try {
    getDb().prepare("SELECT 1").get();
  } catch {
    db = "error";
  }

  const redis = (await pingRedis()) ? "ok" : "error";

  res.status(db === "ok" ? 200 : 503).json({ ok: db === "ok", db, redis });
});
