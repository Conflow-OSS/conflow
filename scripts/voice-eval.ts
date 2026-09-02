/**
 * M4 voice-eval gate. Runs 10 topics through the real system + task prompt on the
 * configured channel and writes each result to data/voice-eval/ for Prince to read.
 *
 *   npm run dev -- --help        (not this — this is a script)
 *   npx tsx scripts/voice-eval.ts
 *
 * Not part of the CLI: it's a throwaway to judge whether a model holds the voice.
 * Re-run it when escalating glm-4.7 -> glm-5.2 -> Haiku.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "../src/config/load.js";
import { getModel } from "../src/models/factory.js";
import { logger } from "../src/util/logger.js";

const SEED = "seed/posts";
const OUT = "data/voice-eval";

const goldens: Record<string, string> = {
  "{{GOLDEN_LONG_QUESTIONS}}": readFileSync(join(SEED, "02-observability-end-to-end.md"), "utf8").trim(),
  "{{GOLDEN_LONG_CALLOUT}}": readFileSync(join(SEED, "04-slo-error-budgets-gke.md"), "utf8").trim(),
  "{{GOLDEN_SHORT}}": readFileSync(join(SEED, "01-pod-right-sizing-short.md"), "utf8").trim(),
};

function systemPrompt(): string {
  let s = readFileSync("src/prompt/system.md", "utf8");
  for (const [slot, text] of Object.entries(goldens)) s = s.replaceAll(slot, text);
  return s;
}

const taskTemplate = readFileSync("src/prompt/task.md", "utf8");

function taskPrompt(v: {
  topic: string;
  angle: string;
  format: "short" | "long";
  hook: "questions" | "callout" | "n/a";
}): string {
  return taskTemplate
    .replaceAll("{{topic}}", v.topic)
    .replaceAll("{{angle}}", v.angle)
    .replaceAll("{{format}}", v.format)
    .replaceAll("{{hook_style}}", v.hook)
    .replaceAll("{{k}}", "1")
    .replaceAll("{{z}}", "1")
    .replaceAll("{{source_facts}}", "(none — advisory mode)")
    .replaceAll("{{retrieved_style_examples}}", "(none — see the canonical examples in the system prompt)")
    .replaceAll("{{sibling_posts}}", "(none yet)")
    .replaceAll("{{near_duplicate_context}}", "(none)");
}

const CASES: Array<Parameters<typeof taskPrompt>[0]> = [
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

async function main() {
  const env = loadEnv();
  const model = getModel();
  mkdirSync(OUT, { recursive: true });
  const system = systemPrompt();
  logger.info("voice-eval start", { channel: model.channel, model: model.model, cases: CASES.length });

  for (let i = 0; i < CASES.length; i++) {
    const v = CASES[i]!;
    const n = String(i + 1).padStart(2, "0");
    try {
      const started = Date.now();
      const res = await model.generate({ system, user: taskPrompt(v) });
      const header =
        `<!-- topic: ${v.topic}\n     angle: ${v.angle}\n     format: ${v.format}  hook: ${v.hook}\n` +
        `     model: ${env.MODEL_CHANNEL}/${model.model}  ${Date.now() - started}ms  ` +
        `tokens: ${res.usage?.completionTokens ?? "?"}  finish: ${res.finishReason ?? "?"} -->\n\n`;
      writeFileSync(join(OUT, `${n}-${v.format}.md`), header + res.text + "\n");
      logger.info(`case ${n} ok`, { ms: Date.now() - started });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeFileSync(join(OUT, `${n}-${v.format}.ERROR.md`), msg + "\n");
      logger.error(`case ${n} failed`, { error: msg });
    }
  }
  logger.info("voice-eval done", { out: OUT });
}

void main();
