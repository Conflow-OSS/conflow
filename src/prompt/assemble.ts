import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HookStyle, PostFormat } from "../store/types.js";

const promptDirectory = import.meta.dirname;

const goldenExampleFileByPlaceholder = {
  "{{GOLDEN_LONG_QUESTIONS}}": "goldens/long-questions.md",
  "{{GOLDEN_LONG_CALLOUT}}": "goldens/long-callout.md",
  "{{GOLDEN_SHORT}}": "goldens/short.md",
};

export interface PostRequest {
  topic: string;
  angle: string;
  format: PostFormat;
  hookStyle: HookStyle;
  variantNumber: number;
  variantCount: number;
  sourceFacts?: string;
  retrievedStyleExamples?: string[];
  siblingPosts?: string[];
  nearDuplicatePosts?: string[];
}

export interface AssembledPrompt {
  system: string;
  user: string;
}

export function assemblePrompt(request: PostRequest): AssembledPrompt {
  return {
    system: buildSystemPrompt(),
    user: buildTaskPrompt(request),
  };
}

function readPromptFile(relativePath: string): string {
  return readFileSync(join(promptDirectory, relativePath), "utf8");
}

function buildSystemPrompt(): string {
  let systemPrompt = readPromptFile("system.md");
  for (const [placeholder, file] of Object.entries(goldenExampleFileByPlaceholder)) {
    const exampleText = readPromptFile(file).trim();
    systemPrompt = systemPrompt.replaceAll(placeholder, exampleText);
  }
  return systemPrompt;
}

function resolveHookStyle(request: PostRequest): string {
  if (request.format === "short") {
    return "n/a";
  }
  return request.hookStyle ?? "questions";
}

function buildTaskPrompt(request: PostRequest): string {
  const valueByPlaceholder: Record<string, string> = {
    "{{topic}}": request.topic,
    "{{angle}}": request.angle,
    "{{format}}": request.format,
    "{{hook_style}}": resolveHookStyle(request),
    "{{k}}": String(request.variantNumber),
    "{{z}}": String(request.variantCount),
    "{{source_facts}}": request.sourceFacts?.trim() || "(none — advisory mode)",
    "{{retrieved_style_examples}}": formatExampleList(request.retrievedStyleExamples, "(none)"),
    "{{sibling_posts}}": formatExampleList(request.siblingPosts, "(none yet)"),
    "{{near_duplicate_context}}": formatExampleList(request.nearDuplicatePosts, "(none)"),
  };

  let taskPrompt = readPromptFile("task.md");
  for (const [placeholder, value] of Object.entries(valueByPlaceholder)) {
    taskPrompt = taskPrompt.replaceAll(placeholder, value);
  }
  return taskPrompt;
}

function formatExampleList(posts: string[] | undefined, textWhenEmpty: string): string {
  if (posts === undefined || posts.length === 0) {
    return textWhenEmpty;
  }
  return posts
    .map((post, index) => `--- ${index + 1} ---\n${post.trim()}`)
    .join("\n\n");
}
