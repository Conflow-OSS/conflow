// tsc compiles .ts only, so the prompt .md files have to be copied into dist/ by hand.
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Remove previously copied prompt files first, so a renamed or deleted one does
// not linger in dist/. The compiled .js files (written by tsc just before this)
// are left alone.
if (existsSync("dist/prompt")) {
  rmSync("dist/prompt/goldens", { recursive: true, force: true });
  for (const entry of readdirSync("dist/prompt", { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      rmSync(join("dist/prompt", entry.name));
    }
  }
}

cpSync("src/prompt", "dist/prompt", {
  recursive: true,
  filter: (path) => !path.endsWith(".ts"),
});

console.log("copied prompt files to dist/prompt");
