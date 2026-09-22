import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GoldenPostRow, HookStyle, PostFormat } from "../store/types.js";

const promptDirectory = import.meta.dirname;

/** The fields both a first draft and a revision need. */
interface CommonFields {
  topic: string;
  angle: string;
  lesson: string;
  format: PostFormat;
  hookStyle: HookStyle;
  variantNumber: number;
  variantCount: number;
  summaryMaxChars: number;
  /** the other lessons under this angle — sibling posts cover these, this one must not */
  otherLessons: string[];
  sourceFacts?: string;
  retrievedStyleExamples?: string[];
}

export type PostRequest =
  | (CommonFields & { mode: "generate" })
  | (CommonFields & {
      mode: "regenerate";
      /** why the previous attempt at this slot was rejected */
      flagReason: string;
      /** the post it was flagged as too close to, if it was a duplicate */
      collidedWith?: { body: string; similarity: number };
    });

export interface AssembledPrompt {
  system: string;
  user: string;
}

export function assemblePrompt(request: PostRequest, goldenPosts: GoldenPostRow[]): AssembledPrompt {
  return {
    system: buildSystemPrompt(goldenPosts),
    user: buildUserPrompt(request),
  };
}

function readPromptFile(relativePath: string): string {
  return readFileSync(join(promptDirectory, relativePath), "utf8");
}

function fillTemplate(template: string, valueByPlaceholder: Record<string, string>): string {
  let filled = template;
  for (const [placeholder, value] of Object.entries(valueByPlaceholder)) {
    filled = filled.replaceAll(placeholder, value);
  }
  return filled;
}

function buildSystemPrompt(goldenPosts: GoldenPostRow[]): string {
  const systemPrompt = readPromptFile("system.md");
  return systemPrompt.replaceAll("{{GOLDEN_EXAMPLES}}", renderGoldenExamples(goldenPosts));
}

function renderGoldenExamples(goldenPosts: GoldenPostRow[]): string {
  return goldenPosts
    .map(
      (golden) =>
        `<example format="${golden.format}" hook="${golden.hook_style ?? "n/a"}">\n${golden.body.trim()}\n</example>`,
    )
    .join("\n");
}

function buildUserPrompt(request: PostRequest): string {
  const context = fillTemplate(readPromptFile("task-context.md"), contextValues(request));
  const task =
    request.mode === "regenerate"
      ? fillTemplate(readPromptFile("task-regenerate.md"), regenerateValues(request))
      : fillTemplate(readPromptFile("task-generate.md"), generateValues(request));
  return `${context.trim()}\n\n${task.trim()}\n`;
}

function contextValues(request: PostRequest): Record<string, string> {
  return {
    "{{topic}}": request.topic,
    "{{angle}}": request.angle,
    "{{lesson}}": request.lesson,
    "{{format}}": request.format,
    "{{hook_style}}": resolveHookStyle(request),
    "{{k}}": String(request.variantNumber),
    "{{z}}": String(request.variantCount),
    "{{summary_max_chars}}": String(request.summaryMaxChars),
    "{{source_facts}}": request.sourceFacts?.trim() || "(none — advisory mode)",
    "{{retrieved_style_examples}}": formatExampleList(request.retrievedStyleExamples, "(none)"),
  };
}

function generateValues(request: PostRequest): Record<string, string> {
  return {
    "{{other_lessons}}": formatBulletList(request.otherLessons, "(none)"),
  };
}

function regenerateValues(
  request: CommonFields & { mode: "regenerate"; flagReason: string; collidedWith?: { body: string; similarity: number } },
): Record<string, string> {
  return {
    "{{flag_reason}}": request.flagReason,
    "{{collision_block}}": renderCollisionBlock(request.collidedWith),
    "{{other_lessons}}": formatBulletList(request.otherLessons, "(none)"),
  };
}

function renderCollisionBlock(
  collidedWith: { body: string; similarity: number } | undefined,
): string {
  if (collidedWith === undefined) {
    return "";
  }
  return (
    `\nIt was too close (similarity ${collidedWith.similarity.toFixed(2)}) to this existing ` +
    `post — take a clearly different angle of attack from it:\n\n` +
    `--- the post you were too close to ---\n${collidedWith.body.trim()}\n--- end ---\n`
  );
}

function resolveHookStyle(request: PostRequest): string {
  if (request.format === "short") {
    return "n/a";
  }
  return request.hookStyle ?? "questions";
}

function formatBulletList(items: string[] | undefined, textWhenEmpty: string): string {
  if (items === undefined || items.length === 0) {
    return textWhenEmpty;
  }
  return items.map((item) => `- ${item.trim()}`).join("\n");
}

function formatExampleList(posts: string[] | undefined, textWhenEmpty: string): string {
  if (posts === undefined || posts.length === 0) {
    return textWhenEmpty;
  }
  return posts.map((post, index) => `--- ${index + 1} ---\n${post.trim()}`).join("\n\n");
}
