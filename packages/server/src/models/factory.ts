import { loadEnv, requireModel } from "../config/load.js";
import type { ContentModel } from "./types.js";
import { VertexModel } from "./vertex.js";
import { ZaiModel } from "./zai.js";

/** The generation model for the configured channel. Throws if its credentials are missing. */
export function getModel(): ContentModel {
  const env = loadEnv();
  requireModel(env);
  return env.MODEL_CHANNEL === "vertex" ? new VertexModel() : new ZaiModel();
}
