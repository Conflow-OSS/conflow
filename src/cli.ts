#!/usr/bin/env node
import { Command } from "commander";
import { loadEnv } from "./config/load.js";
import { closeDb } from "./store/db.js";
import { migrate } from "./store/migrate.js";
import { countByStatus, listFlagged } from "./store/posts.js";
import { latestRun } from "./store/runs.js";
import { countEmbeddings } from "./store/vec.js";
import { logger } from "./util/logger.js";

const program = new Command();

program
  .name("content")
  .description("Local LinkedIn content engine — Phase 1: generation + dedup")
  .version("0.1.0");

program
  .command("migrate")
  .description("Create or update the SQLite schema")
  .action(() => {
    migrate();
  });

program
  .command("seed")
  .argument("<dir>", "directory of hand-written posts (one per file)")
  .description("Embed the seed corpus and store it as kind=seed")
  .action(async (dir: string) => {
    const { seedCorpus } = await import("./pipeline/seed.js");
    const r = await seedCorpus(dir);
    process.stdout.write(
      `seeded ${r.added} post(s) — ${r.short} short, ${r.long} long` +
        (r.removed ? `, replaced ${r.removed}` : "") +
        "\n",
    );
  });

program
  .command("generate")
  .requiredOption("--flow <flow>", "matrix | casestudy")
  .option("--topics-file <path>", "newline-separated topics (matrix)")
  .option("--story-file <path>", "a long story / case study")
  .description("Run a generation flow  [M6–M8]")
  .action(() => {
    notYet("generate", "M6");
  });

program
  .command("flags")
  .option("--run <id>", "limit to one run")
  .description("List flagged posts")
  .action((opts: { run?: string }) => {
    migrate();
    const rows = listFlagged(opts.run);
    if (rows.length === 0) {
      logger.info("no flagged posts");
      return;
    }
    for (const r of rows) {
      process.stdout.write(
        `${r.id}  ${r.status.padEnd(11)}  ${r.format.padEnd(5)}  ` +
          `score=${r.dup_score?.toFixed(3) ?? "-"}  dup_of=${r.dup_of_id ?? "-"}\n` +
          `    ${r.body.slice(0, 100).replace(/\s+/g, " ")}…\n`,
      );
    }
  });

program
  .command("regenerate")
  .argument("<post_id>")
  .description("Re-run one slot; the old row becomes status=regenerated  [M9]")
  .action(() => {
    notYet("regenerate", "M9");
  });

program
  .command("export")
  .argument("<run_id>")
  .option("--format <fmt>", "md | json", "md")
  .description("Write a run to the export directory  [M10]")
  .action(() => {
    notYet("export", "M10");
  });

program
  .command("stats")
  .description("Quick database overview")
  .action(() => {
    migrate();
    const run = latestRun();
    process.stdout.write(`vectors stored: ${countEmbeddings()}\n`);
    if (run) {
      process.stdout.write(
        `latest run: ${run.id}  flow=${run.flow}  ${run.created_at}\n` +
          `  ${JSON.stringify(countByStatus(run.id))}\n`,
      );
    } else {
      process.stdout.write("no runs yet\n");
    }
  });

program
  .command("test-model")
  .option("--prompt <text>", "prompt to send", "Say hi in one short sentence.")
  .description("Send one prompt to the configured channel  [M4]")
  .action(() => {
    notYet("test-model", "M4");
  });

function notYet(cmd: string, milestone: string): void {
  const env = loadEnv();
  logger.warn(`"${cmd}" is not implemented yet (${milestone})`, {
    channel: env.MODEL_CHANNEL,
    model: env.MODEL_ID,
  });
  process.exitCode = 2;
}

process.on("exit", closeDb);

try {
  await program.parseAsync();
} catch (err) {
  logger.error("command failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
}
