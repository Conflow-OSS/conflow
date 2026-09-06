/**
 * Voice check. Runs topics through the real assembled prompt on the configured
 * channel (MODEL_CHANNEL / MODEL_ID in .env) and writes each result to
 * data/voice-eval/ for Prince to read.
 *
 *   npx tsx scripts/voice-eval.ts                       # the 10 built-in topics
 *   npx tsx scripts/voice-eval.ts --topics my.jsonl     # your own topics
 *   npx tsx scripts/voice-eval.ts --only 1,4,7          # a subset
 *
 * A topics file is JSON Lines, one object per line:
 *   {"topic":"...", "angle":"...", "format":"long", "hook":"questions"}
 *   format: "short" | "long"      hook: "questions" | "callout" | "n/a"
 *
 * Not part of the CLI — a throwaway to judge whether a model holds the voice.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/load.js";
import { getModel } from "../src/models/factory.js";
import { assemblePrompt } from "../src/prompt/assemble.js";
import type { HookStyle } from "../src/store/types.js";
import { logger } from "../src/util/logger.js";

const OUT = "data/voice-eval";

type Case = {
  topic: string;
  angle: string;
  format: "short" | "long";
  hook: "questions" | "callout" | "n/a";
};

const BUILTIN: Case[] = [
  { topic: "Right-sizing pod requests and limits on Kubernetes", angle: "avoiding node contention and noisy-neighbour throttling", format: "long", hook: "questions" },
  { topic: "Setting SLOs and error budgets for customer-facing services", angle: "replacing 'we think it's 99.9%' with a measured number", format: "long", hook: "callout" },
  { topic: "Distributed tracing across microservices", angle: "cutting mean-time-to-detect during a multi-service incident", format: "long", hook: "questions" },
  { topic: "Infrastructure as Code with Terraform + Terragrunt", angle: "keeping staging and prod from drifting apart", format: "long", hook: "callout" },
  { topic: "Quality gates in CI/CD pipelines", angle: "stopping unreviewed changes from reaching prod", format: "short", hook: "n/a" },
  { topic: "Centralised logging with Loki on object storage", angle: "keeping 90 days of logs without a huge bill", format: "short", hook: "n/a" },
  { topic: "PodDisruptionBudgets and multi-zone replicas", angle: "surviving a zone failure without downtime", format: "long", hook: "callout" },
  { topic: "Container image scanning with Trivy in the pipeline", angle: "catching a critical CVE before it ships", format: "short", hook: "n/a" },
  { topic: "Private access to internal cloud resources with a mesh VPN", angle: "reaching internal DBs and APIs without exposing them", format: "long", hook: "questions" },
  { topic: "On-call and incident response with PagerDuty", angle: "responding before the customer notices", format: "short", hook: "n/a" },
];

function loadCases(file: string): Case[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .map((line, lineIndex) => {
      const parsed = JSON.parse(line) as Partial<Case>;
      if (!parsed.topic) throw new Error(`line ${lineIndex + 1}: missing "topic"`);
      const format = parsed.format ?? "long";
      return {
        topic: parsed.topic,
        angle: parsed.angle ?? "",
        format,
        hook: parsed.hook ?? (format === "short" ? "n/a" : "questions"),
      };
    });
}

function parseOnly(spec: string, caseCount: number): Set<number> {
  const selected = new Set<number>();
  for (const part of spec.split(",")) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]); n++) selected.add(n);
    } else {
      selected.add(Number(part));
    }
  }
  return new Set([...selected].filter((n) => n >= 1 && n <= caseCount));
}

function toHookStyle(hook: Case["hook"]): HookStyle {
  return hook === "n/a" ? null : hook;
}

async function main() {
  const { values } = parseArgs({ options: { topics: { type: "string" }, only: { type: "string" } } });
  const env = loadEnv();
  const model = getModel();

  let cases = values.topics ? loadCases(values.topics) : BUILTIN;
  if (values.only) {
    const keep = parseOnly(values.only, cases.length);
    cases = cases.filter((_, index) => keep.has(index + 1));
  }

  mkdirSync(OUT, { recursive: true });
  logger.info("voice-eval start", { channel: model.channel, model: model.model, cases: cases.length });

  for (let index = 0; index < cases.length; index++) {
    const testCase = cases[index]!;
    const label = String(index + 1).padStart(2, "0");
    try {
      const startedAt = Date.now();
      const { system, user } = assemblePrompt({
        topic: testCase.topic,
        angle: testCase.angle,
        format: testCase.format,
        hookStyle: toHookStyle(testCase.hook),
        variantNumber: 1,
        variantCount: 1,
      });
      const result = await model.generate({ system, user });
      const elapsedMs = Date.now() - startedAt;
      const header =
        `<!-- topic: ${testCase.topic}\n     angle: ${testCase.angle}\n` +
        `     format: ${testCase.format}  hook: ${testCase.hook}\n` +
        `     model: ${env.MODEL_CHANNEL}/${model.model}  ${elapsedMs}ms  ` +
        `tokens: ${result.usage?.completionTokens ?? "?"}  finish: ${result.finishReason ?? "?"} -->\n\n`;
      writeFileSync(join(OUT, `${label}-${testCase.format}.md`), header + result.text + "\n");
      logger.info(`case ${label} ok`, { ms: elapsedMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeFileSync(join(OUT, `${label}-${testCase.format}.ERROR.md`), message + "\n");
      logger.error(`case ${label} failed`, { error: message });
    }
  }
  logger.info("voice-eval done", { out: OUT });
}

void main();
