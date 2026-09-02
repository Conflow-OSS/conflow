import { z } from "zod";

/**
 * Every knob the engine reads from the environment. Keys are optional at parse
 * time so schema-only commands (migrate) work without credentials; commands that
 * need a key call the `require*` guards in load.ts.
 */
export const EnvSchema = z.object({
  // generation volume
  GEN_X: z.coerce.number().int().positive().default(6),
  GEN_Y: z.coerce.number().int().positive().default(4),
  GEN_Z: z.coerce.number().int().positive().default(2),
  SHORT_FORM_RATIO: z.coerce.number().min(0).max(1).default(0.35),
  HOOK_SPLIT: z.coerce.number().min(0).max(1).default(0.5),

  // model channel
  MODEL_CHANNEL: z.enum(["zai", "vertex"]).default("zai"),
  MODEL_ID: z.string().min(1).default("glm-4.7"),
  ZAI_API_KEY: z.string().min(1).optional(),
  ZAI_BASE_URL: z.string().url().default("https://api.z.ai/api/paas/v4"),
  VERTEX_PROJECT: z.string().min(1).optional(),
  VERTEX_LOCATION: z.string().min(1).default("us-central1"),

  // embeddings
  VOYAGE_API_KEY: z.string().min(1).optional(),
  EMBED_MODEL: z.string().min(1).default("voyage-3.5-lite"),
  EMBED_DIM: z.coerce.number().int().positive().default(1024),

  // dedup / validation
  DEDUP_LEDGER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  DEDUP_SIBLING_THRESHOLD: z.coerce.number().min(0).max(1).default(0.93),
  LENGTH_TOLERANCE: z.coerce.number().min(0).max(1).default(0.15),

  // paths / runtime
  DB_PATH: z.string().min(1).default("./data/content.db"),
  EXPORT_DIR: z.string().min(1).default("./data/exports"),
  LLM_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = Readonly<z.infer<typeof EnvSchema>>;
