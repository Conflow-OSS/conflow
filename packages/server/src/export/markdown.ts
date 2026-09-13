import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PostRow, RunRow, TopicRow } from "../store/types.js";
import { slugify } from "../util/slug.js";

/** Writes one Markdown file per post plus a `_summary.md`, and returns the file names. */
export function writeMarkdownExport(
  run: RunRow,
  posts: PostRow[],
  topicById: Map<string, TopicRow>,
  outDir: string,
): string[] {
  mkdirSync(outDir, { recursive: true });
  const writtenFiles: string[] = [];

  posts.forEach((post, index) => {
    const number = String(index + 1).padStart(2, "0");
    const topic = post.topic_id ? topicById.get(post.topic_id) : undefined;
    const flaggedPrefix = isFlagged(post) ? "flagged-" : "";
    const slug = slugify(post.lesson_text ?? topic?.base_text ?? post.body);
    const fileName = `${number}-${flaggedPrefix}${slug}.md`;

    writeFileSync(join(outDir, fileName), renderPostFile(run, post, topic));
    writtenFiles.push(fileName);
  });

  writeFileSync(join(outDir, "_summary.md"), renderSummary(run, posts));
  writtenFiles.push("_summary.md");

  return writtenFiles;
}

/** The `_summary.md` content on its own — the API serves this for `format=md`. */
export function buildMarkdownSummary(run: RunRow, posts: PostRow[]): string {
  return renderSummary(run, posts);
}

function isFlagged(post: PostRow): boolean {
  return post.status === "flag_dup" || post.status === "flag_length";
}

function renderPostFile(run: RunRow, post: PostRow, topic: TopicRow | undefined): string {
  const fields: Array<[string, string | number | null]> = [
    ["run", run.id],
    ["post_id", post.id],
    ["flow", run.flow],
    ["topic", topic?.base_text ?? ""],
    ["angle", topic?.angle_text ?? ""],
    ["lesson", post.lesson_text ?? ""],
    ["summary", post.summary ?? ""],
    ["summary_chars", post.summary_char_count],
    ["format", post.format],
    ["hook_style", post.hook_style ?? "n/a"],
    ["status", post.status],
    ["approval", post.approval],
    ["chars", post.char_count],
    ["model", joinModel(post)],
  ];

  if (post.image_url) {
    fields.push(["card", post.image_url]);
  }
  if (isFlagged(post)) {
    fields.push(["flag_reason", post.flag_reason ?? ""]);
    if (post.dup_of_id) fields.push(["dup_of", post.dup_of_id]);
    if (post.dup_score !== null) fields.push(["dup_score", post.dup_score.toFixed(3)]);
  }

  const frontMatter = fields.map(([key, value]) => `${key}: ${toYamlScalar(value)}`).join("\n");
  return `---\n${frontMatter}\n---\n\n${post.body}\n`;
}

function renderSummary(run: RunRow, posts: PostRow[]): string {
  const byStatus = tally(posts, (post) => post.status);
  const byFormat = tally(posts, (post) => post.format);
  const byApproval = tally(posts, (post) => post.approval);
  const flagged = posts.filter(isFlagged);
  const pending = posts.filter((post) => post.approval === "pending");

  const lines: string[] = [
    `# Run ${run.id}`,
    "",
    `- flow: ${run.flow}`,
    `- created: ${run.created_at}`,
    `- posts: ${posts.length}  (${describeTally(byStatus)})`,
    `- formats: ${describeTally(byFormat)}`,
    `- approval: ${describeTally(byApproval)}`,
    "",
    "| # | status | approval | format | hook | chars | lesson |",
    "|---|--------|----------|--------|------|-------|--------|",
  ];

  posts.forEach((post, index) => {
    const number = String(index + 1).padStart(2, "0");
    lines.push(
      `| ${number} | ${post.status} | ${post.approval} | ${post.format} | ` +
        `${post.hook_style ?? "n/a"} | ${post.char_count} | ${truncate(post.lesson_text ?? "", 60)} |`,
    );
  });

  if (flagged.length > 0) {
    lines.push("", `## Flagged (${flagged.length})`, "");
    for (const post of flagged) {
      const number = String(posts.indexOf(post) + 1).padStart(2, "0");
      lines.push(`- ${number} · ${post.status} · ${post.flag_reason ?? ""}`);
    }
  }

  if (pending.length > 0) {
    lines.push("", `## Pending review (${pending.length})`, "");
    for (const post of pending) {
      const number = String(posts.indexOf(post) + 1).padStart(2, "0");
      lines.push(`- ${number} · ${post.id} · ${truncate(post.lesson_text ?? "", 70)}`);
    }
  }

  return lines.join("\n") + "\n";
}

function joinModel(post: PostRow): string {
  return post.model_channel && post.model_id ? `${post.model_channel}/${post.model_id}` : "";
}

function toYamlScalar(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value); // a double-quoted string is valid YAML and handles escaping
}

function tally<T>(items: T[], pick: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = pick(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function describeTally(counts: Map<string, number>): string {
  return [...counts.entries()].map(([key, count]) => `${count} ${key}`).join(", ");
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "…";
}
