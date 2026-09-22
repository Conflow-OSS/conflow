import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContentModel, GenerateArgs } from "../src/models/types.js";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-regen-"));
useTestDatabase();
process.env.GEN_Y = "1";
process.env.GEN_Z = "2";
process.env.LENGTH_TOLERANCE = "0.15";
process.env.LOG_LEVEL = "error";

vi.mock("../src/embeddings/voyage.js", async () => {
  const { textToVector } = await import("./support/fake-embeddings.js");
  return {
    embedDocuments: async (texts: string[]) => texts.map(textToVector),
    embedQuery: async (text: string) => textToVector(text),
  };
});

let generationCounter = 0;

const fakeModel: ContentModel = {
  channel: "vertex",
  model: "fake-glm",
  async generate({ user }: GenerateArgs) {
    if (user.includes("distinct angles")) {
      return { text: "<angles><angle>one clear angle</angle></angles>", channel: "vertex", model: "fake-glm" };
    }
    if (user.includes("distinct lessons")) {
      return {
        text: "<lessons><lesson>lesson one</lesson><lesson>lesson two</lesson></lessons>",
        channel: "vertex",
        model: "fake-glm",
      };
    }
    generationCounter++;
    const body = (`attempt ${generationCounter} ` + "word ".repeat(240)).trim();
    return {
      text:
        `<post><format>long</format><hook_style>questions</hook_style><topic_angle>a</topic_angle>` +
        `<body>${body}</body><summary>summary for attempt ${generationCounter}</summary></post>`,
      channel: "vertex",
      model: "fake-glm",
    };
  },
};

const { migrate } = await import("../src/store/migrate.js");
const { runMatrixFlowFromTopicList } = await import("../src/pipeline/run.js");
const { regeneratePost } = await import("../src/pipeline/regenerate.js");
const { insertGoldenPost } = await import("../src/store/golden-posts.js");
const { getDb, closeDb } = await import("../src/store/db.js");
const { getPost } = await import("../src/store/posts.js");

await migrate();
await resetTestTables();

// One golden post, long/questions — every generated post lands in that
// single slot, matching the old SHORT_FORM_RATIO=0/HOOK_SPLIT=1 setup.
await insertGoldenPost({ body: "a long/questions golden post", format: "long", hook_style: "questions" });

let firstPostId: string;

beforeAll(async () => {
  const topicsFile = join(workDir, "topics.txt");
  writeFileSync(topicsFile, "Zero downtime deployments\n");
  const run = await runMatrixFlowFromTopicList(topicsFile, fakeModel);

  const posts = await getDb()<Array<{ id: string }>>`
    SELECT id FROM posts WHERE run_id = ${run.runId} ORDER BY variant_index
  `;
  firstPostId = posts[0]!.id;
});

afterAll(async () => {
  await closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("regeneratePost", () => {
  it("replaces the old post with a fresh row and marks the old one regenerated", async () => {
    const before = (await getPost(firstPostId))!;

    const result = await regeneratePost(firstPostId, fakeModel);

    expect(result.oldPostId).toBe(firstPostId);
    expect(result.newPostId).not.toBe(firstPostId);

    const old = (await getPost(firstPostId))!;
    expect(old.status).toBe("regenerated");
    expect(old.superseded_by_id).toBe(result.newPostId);

    const fresh = (await getPost(result.newPostId))!;
    expect(fresh.status).toBe("ok");
    expect(fresh.topic_id).toBe(before.topic_id);
    expect(fresh.variant_index).toBe(before.variant_index);
    expect(fresh.body).not.toBe(before.body);

    const [embeddingExists] = await getDb()<[{ n: number }]>`
      SELECT COUNT(*)::int AS n FROM posts WHERE id = ${result.newPostId} AND embedding IS NOT NULL
    `;
    expect(embeddingExists!.n).toBe(1);
  });

  it("refuses to regenerate a post that was already replaced", async () => {
    await expect(regeneratePost(firstPostId, fakeModel)).rejects.toThrow(/already been replaced/);
  });

  it("refuses an unknown post id", async () => {
    await expect(regeneratePost("does-not-exist", fakeModel)).rejects.toThrow(/no post with id/);
  });
});
