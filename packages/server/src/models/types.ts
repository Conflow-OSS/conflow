export type Channel = "zai" | "vertex";

export interface GenerateArgs {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  channel: Channel;
  model: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/**
 * One text generation. Adapters own their own retry/backoff and timeout, so a
 * caller just awaits `generate()` and gets text or a thrown error.
 */
export interface ContentModel {
  readonly channel: Channel;
  readonly model: string;
  generate(args: GenerateArgs): Promise<GenerateResult>;
}
