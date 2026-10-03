import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentModel, GenerateArgs } from "../src/models/types.js";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

useTestDatabase();
process.env.GEN_X = "1";
process.env.GEN_Y = "1";
process.env.GEN_Z = "2";
process.env.LOG_LEVEL = "error";

vi.mock("../src/embeddings/voyage.js", async () => {
  const { textToVector } = await import("./support/fake-embeddings.js");
  return {
    embedDocuments: async (texts: string[]) => texts.map(textToVector),
    embedQuery: async (text: string) => textToVector(text),
  };
});

const { migrate } = await import("../src/store/migrate.js");
const { runGenerationForRun } = await import("../src/pipeline/run.js");
const { insertGoldenPost } = await import("../src/store/golden-posts.js");
const { insertRun, getRun, setRunStatus } = await import("../src/store/runs.js");
const { insertTopic } = await import("../src/store/topics.js");
const { insertPost } = await import("../src/store/posts.js");
const { upsertEmbedding } = await import("../src/store/vec.js");
const { getDb, closeDb } = await import("../src/store/db.js");
const { textToVector } = await import("./support/fake-embeddings.js");

await migrate();

const callCounts = { angles: 0, lessons: 0, posts: 0 };

function tagList(tagName: string, count: number): string {
  const items = Array.from(
    { length: count },
    (_unused, index) => `  <${tagName}>${tagName} ${index + 1}</${tagName}>`,
  ).join("\n");
  return `<${tagName}s>\n${items}\n</${tagName}s>`;
}

function makeFakeModel(): ContentModel {
  return {
    channel: "vertex",
    model: "fake-glm",
    async generate({ user }: GenerateArgs) {
      const count = Number(user.match(/exactly (\d+)/)?.[1] ?? "2");
      if (user.includes("distinct angles")) {
        callCounts.angles++;
        return { text: tagList("angle", count), channel: "vertex", model: "fake-glm" };
      }
      if (user.includes("distinct lessons")) {
        callCounts.lessons++;
        return { text: tagList("lesson", count), channel: "vertex", model: "fake-glm" };
      }

      callCounts.posts++;
      const body = `generated body ${callCounts.posts} ${"word ".repeat(200)}`.trim();
      const summary = `summary ${callCounts.posts}`;
      return {
        text:
          `<post><format>long</format><hook_style>questions</hook_style>` +
          `<topic_angle>angle 1</topic_angle><body>${body}</body>` +
          `<char_count>${body.length}</char_count>` +
          `<summary>${summary}</summary><summary_char_count>${summary.length}</summary_char_count></post>`,
        channel: "vertex",
        model: "fake-glm",
      };
    },
  };
}

beforeEach(async () => {
  await resetTestTables();
  await insertGoldenPost({ body: "a long/questions golden post", format: "long", hook_style: "questions" });
  callCounts.angles = 0;
  callCounts.lessons = 0;
  callCounts.posts = 0;
});

afterAll(async () => {
  await closeDb();
});

describe("resuming an interrupted run", () => {
  it("only generates the missing post, and doesn't re-ask for angles or lessons", async () => {
    const run = await insertRun({
      flow: "matrix",
      config: { topicCount: 1, anglesPerTopic: 1, postsPerAngle: 2 },
      input_kind: "topic_list",
      input_text: "kubernetes cost visibility",
      status: "running",
    });

    // Simulate a prior attempt that got as far as: angle expanded, lessons
    // decided and stored, one of the two posts generated and stored — then
    // the process died before the second post was written.
    const topic = await insertTopic({
      run_id: run.id,
      base_text: "kubernetes cost visibility",
      base_index: 0,
      angle_text: "angle 1",
      angle_index: 0,
    });
    const lessons = ["lesson 1", "lesson 2"];
    const { setTopicLessons } = await import("../src/store/topics.js");
    await setTopicLessons(topic.id, JSON.stringify(lessons));

    const existingPost = await insertPost({
      kind: "generated",
      run_id: run.id,
      topic_id: topic.id,
      variant_index: 0,
      format: "long",
      hook_style: "questions",
      lesson_text: "lesson 1",
      body: "already generated before the interruption " + "word ".repeat(200),
      summary: "already generated summary",
    });
    await upsertEmbedding(existingPost.id, textToVector(existingPost.body));

    const result = await runGenerationForRun(run, makeFakeModel());

    expect(result.postsCreated).toBe(2);
    expect(callCounts.angles).toBe(0); // reused the stored topic row
    expect(callCounts.lessons).toBe(0); // reused topic.lessons_json
    expect(callCounts.posts).toBe(1); // only the missing variant was generated

    const sql = getDb();
    const posts = await sql<Array<{ id: string; variant_index: number; body: string }>>`
      SELECT id, variant_index, body FROM posts WHERE topic_id = ${topic.id} ORDER BY variant_index
    `;
    expect(posts).toHaveLength(2);
    expect(posts[0]!.id).toBe(existingPost.id); // untouched, not regenerated
    expect(posts[0]!.body).toContain("already generated before the interruption");
    expect(posts[1]!.variant_index).toBe(1);

    expect((await getRun(run.id))!.status).toBe("completed");
  });

  it("reuses the same post-slot plan instead of reshuffling it", async () => {
    const run = await insertRun({
      flow: "matrix",
      config: { topicCount: 1, anglesPerTopic: 1, postsPerAngle: 2 },
      input_kind: "topic_list",
      input_text: "terraform drift",
      status: "queued",
    });

    await runGenerationForRun(run, makeFakeModel());
    const firstSlots = (await getRun(run.id))!.slots_json;
    expect(firstSlots).toBeTruthy();

    // Force it through the "resume" path again even though it already
    // finished, bypassing the completed/failed short-circuit on purpose —
    // the slot plan must come back identical, not reshuffled.
    await setRunStatus(run.id, "running");
    const reRun = await getRun(run.id);
    await runGenerationForRun(reRun!, makeFakeModel());

    expect((await getRun(run.id))!.slots_json).toBe(firstSlots);
  });
});

describe("a run that failed", () => {
  it("can still be resumed — failed isn't treated as a dead end, only completed is", async () => {
    const run = await insertRun({
      flow: "matrix",
      config: { topicCount: 1, anglesPerTopic: 1, postsPerAngle: 2 },
      input_kind: "topic_list",
      input_text: "zero downtime migrations",
      status: "running",
    });

    // One post made it through before whatever failed it (a transient model
    // error, say) — then the run got marked "failed", same as
    // handleGenerate's catch block does today.
    const topic = await insertTopic({
      run_id: run.id,
      base_text: "zero downtime migrations",
      base_index: 0,
      angle_text: "angle 1",
      angle_index: 0,
    });
    const { setTopicLessons } = await import("../src/store/topics.js");
    await setTopicLessons(topic.id, JSON.stringify(["lesson 1", "lesson 2"]));
    const existingPost = await insertPost({
      kind: "generated",
      run_id: run.id,
      topic_id: topic.id,
      variant_index: 0,
      format: "long",
      hook_style: "questions",
      lesson_text: "lesson 1",
      body: "made it through before the failure " + "word ".repeat(200),
      summary: "s",
    });
    await upsertEmbedding(existingPost.id, textToVector(existingPost.body));
    await setRunStatus(run.id, "failed", "fetch failed");

    const failedRun = await getRun(run.id);
    expect(failedRun!.status).toBe("failed");

    const result = await runGenerationForRun(failedRun!, makeFakeModel());

    expect(result.postsCreated).toBe(2);
    expect(callCounts.posts).toBe(1); // only the missing one was regenerated
    expect((await getRun(run.id))!.status).toBe("completed");
  });
});

describe("a run that already finished", () => {
  it("is a no-op for a redelivered job — the model is never called", async () => {
    const run = await insertRun({
      flow: "matrix",
      config: { topicCount: 1, anglesPerTopic: 1, postsPerAngle: 2 },
      input_kind: "topic_list",
      input_text: "pod autoscaling",
      status: "queued",
    });
    const firstResult = await runGenerationForRun(run, makeFakeModel());
    expect(firstResult.postsCreated).toBe(2);

    callCounts.angles = 0;
    callCounts.lessons = 0;
    callCounts.posts = 0;

    const finished = await getRun(run.id);
    const secondResult = await runGenerationForRun(finished!, makeFakeModel());

    expect(secondResult).toEqual(firstResult);
    expect(callCounts.angles + callCounts.lessons + callCounts.posts).toBe(0);
  });
});

describe("a run another attempt is actively working", () => {
  it("backs off immediately instead of racing the lock holder", async () => {
    const run = await insertRun({
      flow: "matrix",
      config: { topicCount: 1, anglesPerTopic: 1, postsPerAngle: 2 },
      input_kind: "topic_list",
      input_text: "incident response",
      status: "running",
    });

    const sql = getDb();
    const reserved = await sql.reserve();
    const [{ locked }] = await reserved<[{ locked: boolean }]>`
      SELECT pg_try_advisory_lock(hashtext(${run.id})::bigint) AS locked
    `;
    expect(locked).toBe(true);

    try {
      const result = await runGenerationForRun(run, makeFakeModel());
      expect(result.postsCreated).toBe(0); // nothing stored yet — the real holder hasn't written anything
      expect(callCounts.angles + callCounts.lessons + callCounts.posts).toBe(0);
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtext(${run.id})::bigint)`;
      reserved.release();
    }
  });
});
