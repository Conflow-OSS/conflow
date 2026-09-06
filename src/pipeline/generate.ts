import { loadEnv } from "../config/load.js";
import type { ContentModel } from "../models/types.js";
import { assemblePrompt } from "../prompt/assemble.js";
import { charCount } from "../store/posts.js";
import type { HookStyle, PostFormat, PostStatus } from "../store/types.js";
import { parsePostXml, type ParsedPost } from "./parse.js";

const CHARACTER_BAND_BY_FORMAT: Record<PostFormat, { min: number; max: number }> = {
  short: { min: 300, max: 600 },
  long: { min: 900, max: 1600 },
};

export interface VariantRequest {
  topic: string;
  angle: string;
  format: PostFormat;
  hookStyle: HookStyle;
  variantNumber: number;
  variantCount: number;
  previousVariantBodies: string[];
}

export interface GeneratedVariant {
  parsed: ParsedPost;
  status: PostStatus;
  flagReason: string | null;
  modelResponseText: string;
}

export async function generateOneVariant(
  request: VariantRequest,
  model: ContentModel,
): Promise<GeneratedVariant> {
  const { system, user } = assemblePrompt({
    topic: request.topic,
    angle: request.angle,
    format: request.format,
    hookStyle: request.hookStyle,
    variantNumber: request.variantNumber,
    variantCount: request.variantCount,
    siblingPosts: request.previousVariantBodies,
  });

  const response = await model.generate({ system, user });
  const parsed = parsePostXml(response.text);
  const lengthCheck = checkPostLength(parsed.body, request.format);

  return {
    parsed,
    status: lengthCheck.status,
    flagReason: lengthCheck.reason,
    modelResponseText: response.text,
  };
}

function checkPostLength(
  body: string,
  format: PostFormat,
): { status: PostStatus; reason: string | null } {
  const band = CHARACTER_BAND_BY_FORMAT[format];
  const tolerance = loadEnv().LENGTH_TOLERANCE;
  const allowedMinimum = Math.round(band.min * (1 - tolerance));
  const allowedMaximum = Math.round(band.max * (1 + tolerance));
  const length = charCount(body);

  if (length < allowedMinimum) {
    return { status: "flag_length", reason: `${length} chars — below the ${allowedMinimum} minimum` };
  }
  if (length > allowedMaximum) {
    return { status: "flag_length", reason: `${length} chars — above the ${allowedMaximum} maximum` };
  }
  return { status: "ok", reason: null };
}
