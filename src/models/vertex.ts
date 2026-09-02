import { GoogleAuth } from "google-auth-library";
import { loadEnv } from "../config/load.js";
import { openaiChat } from "./openai-chat.js";
import type { ContentModel, GenerateArgs, GenerateResult } from "./types.js";

let cachedAuth: GoogleAuth | null = null;
function googleAuth(): GoogleAuth {
  cachedAuth ??= new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return cachedAuth;
}

/**
 * OpenAI-compatible surface for Model Garden / MaaS models. Note: the `openapi`
 * endpoint lives under v1beta1, and MaaS model ids look like `zai-org/glm-4.7-maas`.
 */
export function chatUrl(project: string, location: string): string {
  const host =
    location === "global"
      ? "aiplatform.googleapis.com"
      : `${location}-aiplatform.googleapis.com`;
  return (
    `https://${host}/v1beta1/projects/${project}/locations/${location}` +
    `/endpoints/openapi/chat/completions`
  );
}

/** GLM (and other Model Garden models) on Vertex AI, authenticated via ADC. */
export class VertexModel implements ContentModel {
  readonly channel = "vertex" as const;
  readonly model = loadEnv().MODEL_ID;

  async generate(args: GenerateArgs): Promise<GenerateResult> {
    const env = loadEnv();
    return openaiChat({
      channel: "vertex",
      model: this.model,
      url: chatUrl(env.VERTEX_PROJECT!, env.VERTEX_LOCATION),
      headers: async () => {
        const token = await googleAuth().getAccessToken();
        if (!token) {
          throw new Error(
            "Vertex: ADC returned no access token — run `gcloud auth application-default login`",
          );
        }
        return { authorization: `Bearer ${token}` };
      },
      system: args.system,
      user: args.user,
      temperature: args.temperature ?? 0.8,
      maxTokens: args.maxTokens ?? 4096,
    });
  }
}
