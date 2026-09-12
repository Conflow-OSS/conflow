import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContentModel, GenerateArgs } from "../src/models/types.js";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-dedup-"));
useTestDatabase();
process.env.GEN_Y = "2";
process.env.GEN_Z = "2";
process.env.SHORT_FORM_RATIO = "0"; // all long, so identical markers give identical bodies
process.env.HOOK_SPLIT = "1";
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

/** Every variant of a given angle produces the exact same body, so dedup must fire. */
const identicalOutputModel: ContentModel = {
  channel: "vertex",
  model: "fake-glm",
  async generate({ user }: GenerateArgs) {
    if (user.includes("distinct angles")) {
      return {
        text: "<angles><angle>first angle</angle><angle>second angle</angle></angles>",
        channel: "vertex",
        model: "fake-glm",
      };
    }
    if (user.includes("distinct lessons")) {
      return {
        text: "<lessons><lesson>lesson one</lesson><lesson>lesson two</lesson></lessons>",
        channel: "vertex",
        model: "fake-glm",
      };
    }
    // Same body for every lesson of an angle -> the second variant must flag as a duplicate.
    const angle = user.match(/ANGLE:\s*(.+)/)?.[1]?.trim() ?? "angle";
    const body = (`a stable post about ${angle} ` + "word ".repeat(240)).trim();
    return {
      text:
        `<post><format>long</format><hook_style>questions</hook_style><topic_angle>${angle}</topic_angle>` +
        `<body>${body}</body><summary>a stable summary about ${angle}</summary></post>`,
      channel: "vertex",
      model: "fake-glm",
    };
  },
};

const { migrate } = await import("../src/store/migrate.js");
const { runMatrixFlowFromTopicList } = await import("../src/pipeline/run.js");
const { getDb, closeDb } = await import("../src/store/db.js");

await migrate();
await resetTestTables();

let runId: string;

beforeAll(async () => {
  const topicsFile = join(workDir, "topics.txt");
  writeFileSync(topicsFile, "One topic, two angles, identical variants\n");
  const result = await runMatrixFlowFromTopicList(topicsFile, identicalOutputModel);
  runId = result.runId;
});

afterAll(async () => {
  await closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("deduplication in a run", () => {
  it("keeps the first variant of each angle and flags the identical second", async () => {
    const posts = await getDb()<
      Array<{
        variant_index: number;
        status: string;
        dup_of_id: string | null;
        dup_score: number | null;
      }>
    >`SELECT variant_index, status, dup_of_id, dup_score FROM posts WHERE run_id = ${runId}
       ORDER BY topic_id, variant_index`;

    expect(posts).toHaveLength(4);

    const kept = posts.filter((post) => post.status === "ok");
    const flagged = posts.filter((post) => post.status === "flag_dup");
    expect(kept).toHaveLength(2);
    expect(flagged).toHaveLength(2);

    for (const duplicate of flagged) {
      expect(duplicate.variant_index).toBe(1);
      expect(duplicate.dup_of_id).not.toBeNull();
      expect(duplicate.dup_score ?? 0).toBeGreaterThanOrEqual(0.93);
    }
  });

  it("does not flag across the two different angles", async () => {
    const flagReasons = await getDb()<Array<{ flag_reason: string }>>`
      SELECT flag_reason FROM posts WHERE run_id = ${runId} AND status = 'flag_dup'
    `;
    expect(flagReasons.every((row) => row.flag_reason.includes("sibling"))).toBe(true);
  });
});
