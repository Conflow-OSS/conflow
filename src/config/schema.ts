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
  MODEL_CHANNEL: z.enum(["zai", "vertex"]).default("vertex"),
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
  SUMMARY_MAX_CHARS: z.coerce.number().int().positive().default(180),

  // paths / runtime
  DB_PATH: z.string().min(1).default("./data/content.db"),
  EXPORT_DIR: z.string().min(1).default("./data/exports"),

  // http api
  API_PORT: z.coerce.number().int().positive().default(8787),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_TOKEN: z.string().min(1).optional(),
  API_CORS_ORIGIN: z.string().min(1).default("*"),

  // job queue (BullMQ) + worker
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),

  // image cards
  IMEJIS_API_KEY: z.string().min(1).optional(),
  IMEJIS_DESIGN_ID: z.string().min(1).default("sbOUjiAfOhsl7UfKBtuqU"),
  CARD_IMAGE_FORMAT: z.enum(["png", "jpeg", "webp"]).default("png"),
  CARD_BATCH_LIMIT: z.coerce.number().int().positive().default(10),
  CARD_RENDER_DELAY_MS: z.coerce.number().int().nonnegative().default(1100),
  IMAGE_STORE: z.enum(["minio", "disk"]).default("minio"),
  CARD_DIR: z.string().min(1).default("./data/cards"),

  // object storage (MinIO / any S3-compatible)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1).default("content-cards"),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_PUBLIC_URL_BASE: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  S3_PUBLIC_READ: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  LLM_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(20_000),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.8),
  REGENERATE_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.9),
  RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = Readonly<z.infer<typeof EnvSchema>>;
