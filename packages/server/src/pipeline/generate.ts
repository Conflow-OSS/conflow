import { loadEnv } from "../config/load.js";
import type { ContentModel } from "../models/types.js";
import { assemblePrompt, type PostRequest } from "../prompt/assemble.js";
import { charCount } from "../store/posts.js";
import type { GoldenPostRow, PostFormat, PostStatus } from "../store/types.js";
import { parsePostXml, type ParsedPost } from "./parse.js";

const CHARACTER_BAND_BY_FORMAT: Record<PostFormat, { min: number; max: number }> = {
  short: { min: 300, max: 600 },
  long: { min: 900, max: 1100 },
};

export interface GeneratedPost {
  parsed: ParsedPost;
  status: PostStatus;
  flagReason: string | null;
  modelResponseText: string;
}

/** Assemble the prompt, call the model, parse the result, check its lengths. */
export async function generatePost(
  request: PostRequest,
  model: ContentModel,
  goldenPosts: GoldenPostRow[],
): Promise<GeneratedPost> {
  const env = loadEnv();
  const { system, user } = assemblePrompt(request, goldenPosts);

  const temperature =
    request.mode === "regenerate" ? env.REGENERATE_TEMPERATURE : env.LLM_TEMPERATURE;

  const response = await model.generate({ system, user, temperature });
  const parsed = parsePostXml(response.text);
  const lengthCheck = checkLengths(parsed, request.format, request.summaryMaxChars);

  return {
    parsed,
    status: lengthCheck.status,
    flagReason: lengthCheck.reason,
    modelResponseText: response.text,
  };
}

/** Body/summary length bands, shared with `pipeline/edit.ts` for hand-edited text. */
export function checkLengths(
  content: { body: string; summary: string | null },
  format: PostFormat,
  summaryMaxChars: number,
): { status: PostStatus; reason: string | null } {
  const tolerance = loadEnv().LENGTH_TOLERANCE;

  const bodyProblem = outsideBand(charCount(content.body), CHARACTER_BAND_BY_FORMAT[format], tolerance);
  if (bodyProblem) {
    return { status: "flag_length", reason: `body ${bodyProblem}` };
  }

  if (content.summary !== null) {
    const summaryLimit = Math.round(summaryMaxChars * (1 + tolerance));
    const summaryLength = charCount(content.summary);
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
