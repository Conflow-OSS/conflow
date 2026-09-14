import { describe, expect, it, vi } from "vitest";

// config/load.ts calls dotenv's config() (resolved relative to its own file,
// not process.cwd(), so `npx content ...` works from any directory), which
// loads the real project .env file as a side effect — including whatever
// API_TOKEN the developer has set there for their own local testing. This
// test needs API_TOKEN to be genuinely absent, so it mocks that load away
// rather than trying to "unset" it (deleting it doesn't help: dotenv only
// skips a key that's already present on process.env, so a deleted key looks
// absent again and gets reloaded from the file; and API_TOKEN="" doesn't
// help either, since the schema is z.string().min(1).optional() —
// present-but-empty fails validation entirely, a different error than the
// one under test here).
vi.mock("dotenv", () => ({ config: () => ({}) }));

process.env.LOG_LEVEL = "error";
delete process.env.API_TOKEN;

const { createApp } = await import("../src/api/app.js");

describe("createApp", () => {
  it("refuses to start without API_TOKEN", async () => {
    // requireApiToken() throws before createApp() ever reaches migrate(), so
    // this never touches the database — no DB env needed. createApp() is
    // async now, so the failure surfaces as a rejected promise, not a
    // synchronous throw.
    await expect(createApp()).rejects.toThrow(/API_TOKEN is required/);
  });
});
