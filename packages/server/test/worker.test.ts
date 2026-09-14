import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentModel, GenerateArgs } from "../src/models/types.js";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

const cardDir = mkdtempSync(join(tmpdir(), "content-engine-worker-cards-"));
useTestDatabase();
process.env.GEN_X = "2";
process.env.GEN_Y = "1";
process.env.GEN_Z = "2";
process.env.CARD_BATCH_LIMIT = "10";
process.env.IMAGE_STORE = "disk";
process.env.CARD_DIR = cardDir;
process.env.LOG_LEVEL = "error";

vi.mock("../src/embeddings/voyage.js", async () => {
  const { textToVector } = await import("./support/fake-embeddings.js");
  return {
    embedDocuments: async (texts: string[]) => texts.map(textToVector),
    embedQuery: async (text: string) => textToVector(text),
  };
});

const model: { current: ContentModel | null } = { current: makeFakeModel() };
vi.mock("../src/models/factory.js", () => ({
  getModel: () => {
    if (!model.current) throw new Error("model credentials are missing");
    return model.current;
  },
}));

// handlers.ts wiring is what's under test here, not card rendering or seeding
// themselves — those are covered in test/cards-run.test.ts and test/seed.test.ts.
const generateCardsForRun = vi.fn(async (_input: unknown) => ({
  attempted: 0,
  rendered: 0,
  reused: 0,
  failed: 0,
}));
vi.mock("../src/cards/run.js", () => ({
  generateCardsForRun: (...args: [unknown]) => generateCardsForRun(...args),
  imejisRenderer: { render: vi.fn(), contentType: () => "image/png" },
}));

const seedDocuments = vi.fn(async (docs: Array<{ file: string; body: string }>) => ({
  removed: 0,
  added: docs.length,
  files: docs.map((d) => d.file),
  short: docs.length,
  long: 0,
}));
vi.mock("../src/pipeline/seed.js", () => ({
  seedDocuments: (...args: [Array<{ file: string; body: string }>]) => seedDocuments(...args),
}));

const { handleJob } = await import("../src/worker/handlers.js");
const { migrate } = await import("../src/store/migrate.js");
const { insertRun, getRun } = await import("../src/store/runs.js");
const { insertTopic } = await import("../src/store/topics.js");
const { insertPost } = await import("../src/store/posts.js");
const { closeDb } = await import("../src/store/db.js");

await migrate();

function makeFakeModel(): ContentModel {
  return {
    channel: "vertex",
    model: "fake-glm",
    async generate({ user }: GenerateArgs) {
      const count = Number(user.match(/exactly (\d+)/)?.[1] ?? "2");
      const tag = (name: string) =>
        `<${name}s>\n${Array.from({ length: count }, (_u, i) => `<${name}>${name} ${i + 1}</${name}>`).join("\n")}\n</${name}s>`;
      if (user.includes("distinct topics")) return respond(tag("topic"));
      if (user.includes("distinct angles")) return respond(tag("angle"));
      if (user.includes("distinct lessons")) return respond(tag("lesson"));

      const body = "word ".repeat(240).trim();
      const summary = "a short summary";
      return respond(
        `<post><format>long</format><hook_style>questions</hook_style>` +
          `<topic_angle>angle</topic_angle><body>${body}</body>` +
          `<char_count>${body.length}</char_count>` +
          `<summary>${summary}</summary><summary_char_count>${summary.length}</summary_char_count></post>`,
      );
    },
  };
}

function respond(text: string) {
  return { text, channel: "vertex" as const, model: "fake-glm" };
}

function fakeJob(name: string, data: unknown) {
  return { name, data, updateProgress: vi.fn(async (_progress: unknown) => {}) };
}

beforeEach(async () => {
  await resetTestTables();
  model.current = makeFakeModel();
  generateCardsForRun.mockClear();
  seedDocuments.mockClear();
});

afterAll(async () => {
  await closeDb();
  rmSync(cardDir, { recursive: true, force: true });
});

describe("handleJob — generate", () => {
  it("runs a queued topic-list run to completion and reports progress", async () => {
    const run = await insertRun({
      flow: "matrix",
      config: { postsPerAngle: 2 },
      input_kind: "topic_list",
      input_text: "kubernetes\nterraform",
      status: "queued",
    });

    const job = fakeJob("generate", { runId: run.id });
    const result = (await handleJob(job)) as { postsCreated: number };

    expect(result.postsCreated).toBe(4); // 2 topics x 1 angle x 2 posts
    expect((await getRun(run.id))!.status).toBe("completed");
    expect(job.updateProgress).toHaveBeenCalled();

    const lastProgress = job.updateProgress.mock.calls.at(-1)?.[0];
    expect(lastProgress).toMatchObject({ phase: "done" });
  });

  it("marks the run failed and rethrows when generation blows up", async () => {
    model.current = {
      channel: "vertex",
      model: "fake-glm",
      async generate() {
        throw new Error("model exploded");
      },
    };

    const run = await insertRun({
      flow: "matrix",
      config: {},
      input_kind: "topic_list",
      input_text: "kubernetes",
      status: "queued",
    });

    await expect(handleJob(fakeJob("generate", { runId: run.id }))).rejects.toThrow("model exploded");
    const failed = (await getRun(run.id))!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/model exploded/);
  });

  it("404s a job that points at a missing run", async () => {
    await expect(handleJob(fakeJob("generate", { runId: "ghost" }))).rejects.toThrow(/no run/);
  });

  it("marks the run failed when the model can't even be constructed", async () => {
    model.current = null;
    const run = await insertRun({
      flow: "matrix",
      config: {},
      input_kind: "topic_list",
      input_text: "kubernetes",
      status: "queued",
    });

    await expect(handleJob(fakeJob("generate", { runId: run.id }))).rejects.toThrow(/credentials/);
    expect((await getRun(run.id))!.status).toBe("failed");
  });
});

describe("handleJob — regenerate", () => {
  it("replaces a flagged post", async () => {
    const run = await insertRun({
      flow: "matrix",
      config: { postsPerAngle: 2 },
      input_kind: "topic_list",
      input_text: "kubernetes",
      status: "completed",
    });
    const topic = await insertTopic({
      run_id: run.id,
      base_text: "kubernetes",
      base_index: 0,
      angle_text: "an angle",
      angle_index: 0,
    });
    const post = await insertPost({
      kind: "generated",
      run_id: run.id,
      topic_id: topic.id,
      variant_index: 0,
      format: "long",
      hook_style: "questions",
      lesson_text: "a lesson",
      body: "word ".repeat(240).trim(),
      summary: "s",
      status: "flag_dup",
    });

    const result = (await handleJob(fakeJob("regenerate", { postId: post.id }))) as {
      oldPostId: string;
      newPostId: string;
    };
    expect(result.oldPostId).toBe(post.id);
    expect(result.newPostId).not.toBe(post.id);
  });
});

describe("handleJob — unknown type", () => {
  it("throws", async () => {
    await expect(handleJob(fakeJob("dance", {}))).rejects.toThrow(/unknown job type/);
  });
});

describe("handleJob — cards", () => {
  it("renders a batch for the run, falling back to CARD_BATCH_LIMIT when no limit is given", async () => {
    await handleJob(fakeJob("cards", { runId: "run-1" }));
    expect(generateCardsForRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", limit: 10 }),
    );
  });

  it("uses the limit from the job payload when given", async () => {
    await handleJob(fakeJob("cards", { runId: "run-1", limit: 3 }));
    expect(generateCardsForRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", limit: 3 }),
    );
  });
});

describe("handleJob — seed", () => {
  it("passes the posts through as seed documents", async () => {
    await handleJob(
      fakeJob("seed", { posts: [{ name: "a.md", body: "hello" }, { name: "b.md", body: "world" }] }),
    );
    expect(seedDocuments).toHaveBeenCalledWith([
      { file: "a.md", body: "hello" },
      { file: "b.md", body: "world" },
    ]);
  });
});
