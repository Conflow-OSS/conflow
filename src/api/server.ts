import { loadEnv } from "../config/load.js";
import { closeDb } from "../store/db.js";
import { logger } from "../util/logger.js";
import { createApp } from "./app.js";

const env = loadEnv();
const app = createApp();

const server = app.listen(env.API_PORT, env.API_HOST, () => {
  logger.info("api listening", { host: env.API_HOST, port: env.API_PORT });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("api shutting down", { signal });
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}
