import cors from "cors";
import express, { type Express, Router } from "express";
import { loadEnv, requireApiToken } from "../config/load.js";
import { migrate } from "../store/migrate.js";
import { logger } from "../util/logger.js";
import { bearerAuth } from "./auth.js";
import { errorMiddleware, notFoundHandler } from "./error-middleware.js";
import { healthRouter } from "./routes/health.js";
import { jobsRouter } from "./routes/jobs.js";
import { postsRouter } from "./routes/posts.js";
import { runsRouter } from "./routes/runs.js";
import { statsRouter } from "./routes/stats.js";

/** Build the Express app. Kept separate from `server.ts` so tests can drive it in-process. */
export function createApp(): Express {
  const env = loadEnv();
  const token = requireApiToken(env);
  migrate();

  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(cors({ origin: env.API_CORS_ORIGIN }));
  app.use(requestLogger);

  app.use(healthRouter);

  const v1 = Router();
  v1.use(bearerAuth(token));
  v1.use(runsRouter);
  v1.use(postsRouter);
  v1.use(jobsRouter);
  v1.use(statsRouter);
  app.use("/v1", v1);

  app.use(notFoundHandler);
  app.use(errorMiddleware);
  return app;
}

const requestLogger: express.RequestHandler = (req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    logger.debug("api request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - startedAt,
    });
  });
  next();
};
