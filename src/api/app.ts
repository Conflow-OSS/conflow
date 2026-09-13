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
import { seedRouter } from "./routes/seed.js";
import { seedPostsRouter } from "./routes/seed-posts.js";
import { statsRouter } from "./routes/stats.js";
import { topicsRouter } from "./routes/topics.js";

/** Build the Express app. Kept separate from `server.ts` so tests can drive it in-process. */
export async function createApp(): Promise<Express> {
  const env = loadEnv();
  const token = requireApiToken(env);
  await migrate();

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
  v1.use(seedRouter);
  v1.use(seedPostsRouter);
  v1.use(statsRouter);
  v1.use(topicsRouter);
  app.use("/v1", v1);

  app.use(notFoundHandler);
  app.use(errorMiddleware);
  return app;
}

const requestLogger: express.RequestHandler = (req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    // info, not debug: an access log is something you want by default, not
    // only when LOG_LEVEL=debug. The timestamp is automatic — every log line
    // carries one (see util/logger.ts's emit()).
    logger.info("api request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - startedAt,
    });
  });
  next();
};
