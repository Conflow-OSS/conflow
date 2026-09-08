import { readFileSync } from "node:fs";

/** One topic per line; blank lines and `#` comments are ignored. */
export function parseTopicList(text: string): string[] {
  const topics = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (topics.length === 0) {
    throw new Error("no topics found in the input");
  }
  return topics;
}

export function loadTopicList(filePath: string): string[] {
  return parseTopicList(readFileSync(filePath, "utf8"));
}
