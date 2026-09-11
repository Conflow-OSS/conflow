import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// config/load.ts does `import "dotenv/config"`, which loads the real project
// .env file as a side effect — including whatever API_TOKEN the developer has
// set there for their own local testing. This test needs API_TOKEN to be
// genuinely absent, so it mocks dotenv's load away rather than trying to
// "unset" it (deleting it doesn't help: dotenv only skips a key that's
// already present on process.env, so a deleted key looks absent again and
// gets reloaded from the file; and API_TOKEN="" doesn't help either, since
// the schema is z.string().min(1).optional() — present-but-empty fails
// validation entirely, a different error than the one under test here).
vi.mock("dotenv/config", () => ({}));

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "content-engine-api-boot-")), "boot.db");
process.env.EMBED_DIM = "8";
process.env.LOG_LEVEL = "error";
delete process.env.API_TOKEN;

const { createApp } = await import("../src/api/app.js");

describe("createApp", () => {
  it("refuses to start without API_TOKEN", () => {
    expect(() => createApp()).toThrow(/API_TOKEN is required/);
  });
});
