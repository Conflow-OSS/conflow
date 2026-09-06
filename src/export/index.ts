import { join } from "node:path";
import { loadEnv } from "../config/load.js";
import { migrate } from "../store/migrate.js";
import { listByRun } from "../store/posts.js";
import { getRun } from "../store/runs.js";
import { listTopicsByRun } from "../store/topics.js";
import { writeJsonExport } from "./json.js";
import { writeMarkdownExport } from "./markdown.js";

export type ExportFormat = "md" | "json";

export interface ExportResult {
  outDir: string;
  files: string[];
}

/** Write a run's posts to `<EXPORT_DIR>/<run_id>/`. Works on partial runs too. */
export function exportRun(runId: string, format: ExportFormat): ExportResult {
  migrate();

  const run = getRun(runId);
  if (!run) {
    throw new Error(`no run with id ${runId}`);
  }

  const posts = listByRun(runId);
  const topicById = new Map(listTopicsByRun(runId).map((topic) => [topic.id, topic]));
  const outDir = join(loadEnv().EXPORT_DIR, runId);

  if (format === "json") {
    writeJsonExport(run, posts, topicById, join(outDir, "posts.json"));
    return { outDir, files: ["posts.json"] };
  }

  return { outDir, files: writeMarkdownExport(run, posts, topicById, outDir) };
}
