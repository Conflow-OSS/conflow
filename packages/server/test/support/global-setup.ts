import { TEST_DATABASE_URL, TEST_EMBED_DIM } from "./test-db.js";

/**
 * Runs once, in its own process, before any test file loads — vitest's
 * globalSetup contract. Migrations no longer run implicitly inside app code
 * (see src/store/migrate.ts), so the shared test database needs this same
 * explicit "migrate once, up front" step real deploys use, or every DB-backed
 * test would fail against a schema-less content_engine_test.
 */
export async function setup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.EMBED_DIM = TEST_EMBED_DIM;

  const { migrate } = await import("../../src/store/migrate.js");
  await migrate();

  const { closeDb } = await import("../../src/store/db.js");
  await closeDb();
}
