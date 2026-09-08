import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
