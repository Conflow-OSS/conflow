import { loadEnv } from "../config/load.js";
import { openaiChat } from "./openai-chat.js";
import type { ContentModel, GenerateArgs, GenerateResult } from "./types.js";

/** Z.ai (Zhipu) GLM — OpenAI-compatible /chat/completions. */
export class ZaiModel implements ContentModel {
  readonly channel = "zai" as const;
  readonly model = loadEnv().MODEL_ID;

  async generate(args: GenerateArgs): Promise<GenerateResult> {
    const env = loadEnv();
    return openaiChat({
      channel: "zai",
      model: this.model,
      url: `${env.ZAI_BASE_URL.replace(/\/+$/, "")}/chat/completions`,
      headers: () => ({ authorization: `Bearer ${env.ZAI_API_KEY}` }),
      system: args.system,
      user: args.user,
      temperature: args.temperature ?? 0.8,
      maxTokens: args.maxTokens ?? env.LLM_MAX_TOKENS,
    });
  }
}
