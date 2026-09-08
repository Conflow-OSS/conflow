import { Router } from "express";
import { getDb } from "../../store/db.js";

export const healthRouter = Router();

/** Liveness + a quick DB check. No auth — a load balancer needs to reach it. */
healthRouter.get("/health", (_req, res) => {
  let db = "ok";
  try {
    getDb().prepare("SELECT 1").get();
  } catch {
    db = "error";
  }
  res.status(db === "ok" ? 200 : 503).json({ ok: db === "ok", db });
});
