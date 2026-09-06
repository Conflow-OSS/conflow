// tsc compiles .ts only, so the prompt .md files have to be copied into dist/ by hand.
import { cpSync } from "node:fs";

cpSync("src/prompt", "dist/prompt", {
  recursive: true,
  filter: (path) => !path.endsWith(".ts"),
});

console.log("copied prompt files to dist/prompt");
