import { HttpError } from "../util/http.js";
import { apiRetry, withRetry } from "../util/retry.js";
import type { Channel, GenerateResult } from "./types.js";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

export interface ChatCall {
  channel: Channel;
  model: string;
  url: string;
  /** resolved per attempt, so an auth token can be refreshed on retry */
  headers: () => Promise<Record<string, string>> | Record<string, string>;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
}

/** POST an OpenAI-shaped /chat/completions request with the standard retry policy. */
export async function openaiChat(c: ChatCall): Promise<GenerateResult> {
  const body = JSON.stringify({
    model: c.model,
    messages: [
      { role: "system", content: c.system },
      { role: "user", content: c.user },
    ],
    temperature: c.temperature,
    max_tokens: c.maxTokens,
  });

  const json = await withRetry(async (signal) => {
    const headers = { "content-type": "application/json", ...(await c.headers()) };
    const res = await fetch(c.url, { method: "POST", signal, headers, body });
    if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ""));
    return (await res.json()) as ChatResponse;
  }, apiRetry(`${c.channel} chat`));

  const choice = json.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) {
    const detail = typeof json.error === "string" ? json.error : json.error?.message;
    throw new Error(`${c.channel}: empty completion${detail ? ` (${detail})` : ""}`);
  }

  return {
    text,
    channel: c.channel,
    model: c.model,
    finishReason: choice?.finish_reason,
    usage: {
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
    },
  };
}
