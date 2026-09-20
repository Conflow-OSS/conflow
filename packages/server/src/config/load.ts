import { config as loadDotenv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EnvSchema, type Env } from "./schema.js";

// Plain `dotenv/config` reads .env relative to process.cwd() — fine when the
// CLI is run from packages/server, wrong (silently no-ops) when it's run
// from anywhere else, e.g. `npx content ...` from the repo root. Resolve
// .env relative to this file's own location instead: two levels up from
// config/load.ts (dev, via tsx) or dist/config/load.js (built) both land on
// packages/server/.env.
loadDotenv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env") });

let cached: Env | null = null;

/** Parse + validate the environment once, then hand back the frozen result. */
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    console.error("Invalid environment:\n" + lines.join("\n"));
    process.exit(1);
  }
  cached = Object.freeze(parsed.data);
  return cached;
}

/** Test hook — drop the memoised env so the next loadEnv() re-reads process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export function requireVoyage(env: Env): void {
  if (!env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY is required for this command");
  }
}

export function requireModel(env: Env): void {
  if (env.MODEL_CHANNEL === "zai" && !env.ZAI_API_KEY) {
    throw new Error("ZAI_API_KEY is required when MODEL_CHANNEL=zai");
  }
  if (env.MODEL_CHANNEL === "vertex" && !env.VERTEX_PROJECT) {
    throw new Error("VERTEX_PROJECT is required when MODEL_CHANNEL=vertex");
  }
}

export function requireApiToken(env: Env): string {
  if (!env.API_TOKEN) {
    throw new Error("API_TOKEN is required to run the API server — set it in .env");
  }
  return env.API_TOKEN;
}
