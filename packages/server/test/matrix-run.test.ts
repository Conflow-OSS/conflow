import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContentModel, GenerateArgs } from "../src/models/types.js";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-matrix-"));
useTestDatabase();
process.env.GEN_X = "3";
process.env.GEN_Y = "2";
process.env.GEN_Z = "2";
process.env.LENGTH_TOLERANCE = "0.15";
process.env.DEDUP_SIBLING_THRESHOLD = "0.93";
process.env.DEDUP_LEDGER_THRESHOLD = "0.85";
process.env.LOG_LEVEL = "error";

vi.mock("../src/embeddings/voyage.js", async () => {
  const { textToVector } = await import("./support/fake-embeddings.js");
  return {
    embedDocuments: async (texts: string[]) => texts.map(textToVector),
    embedQuery: async (text: string) => textToVector(text),
  };
});

const { migrate } = await import("../src/store/migrate.js");
const { runMatrixFlowFromTopicList, runMatrixFlowFromStory, runCaseStudyFlow } = await import(
  "../src/pipeline/run.js"
);
const { insertGoldenPost } = await import("../src/store/golden-posts.js");
const { getDb, closeDb } = await import("../src/store/db.js");

await migrate();
await resetTestTables();

// Three golden posts, one per category — mirrors the old fixed
// short/questions/callout split: 12 posts / 3 goldens = 4 each.
await insertGoldenPost({ body: "a short golden post", format: "short" });
await insertGoldenPost({ body: "a long/questions golden post", format: "long", hook_style: "questions" });
await insertGoldenPost({ body: "a long/callout golden post", format: "long", hook_style: "callout" });

function fillerBody(marker: string, format: string): string {
  const filler = format === "short" ? "word ".repeat(90) : "word ".repeat(240);
  return `${marker} ${filler}`.trim();
}

function tagList(tagName: string, count: number): string {
  const items = Array.from(
    { length: count },
    (_unused, index) => `  <${tagName}>${tagName} ${index + 1}</${tagName}>`,
  ).join("\n");
  return `<${tagName}s>\n${items}\n</${tagName}s>`;
}

const postGenerationPrompts: string[] = [];

function fieldFromPrompt(prompt: string, name: string): string {
  // stop at an inline " (explanation)" or the end of the line
  return prompt.match(new RegExp(`${name}:\\s*(.+?)(?:\\s+\\(|$)`, "m"))?.[1]?.trim() ?? "";
}

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
    if (user.includes("distinct lessons")) {
      return { text: tagList("lesson", requestedCount), channel: "vertex", model: "fake-glm" };
    }

    postGenerationPrompts.push(user);
    const topic = fieldFromPrompt(user, "TOPIC");
    const angle = fieldFromPrompt(user, "ANGLE");
    const lesson = fieldFromPrompt(user, "LESSON");
    const format = fieldFromPrompt(user, "FORMAT") || "long";

    const body = fillerBody(`${topic} ${angle} ${lesson}`, format);
    const summary = `Lesson: ${lesson}`;

    return {
      text:
        `<post><format>${format}</format><hook_style>questions</hook_style>` +
        `<topic_angle>${angle}</topic_angle><body>${body}</body>` +
        `<char_count>${body.length}</char_count>` +
        `<summary>${summary}</summary><summary_char_count>${summary.length}</summary_char_count></post>`,
      channel: "vertex",
      model: "fake-glm",
    };
  },
};

async function countPostsByFormat(runId: string): Promise<Record<string, number>> {
  const rows = await getDb()<Array<{ format: string; n: number }>>`
    SELECT format, COUNT(*)::int AS n FROM posts WHERE run_id = ${runId} GROUP BY format
  `;
  return Object.fromEntries(rows.map((row) => [row.format, row.n]));
}

afterAll(async () => {
  await closeDb();
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
    expect(result.flaggedAsDuplicate).toBe(0);
  });

  it("creates 3 x 2 topic rows", async () => {
    const [topicCount] = await getDb()<[{ n: number }]>`
      SELECT COUNT(*)::int AS n FROM topics WHERE run_id = ${runId}
    `;
    expect(topicCount!.n).toBe(6);
  });

  it("creates 12 posts with the planned format split", async () => {
    expect(await countPostsByFormat(runId)).toEqual({ short: 4, long: 8 });
  });

  it("stores a distinct lesson and a summary on every post", async () => {
    const rows = await getDb()<
      Array<{
        topic_id: string;
        lesson_text: string | null;
        summary: string | null;
        summary_char_count: number | null;
      }>
    >`SELECT topic_id, lesson_text, summary, summary_char_count FROM posts WHERE run_id = ${runId}`;

    expect(rows.every((row) => row.lesson_text && row.summary)).toBe(true);
    expect(rows.every((row) => row.summary_char_count === [...row.summary!].length)).toBe(true);

    // the two lessons under each angle must be different
    const lessonsByTopic = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = lessonsByTopic.get(row.topic_id) ?? new Set<string>();
      set.add(row.lesson_text!);
      lessonsByTopic.set(row.topic_id, set);
    }
    for (const lessons of lessonsByTopic.values()) {
      expect(lessons.size).toBe(2);
    }
  });

  it("splits the long posts between the two hook styles", async () => {
    const rows = await getDb()<Array<{ hook_style: string; n: number }>>`
      SELECT hook_style, COUNT(*)::int AS n FROM posts
       WHERE run_id = ${runId} AND format = 'long' GROUP BY hook_style
    `;
    expect(Object.fromEntries(rows.map((row) => [row.hook_style, row.n]))).toEqual({
      questions: 4,
      callout: 4,
    });
  });

  it("stores an embedding for every post and marks them ok", async () => {
    const posts = await getDb()<Array<{ id: string; status: string }>>`
      SELECT id, status FROM posts WHERE run_id = ${runId}
    `;
    expect(posts).toHaveLength(12);
    expect(posts.every((post) => post.status === "ok")).toBe(true);

    const [embeddingCount] = await getDb()<[{ n: number }]>`
      SELECT COUNT(*)::int AS n FROM posts WHERE run_id = ${runId} AND embedding IS NOT NULL
    `;
    expect(embeddingCount!.n).toBe(12);
  });
});

describe("runMatrixFlowFromStory — GEN_X=3, Y=2, Z=2", () => {
  let runId: string;

  beforeAll(async () => {
    postGenerationPrompts.length = 0;
    const storyFile = join(workDir, "story.md");
    writeFileSync(storyFile, "A long case study about building a GKE platform. ".repeat(40));
    const result = await runMatrixFlowFromStory(storyFile, fakeModel);
    runId = result.runId;
    expect(result.postsCreated).toBe(12);
  });

  it("derives GEN_X topics from the story and stores the story as input_text", async () => {
    const [run] = await getDb()<[{ input_kind: string; input_text: string }]>`
      SELECT input_kind, input_text FROM runs WHERE id = ${runId}
    `;
    expect(run!.input_kind).toBe("story");
    expect(run!.input_text).toContain("building a GKE platform");

    const [distinctBaseTopics] = await getDb()<[{ n: number }]>`
      SELECT COUNT(DISTINCT base_text)::int AS n FROM topics WHERE run_id = ${runId}
    `;
    expect(distinctBaseTopics!.n).toBe(3);
  });

  it("does NOT pass the story as source facts (advisory mode)", () => {
    expect(postGenerationPrompts.every((prompt) => prompt.includes("(none — advisory mode)"))).toBe(
      true,
    );
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

  it("records the run as the casestudy flow", async () => {
    const [run] = await getDb()<[{ flow: string }]>`SELECT flow FROM runs WHERE id = ${runId}`;
    expect(run!.flow).toBe("casestudy");
  });

  it("passes the case study text as source facts to every post", () => {
    const everyPromptHasSourceFacts = postGenerationPrompts.every((prompt) =>
      prompt.includes("The hardest part was zero-downtime database migrations."),
    );
    expect(everyPromptHasSourceFacts).toBe(true);
  });
});
