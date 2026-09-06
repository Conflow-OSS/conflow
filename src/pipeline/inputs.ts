import { readFileSync } from "node:fs";

export function loadTopicList(filePath: string): string[] {
  const fileContents = readFileSync(filePath, "utf8");
  const topics = fileContents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (topics.length === 0) {
    throw new Error(`no topics found in ${filePath}`);
  }
  return topics;
}
