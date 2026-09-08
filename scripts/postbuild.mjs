// Runs right after `tsc`. Two jobs it can't do:
//   1. copy the prompt .md files into dist/ (tsc compiles .ts only)
//   2. make dist/cli.js executable, so the `content` bin actually runs
import { chmodSync, cpSync, existsSync, readdirSync, rmSync } from "node:fs";
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

chmodSync("dist/cli.js", 0o755);

console.log("postbuild: prompt files copied, dist/cli.js made executable");
