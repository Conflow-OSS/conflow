import { loadEnv } from "../config/load.js";
import type { ContentModel } from "../models/types.js";
import { assemblePrompt } from "../prompt/assemble.js";
import { charCount } from "../store/posts.js";
import type { HookStyle, PostFormat, PostStatus } from "../store/types.js";
import { parsePostXml, type ParsedPost } from "./parse.js";

const CHARACTER_BAND_BY_FORMAT: Record<PostFormat, { min: number; max: number }> = {
  short: { min: 300, max: 600 },
  long: { min: 900, max: 1100 },
};

export interface VariantRequest {
  topic: string;
  angle: string;
  lesson: string;
  otherLessons: string[];
  format: PostFormat;
  hookStyle: HookStyle;
  variantNumber: number;
  variantCount: number;
  /** set only for the case-study flow — the model may write from these as real experience */
  sourceFacts?: string;
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
  const summaryMaxChars = loadEnv().SUMMARY_MAX_CHARS;

  const { system, user } = assemblePrompt({
    topic: request.topic,
    angle: request.angle,
    lesson: request.lesson,
    otherLessons: request.otherLessons,
    format: request.format,
    hookStyle: request.hookStyle,
    variantNumber: request.variantNumber,
    variantCount: request.variantCount,
    summaryMaxChars,
    sourceFacts: request.sourceFacts,
  });

  const response = await model.generate({ system, user });
  const parsed = parsePostXml(response.text);
  const lengthCheck = checkLengths(parsed, request.format, summaryMaxChars);

  return {
    parsed,
    status: lengthCheck.status,
    flagReason: lengthCheck.reason,
    modelResponseText: response.text,
  };
}

function checkLengths(
  parsed: ParsedPost,
  format: PostFormat,
  summaryMaxChars: number,
): { status: PostStatus; reason: string | null } {
  const tolerance = loadEnv().LENGTH_TOLERANCE;

  const bodyProblem = outsideBand(charCount(parsed.body), CHARACTER_BAND_BY_FORMAT[format], tolerance);
  if (bodyProblem) {
    return { status: "flag_length", reason: `body ${bodyProblem}` };
  }

  if (parsed.summary !== null) {
    const summaryLimit = Math.round(summaryMaxChars * (1 + tolerance));
    const summaryLength = charCount(parsed.summary);
    if (summaryLength > summaryLimit) {
      return {
        status: "flag_length",
        reason: `summary ${summaryLength} chars — above the ${summaryLimit} card limit`,
      };
    }
  }

  return { status: "ok", reason: null };
}

function outsideBand(
  length: number,
  band: { min: number; max: number },
  tolerance: number,
): string | null {
  const allowedMinimum = Math.round(band.min * (1 - tolerance));
  const allowedMaximum = Math.round(band.max * (1 + tolerance));
  if (length < allowedMinimum) return `${length} chars — below the ${allowedMinimum} minimum`;
  if (length > allowedMaximum) return `${length} chars — above the ${allowedMaximum} maximum`;
  return null;
}
