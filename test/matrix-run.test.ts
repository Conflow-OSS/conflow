import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContentModel, GenerateArgs } from "../src/models/types.js";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-matrix-"));
process.env.DB_PATH = join(workDir, "matrix.db");
process.env.EMBED_DIM = "8";
process.env.GEN_X = "3";
process.env.GEN_Y = "2";
process.env.GEN_Z = "2";
process.env.SHORT_FORM_RATIO = "0.5";
process.env.HOOK_SPLIT = "0.5";
process.env.LENGTH_TOLERANCE = "0.15";
process.env.LOG_LEVEL = "error";

const { runMatrixFlowFromTopicList, runMatrixFlowFromStory, runCaseStudyFlow } = await import(
  "../src/pipeline/run.js"
);
const { getDb, closeDb } = await import("../src/store/db.js");

function bodyOfLength(characterCount: number): string {
  return "word ".repeat(Math.ceil(characterCount / 5)).slice(0, characterCount).trim();
}

function tagList(tagName: string, count: number): string {
  const items = Array.from(
    { length: count },
    (_unused, index) => `  <${tagName}>${tagName} ${index + 1}</${tagName}>`,
  ).join("\n");
  return `<${tagName}s>\n${items}\n</${tagName}s>`;
}

const postGenerationPrompts: string[] = [];

const fakeModel: ContentModel = {
  channel: "vertex",
  model: "fake-glm",
  async generate({ user }: GenerateArgs) {
    const requestedCount = Number(user.match(/exactly (\d+)/)?.[1] ?? "2");
    if (user.includes("distinct topics")) {
      return { text: tagList("topic", requestedCount), channel: "vertex", model: "fake-glm" };
    }
    if (user.includes("distinct angles")) {
      return { text: tagList("angle", requestedCount), channel: "vertex", model: "fake-glm" };
    }

    postGenerationPrompts.push(user);
    const format = user.match(/FORMAT:\s*(\w+)/)?.[1] ?? "long";
    const body = format === "short" ? bodyOfLength(450) : bodyOfLength(1200);
    return {
      text:
        `<post><format>${format}</format><hook_style>questions</hook_style>` +
        `<topic_angle>the angle</topic_angle><body>${body}</body>` +
        `<char_count>${body.length}</char_count></post>`,
      channel: "vertex",
      model: "fake-glm",
    };
  },
};

function countPostsByFormat(runId: string): Record<string, number> {
  const rows = getDb()
    .prepare(`SELECT format, COUNT(*) AS n FROM posts WHERE run_id = ? GROUP BY format`)
    .all(runId) as Array<{ format: string; n: number }>;
  return Object.fromEntries(rows.map((row) => [row.format, row.n]));
}

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("runMatrixFlowFromTopicList — 3 topics, Y=2, Z=2", () => {
  let runId: string;

  beforeAll(async () => {
    const topicsFile = join(workDir, "topics.txt");
    writeFileSync(topicsFile, "# topics\nBlue-green deployments\nTerraform state locking\nPod autoscaling\n");
    const result = await runMatrixFlowFromTopicList(topicsFile, fakeModel);
    runId = result.runId;
    expect(result.postsCreated).toBe(12);
  });

  it("creates 3 x 2 topic rows", () => {
    const topicCount = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM topics WHERE run_id = ?`)
      .get(runId) as { n: number };
    expect(topicCount.n).toBe(6);
  });

  it("creates 12 posts with the planned format split", () => {
    expect(countPostsByFormat(runId)).toEqual({ short: 6, long: 6 });
  });

  it("splits the long posts between the two hook styles", () => {
    const rows = getDb()
      .prepare(
        `SELECT hook_style, COUNT(*) AS n FROM posts
         WHERE run_id = ? AND format = 'long' GROUP BY hook_style`,
      )
      .all(runId) as Array<{ hook_style: string; n: number }>;
    expect(Object.fromEntries(rows.map((row) => [row.hook_style, row.n]))).toEqual({
      questions: 3,
      callout: 3,
    });
  });

  it("marks every post ok and records the model", () => {
    const rows = getDb()
      .prepare(`SELECT status, model_id FROM posts WHERE run_id = ?`)
      .all(runId) as Array<{ status: string; model_id: string }>;
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.status === "ok" && row.model_id === "fake-glm")).toBe(true);
  });
});

describe("runMatrixFlowFromStory — GEN_X=3, Y=2, Z=2", () => {
  let runId: string;

  beforeAll(async () => {
    const storyFile = join(workDir, "story.md");
    writeFileSync(storyFile, "A long case study about building a GKE platform. ".repeat(40));
    const result = await runMatrixFlowFromStory(storyFile, fakeModel);
    runId = result.runId;
    expect(result.postsCreated).toBe(12);
  });

  it("derives GEN_X topics from the story and stores the story as input_text", () => {
    const run = getDb()
      .prepare(`SELECT input_kind, input_text FROM runs WHERE id = ?`)
      .get(runId) as { input_kind: string; input_text: string };
    expect(run.input_kind).toBe("story");
    expect(run.input_text).toContain("building a GKE platform");

    const distinctBaseTopics = getDb()
      .prepare(`SELECT COUNT(DISTINCT base_text) AS n FROM topics WHERE run_id = ?`)
      .get(runId) as { n: number };
    expect(distinctBaseTopics.n).toBe(3);
  });

  it("runs the same matrix and creates 3 x 2 x 2 posts", () => {
    expect(countPostsByFormat(runId)).toEqual({ short: 6, long: 6 });
  });

  it("does NOT pass the story as source facts (advisory mode)", () => {
    const usedAdvisoryMode = postGenerationPrompts.every((prompt) =>
      prompt.includes("(none — advisory mode)"),
    );
    expect(usedAdvisoryMode).toBe(true);
  });
});

describe("runCaseStudyFlow — GEN_X=3, Y=2, Z=2", () => {
  let runId: string;

  beforeAll(async () => {
    postGenerationPrompts.length = 0;
    const caseStudyFile = join(workDir, "case-study.md");
    writeFileSync(
      caseStudyFile,
      "I built a GKE platform. The hardest part was zero-downtime database migrations. ".repeat(20),
    );
    const result = await runCaseStudyFlow(caseStudyFile, fakeModel);
    runId = result.runId;
    expect(result.postsCreated).toBe(12);
  });

  it("records the run as the casestudy flow", () => {
    const run = getDb()
      .prepare(`SELECT flow FROM runs WHERE id = ?`)
      .get(runId) as { flow: string };
    expect(run.flow).toBe("casestudy");
  });

  it("passes the case study text as source facts to every post", () => {
    const everyPromptHasSourceFacts = postGenerationPrompts.every((prompt) =>
      prompt.includes("The hardest part was zero-downtime database migrations."),
    );
    expect(everyPromptHasSourceFacts).toBe(true);
    expect(postGenerationPrompts.some((prompt) => prompt.includes("(none — advisory mode)"))).toBe(
      false,
    );
  });
});
