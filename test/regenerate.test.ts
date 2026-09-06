import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContentModel, GenerateArgs } from "../src/models/types.js";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-regen-"));
process.env.DB_PATH = join(workDir, "regen.db");
process.env.EMBED_DIM = "16";
process.env.GEN_Y = "1";
process.env.GEN_Z = "2";
process.env.SHORT_FORM_RATIO = "0";
process.env.HOOK_SPLIT = "1";
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
    generationCounter++;
    const body = `attempt ${generationCounter} ` + "word ".repeat(240);
    return {
      text: `<post><format>long</format><hook_style>questions</hook_style><topic_angle>a</topic_angle><body>${body.trim()}</body></post>`,
      channel: "vertex",
      model: "fake-glm",
    };
  },
};

const { runMatrixFlowFromTopicList } = await import("../src/pipeline/run.js");
const { regeneratePost } = await import("../src/pipeline/regenerate.js");
const { getDb, closeDb } = await import("../src/store/db.js");
const { getPost } = await import("../src/store/posts.js");

let firstPostId: string;

beforeAll(async () => {
  const topicsFile = join(workDir, "topics.txt");
  writeFileSync(topicsFile, "Zero downtime deployments\n");
  const run = await runMatrixFlowFromTopicList(topicsFile, fakeModel);

  const posts = getDb()
    .prepare(`SELECT id FROM posts WHERE run_id = ? ORDER BY variant_index`)
    .all(run.runId) as Array<{ id: string }>;
  firstPostId = posts[0]!.id;
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("regeneratePost", () => {
  it("replaces the old post with a fresh row and marks the old one regenerated", async () => {
    const before = getPost(firstPostId)!;

    const result = await regeneratePost(firstPostId, fakeModel);

    expect(result.oldPostId).toBe(firstPostId);
    expect(result.newPostId).not.toBe(firstPostId);

    const old = getPost(firstPostId)!;
    expect(old.status).toBe("regenerated");

    const fresh = getPost(result.newPostId)!;
    expect(fresh.status).toBe("ok");
    expect(fresh.topic_id).toBe(before.topic_id);
    expect(fresh.variant_index).toBe(before.variant_index);
    expect(fresh.body).not.toBe(before.body);

    const embeddingExists = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM vec_posts WHERE post_id = ?`)
      .get(result.newPostId) as { n: number };
    expect(embeddingExists.n).toBe(1);
  });

  it("refuses to regenerate a post that was already replaced", async () => {
    await expect(regeneratePost(firstPostId, fakeModel)).rejects.toThrow(/already been replaced/);
  });

  it("refuses an unknown post id", async () => {
    await expect(regeneratePost("does-not-exist", fakeModel)).rejects.toThrow(/no post with id/);
  });
});
