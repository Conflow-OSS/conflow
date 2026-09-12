import { loadEnv } from "../config/load.js";
import { closeDb } from "../store/db.js";
import { logger } from "../util/logger.js";
import { createApp } from "./app.js";

const env = loadEnv();
const app = await createApp();

const server = app.listen(env.API_PORT, env.API_HOST, () => {
  logger.info("api listening", { host: env.API_HOST, port: env.API_PORT });
});

// server.close() waits for every open connection to finish before its
// callback fires — including a long-lived SSE stream, which can legitimately
// stay open for up to SSE_MAX_DURATION_MS (an hour, by default). Force exit
// after a grace period rather than let Ctrl-C hang on one open connection —
// same fix as the worker's shutdown, and the same reason.
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return; // Ctrl-C can deliver both SIGINT and SIGTERM at once
    shuttingDown = true;
    logger.info("api shutting down", { signal });

    const forceExit = setTimeout(() => {
      logger.warn("graceful shutdown timed out — forcing exit", { graceMs: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);

    server.close(async () => {
      clearTimeout(forceExit);
      await closeDb();
      process.exit(0);
    });
  });
}
