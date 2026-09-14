import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContentModel, GenerateArgs } from "../src/models/types.js";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-export-"));
useTestDatabase();
process.env.EXPORT_DIR = join(workDir, "exports");
process.env.GEN_Y = "1";
process.env.GEN_Z = "2";
process.env.SHORT_FORM_RATIO = "0.5";
process.env.HOOK_SPLIT = "1";
process.env.LOG_LEVEL = "error";

vi.mock("../src/embeddings/voyage.js", async () => {
  const { textToVector } = await import("./support/fake-embeddings.js");
  return {
    embedDocuments: async (texts: string[]) => texts.map(textToVector),
    embedQuery: async (text: string) => textToVector(text),
  };
});

function field(prompt: string, name: string): string {
  return prompt.match(new RegExp(`${name}:\\s*(.+?)(?:\\s+—|$)`, "m"))?.[1]?.trim() ?? "";
}

const fakeModel: ContentModel = {
  channel: "vertex",
  model: "fake-glm",
  async generate({ user }: GenerateArgs) {
    if (user.includes("distinct angles")) {
      return { text: "<angles><angle>keeping envs in sync</angle></angles>", channel: "vertex", model: "fake-glm" };
    }
    if (user.includes("distinct lessons")) {
      return {
        text: "<lessons><lesson>promote the same code to prod</lesson><lesson>keep state files isolated</lesson></lessons>",
        channel: "vertex",
        model: "fake-glm",
      };
    }
    const lesson = field(user, "LESSON");
    const format = field(user, "FORMAT") || "long";
    const body = `${lesson} ` + "word ".repeat(format === "short" ? 90 : 200);
    return {
      text:
        `<post><format>${format}</format><hook_style>questions</hook_style><topic_angle>${lesson}</topic_angle>` +
        `<body>${body.trim()}</body><summary>In short: ${lesson}.</summary></post>`,
      channel: "vertex",
      model: "fake-glm",
    };
  },
};

const { migrate } = await import("../src/store/migrate.js");
const { runMatrixFlowFromTopicList } = await import("../src/pipeline/run.js");
const { exportRun } = await import("../src/export/index.js");
const { closeDb } = await import("../src/store/db.js");

await migrate();
await resetTestTables();

let runId: string;

beforeAll(async () => {
  const topicsFile = join(workDir, "topics.txt");
  writeFileSync(topicsFile, "Terraform + Terragrunt across environments\n");
  const result = await runMatrixFlowFromTopicList(topicsFile, fakeModel);
  runId = result.runId;
});

afterAll(async () => {
  await closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("exportRun — markdown", () => {
  it("writes one file per post plus a summary", async () => {
    const result = await exportRun(runId, "md");
    const files = readdirSync(result.outDir);

    expect(files).toContain("_summary.md");
    expect(files.filter((name) => name !== "_summary.md")).toHaveLength(2);
  });

  it("puts the lesson, summary and status in each post's front-matter", async () => {
    const result = await exportRun(runId, "md");
    const postFile = readdirSync(result.outDir).find((name) => name !== "_summary.md")!;
    const contents = readFileSync(join(result.outDir, postFile), "utf8");

    expect(contents).toMatch(/^---\n/);
    expect(contents).toContain("lesson: ");
    expect(contents).toContain("summary: ");
    expect(contents).toContain("status: ");
    expect(contents).toMatch(/---\n\n[\s\S]+word/); // body follows the front-matter
  });

  it("lists every post in the summary table", async () => {
    const result = await exportRun(runId, "md");
    const summary = readFileSync(join(result.outDir, "_summary.md"), "utf8");
    expect(summary).toContain(`# Run ${runId}`);
    expect(summary).toContain("| # | status | approval | format | hook | chars | lesson |");
    expect(summary.match(/^\| \d\d \|/gm)).toHaveLength(2);
  });
});

describe("exportRun — json", () => {
  it("writes a single posts.json with the run and its posts", async () => {
    const result = await exportRun(runId, "json");
    const payload = JSON.parse(readFileSync(join(result.outDir, "posts.json"), "utf8"));

    expect(payload.run.id).toBe(runId);
    expect(payload.posts).toHaveLength(2);
    expect(payload.posts[0]).toHaveProperty("lesson_text");
    expect(payload.posts[0]).toHaveProperty("summary");
    expect(payload.posts[0].topic).toContain("Terraform");
  });
});

describe("exportRun — errors", () => {
  it("throws for an unknown run id", async () => {
    await expect(exportRun("nope", "md")).rejects.toThrow(/no run with id/);
  });

  it("does not leave a directory behind for a failed export", async () => {
    try {
      await exportRun("nope", "md");
    } catch {
      // expected
    }
    expect(existsSync(join(process.env.EXPORT_DIR!, "nope"))).toBe(false);
  });
});
