import "dotenv/config";
import { EnvSchema, type Env } from "./schema.js";

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
