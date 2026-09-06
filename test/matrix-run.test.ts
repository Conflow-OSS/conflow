import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContentModel, GenerateArgs } from "../src/models/types.js";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-matrix-"));
process.env.DB_PATH = join(workDir, "matrix.db");
process.env.EMBED_DIM = "8";
process.env.GEN_Y = "2";
process.env.GEN_Z = "2";
process.env.SHORT_FORM_RATIO = "0.5";
process.env.HOOK_SPLIT = "0.5";
process.env.LENGTH_TOLERANCE = "0.15";
process.env.LOG_LEVEL = "error";

const { runMatrixFlowFromTopicList } = await import("../src/pipeline/run.js");
const { getDb, closeDb } = await import("../src/store/db.js");

function bodyOfLength(characterCount: number): string {
  return "word ".repeat(Math.ceil(characterCount / 5)).slice(0, characterCount).trim();
}

const fakeModel: ContentModel = {
  channel: "vertex",
  model: "fake-glm",
  async generate({ user }: GenerateArgs) {
    if (user.includes("distinct angles")) {
      const requested = Number(user.match(/exactly (\d+)/)?.[1] ?? "2");
      const angleTags = Array.from(
        { length: requested },
        (_unused, index) => `  <angle>angle ${index + 1}</angle>`,
      ).join("\n");
      return { text: `<angles>\n${angleTags}\n</angles>`, channel: "vertex", model: "fake-glm" };
    }

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

let runId: string;

beforeAll(async () => {
  const topicsFile = join(workDir, "topics.txt");
  writeFileSync(topicsFile, "# my topics\nBlue-green deployments\nTerraform state locking\nPod autoscaling\n");
  const result = await runMatrixFlowFromTopicList(topicsFile, fakeModel);
  runId = result.runId;
  expect(result.postsCreated).toBe(12);
  expect(result.flaggedForLength).toBe(0);
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("runMatrixFlowFromTopicList — 3 topics, Y=2, Z=2", () => {
  it("creates 3 x 2 topic rows", () => {
    const topicCount = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM topics WHERE run_id = ?`)
      .get(runId) as { n: number };
    expect(topicCount.n).toBe(6);
  });

  it("creates 12 posts with the planned format split", () => {
    const rows = getDb()
      .prepare(`SELECT format, COUNT(*) AS n FROM posts WHERE run_id = ? GROUP BY format`)
      .all(runId) as Array<{ format: string; n: number }>;
    const byFormat = Object.fromEntries(rows.map((row) => [row.format, row.n]));
    expect(byFormat).toEqual({ short: 6, long: 6 });
  });

  it("splits the long posts between the two hook styles", () => {
    const rows = getDb()
      .prepare(
        `SELECT hook_style, COUNT(*) AS n FROM posts
         WHERE run_id = ? AND format = 'long' GROUP BY hook_style`,
      )
      .all(runId) as Array<{ hook_style: string; n: number }>;
    const byHook = Object.fromEntries(rows.map((row) => [row.hook_style, row.n]));
    expect(byHook).toEqual({ questions: 3, callout: 3 });
  });

  it("marks every post ok and records the model", () => {
    const rows = getDb()
      .prepare(`SELECT status, model_id FROM posts WHERE run_id = ?`)
      .all(runId) as Array<{ status: string; model_id: string }>;
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.status === "ok")).toBe(true);
    expect(rows.every((row) => row.model_id === "fake-glm")).toBe(true);
  });
});
