import { join } from "node:path";
import { loadEnv } from "../config/load.js";
import { migrate } from "../store/migrate.js";
import { listByRun } from "../store/posts.js";
import { getRun } from "../store/runs.js";
import { listTopicsByRun } from "../store/topics.js";
import { NotFoundError } from "../util/errors.js";
import { buildJsonExport, writeJsonExport } from "./json.js";
import { buildMarkdownSummary, writeMarkdownExport } from "./markdown.js";

export type ExportFormat = "md" | "json";

export interface ExportResult {
  outDir: string;
  files: string[];
}

/** Write a run's posts to `<EXPORT_DIR>/<run_id>/`. Works on partial runs too. */
export async function exportRun(runId: string, format: ExportFormat): Promise<ExportResult> {
  await migrate();

  const run = await getRun(runId);
  if (!run) {
    throw new Error(`no run with id ${runId}`);
  }

  const posts = await listByRun(runId);
  const topicById = new Map((await listTopicsByRun(runId)).map((topic) => [topic.id, topic]));
  const outDir = join(loadEnv().EXPORT_DIR, runId);

  if (format === "json") {
    writeJsonExport(run, posts, topicById, join(outDir, "posts.json"));
    return { outDir, files: ["posts.json"] };
  }

  return { outDir, files: writeMarkdownExport(run, posts, topicById, outDir) };
}

export interface RunExportPayload {
  filename: string;
  contentType: string;
  body: string;
}

/** A run's export as an in-memory payload — the API returns this instead of writing files. */
export async function buildRunExport(runId: string, format: ExportFormat): Promise<RunExportPayload> {
  await migrate();

  const run = await getRun(runId);
  if (!run) {
    throw new NotFoundError(`no run with id ${runId}`);
  }

  const posts = await listByRun(runId);

  if (format === "json") {
    const topicById = new Map((await listTopicsByRun(runId)).map((topic) => [topic.id, topic]));
    return {
      filename: `${runId}.json`,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildJsonExport(run, posts, topicById), null, 2) + "\n",
    };
  }

  return {
    filename: `${runId}.md`,
    contentType: "text/markdown; charset=utf-8",
    body: buildMarkdownSummary(run, posts),
  };
}
