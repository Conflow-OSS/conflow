import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PostRow, RunRow, TopicRow } from "../store/types.js";

/** The whole run as one plain object — used by both the file export and the API. */
export function buildJsonExport(
  run: RunRow,
  posts: PostRow[],
  topicById: Map<string, TopicRow>,
): unknown {
  return {
    run: {
      id: run.id,
      flow: run.flow,
      created_at: run.created_at,
      input_kind: run.input_kind,
      config: safeParse(run.config_json),
    },
    posts: posts.map((post) => {
      const topic = post.topic_id ? topicById.get(post.topic_id) : undefined;
      return {
        ...post,
        topic: topic?.base_text ?? null,
        angle: topic?.angle_text ?? null,
      };
    }),
  };
}

/** Writes the whole run as a single JSON file for programmatic use. */
export function writeJsonExport(
  run: RunRow,
  posts: PostRow[],
  topicById: Map<string, TopicRow>,
  outPath: string,
): void {
  const payload = buildJsonExport(run, posts, topicById);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
