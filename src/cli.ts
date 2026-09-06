#!/usr/bin/env node
import { Command } from "commander";
import { loadEnv } from "./config/load.js";
import type { MatrixRunResult } from "./pipeline/run.js";
import { closeDb } from "./store/db.js";
import { migrate } from "./store/migrate.js";
import { countByStatus, listByRun, listFlagged } from "./store/posts.js";
import { getRun, latestRun } from "./store/runs.js";
import { listTopicsByRun } from "./store/topics.js";
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
  .description("Run a generation flow")
  .action(async (opts: { flow: string; topicsFile?: string; storyFile?: string }) => {
    const [{ getModel }, run] = await Promise.all([
      import("./models/factory.js"),
      import("./pipeline/run.js"),
    ]);

    let result: MatrixRunResult | null = null;
    if (opts.flow === "matrix" && opts.topicsFile) {
      result = await run.runMatrixFlowFromTopicList(opts.topicsFile, getModel());
    } else if (opts.flow === "matrix" && opts.storyFile) {
      result = await run.runMatrixFlowFromStory(opts.storyFile, getModel());
    } else if (opts.flow === "casestudy" && opts.storyFile) {
      result = await run.runCaseStudyFlow(opts.storyFile, getModel());
    }

    if (!result) {
      logger.error(
        "expected: --flow matrix (--topics-file | --story-file), or --flow casestudy --story-file",
        { flow: opts.flow },
      );
      process.exitCode = 2;
      return;
    }

    const flagNotes: string[] = [];
    if (result.flaggedForLength) flagNotes.push(`${result.flaggedForLength} flagged for length`);
    if (result.flaggedAsDuplicate) flagNotes.push(`${result.flaggedAsDuplicate} flagged as duplicate`);
    const flagSuffix = flagNotes.length > 0 ? ` (${flagNotes.join(", ")})` : "";
    process.stdout.write(`run ${result.runId}: ${result.postsCreated} posts created${flagSuffix}\n`);
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
  .command("show")
  .argument("[run_id]", "which run to show (default: the most recent)")
  .description("Print every post from a run")
  .action((runId?: string) => {
    migrate();
    const run = runId ? getRun(runId) : latestRun();
    if (!run) {
      logger.error(runId ? `no run with id ${runId}` : "no runs yet");
      process.exitCode = 1;
      return;
    }

    const posts = listByRun(run.id);
    const topicById = new Map(listTopicsByRun(run.id).map((topic) => [topic.id, topic]));

    process.stdout.write(
      `run ${run.id} · ${run.flow} · ${run.created_at.slice(0, 10)} · ${posts.length} posts\n`,
    );

    posts.forEach((post, index) => {
      const topic = post.topic_id ? topicById.get(post.topic_id) : undefined;
      const hookStyleSuffix = post.hook_style ? `/${post.hook_style}` : "";
      process.stdout.write(
        `\n━━━ ${index + 1}/${posts.length} · ${post.format}${hookStyleSuffix} · ` +
          `${post.status} · ${post.char_count} chars ━━━\n`,
      );
      if (topic) {
        process.stdout.write(`topic:  ${topic.base_text}\nangle:  ${topic.angle_text}\n`);
      }
      process.stdout.write(`\n${post.body}\n`);
    });
  });

program
  .command("regenerate")
  .argument("<post_id>", "a flagged (or any generated) post to replace")
  .description("Re-run one slot; the old row becomes status=regenerated")
  .action(async (postId: string) => {
    const [{ getModel }, { regeneratePost }] = await Promise.all([
      import("./models/factory.js"),
      import("./pipeline/regenerate.js"),
    ]);
    const result = await regeneratePost(postId, getModel());
    process.stdout.write(
      `replaced ${result.oldPostId}\n   new post ${result.newPostId} (${result.status})\n`,
    );
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
  .option("--prompt <text>", "user message", "In one short sentence, introduce yourself as a DevOps engineer.")
  .option("--system <file>", "path to a system prompt file")
  .description("Send one prompt to the configured channel")
  .action(async (opts: { prompt: string; system?: string }) => {
    const [{ getModel }, { readFileSync }] = await Promise.all([
      import("./models/factory.js"),
      import("node:fs"),
    ]);
    const model = getModel();
    const system = opts.system
      ? readFileSync(opts.system, "utf8")
      : "You are a helpful assistant. Answer concisely.";
    const started = Date.now();
    const res = await model.generate({ system, user: opts.prompt });
    process.stdout.write(res.text + "\n");
    logger.info("test-model ok", {
      channel: res.channel,
      model: res.model,
      finish: res.finishReason,
      ms: Date.now() - started,
      usage: res.usage,
    });
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
