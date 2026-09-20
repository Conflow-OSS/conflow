#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { loadEnv } from "./config/load.js";
import type { MatrixRunResult } from "./pipeline/run.js";
import { closeDb } from "./store/db.js";
import {
  deleteGoldenPost,
  getGoldenPost,
  insertGoldenPost,
  listGoldenPosts,
  updateGoldenPost,
} from "./store/golden-posts.js";
import { migrate } from "./store/migrate.js";
import {
  approvePendingInRun,
  countByApproval,
  countByStatus,
  listByRun,
  listFlagged,
} from "./store/posts.js";
import type { Approval, HookStyle, PostFormat } from "./store/types.js";
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
  .description("Create or update the Postgres schema")
  .action(async () => {
    await migrate();
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
  .action(async (opts: { run?: string }) => {
    await migrate();
    const rows = await listFlagged(opts.run);
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
  .action(async (runId?: string) => {
    await migrate();
    const run = runId ? await getRun(runId) : await latestRun();
    if (!run) {
      logger.error(runId ? `no run with id ${runId}` : "no runs yet");
      process.exitCode = 1;
      return;
    }

    const posts = await listByRun(run.id, { includeSuperseded: true });
    const topicById = new Map((await listTopicsByRun(run.id)).map((topic) => [topic.id, topic]));

    process.stdout.write(
      `run ${run.id} · ${run.flow} · ${run.created_at.slice(0, 10)} · ${posts.length} posts\n`,
    );

    posts.forEach((post, index) => {
      const topic = post.topic_id ? topicById.get(post.topic_id) : undefined;
      const hookStyleSuffix = post.hook_style ? `/${post.hook_style}` : "";
      process.stdout.write(
        `\n━━━ ${index + 1}/${posts.length} · ${post.id} · ${post.format}${hookStyleSuffix} · ` +
          `${post.status} · ${post.approval} · ${post.char_count} chars ━━━\n`,
      );
      if (topic) {
        process.stdout.write(`topic:   ${topic.base_text}\nangle:   ${topic.angle_text}\n`);
      }
      if (post.lesson_text) {
        process.stdout.write(`lesson:  ${post.lesson_text}\n`);
      }
      if (post.summary) {
        process.stdout.write(`summary: ${post.summary}  (${post.summary_char_count} chars)\n`);
      }
      if (post.image_url) {
        process.stdout.write(`card:    ${post.image_url}\n`);
      }
      process.stdout.write(`\n${post.body}\n`);
    });
  });

program
  .command("approve")
  .argument("<post_id>")
  .description("Mark a post approved (eligible for image cards)")
  .action((postId: string) => setPostApprovalFromCli(postId, "approved"));

program
  .command("reject")
  .argument("<post_id>")
  .description("Mark a post rejected")
  .action((postId: string) => setPostApprovalFromCli(postId, "rejected"));

program
  .command("publish")
  .argument("<post_id>")
  .description("Mark an approved post published (manual — there's no unpublish)")
  .action(async (postId: string) => {
    const { publishPost } = await import("./store/posts.js");
    try {
      await migrate();
      await publishPost(postId);
      process.stdout.write(`${postId} → published\n`);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

program
  .command("approve-all")
  .argument("<run_id>")
  .option("--include-flagged", "also approve posts flagged for dup or length")
  .description("Approve every pending post in a run")
  .action(async (runId: string, opts: { includeFlagged?: boolean }) => {
    await migrate();
    const count = await approvePendingInRun(runId, opts.includeFlagged === true);
    process.stdout.write(`approved ${count} post(s)\n`);
  });

async function setPostApprovalFromCli(postId: string, approval: Approval): Promise<void> {
  const { changePostApproval } = await import("./store/posts.js");
  try {
    await migrate();
    const { warning } = await changePostApproval(postId, approval);
    if (warning) logger.warn(`post ${postId}: ${warning}`);
    process.stdout.write(`${postId} → ${approval}\n`);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

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
  .description("Write a run's posts to the export directory")
  .action(async (runId: string, opts: { format: string }) => {
    const format = opts.format === "json" ? "json" : "md";
    const { exportRun } = await import("./export/index.js");
    const result = await exportRun(runId, format);
    process.stdout.write(
      `exported ${result.files.length} file(s) to ${result.outDir}\n`,
    );
  });

program
  .command("cards")
  .argument("<run_id>")
  .option("--limit <n>", "max cards to render this run", (value) => Number.parseInt(value, 10))
  .description("Render Imejis cards for approved posts that don't have one yet")
  .action(async (runId: string, opts: { limit?: number }) => {
    const [{ generateCardsForRun, imejisRenderer }, { getImageStore }] = await Promise.all([
      import("./cards/run.js"),
      import("./cards/factory.js"),
    ]);
    const limit = opts.limit ?? loadEnv().CARD_BATCH_LIMIT;
    const result = await generateCardsForRun({
      runId,
      limit,
      renderer: imejisRenderer,
      store: getImageStore(),
    });
    process.stdout.write(
      `cards: ${result.rendered} rendered, ${result.reused} reused, ` +
        `${result.failed} failed  (${result.attempted} posts)\n`,
    );
    if (result.failed > 0) process.exitCode = 1;
  });

program
  .command("card")
  .argument("<post_id>")
  .description("(Re)render one post's card — e.g. after editing its summary")
  .action(async (postId: string) => {
    const [{ generateOneCard, imejisRenderer }, { getImageStore }] = await Promise.all([
      import("./cards/run.js"),
      import("./cards/factory.js"),
    ]);
    const { url } = await generateOneCard({ postId, renderer: imejisRenderer, store: getImageStore() });
    process.stdout.write(`${postId} → ${url}\n`);
  });

program
  .command("golden-add")
  .requiredOption("--title <title>", "a short label, at most 80 characters")
  .requiredOption("--body-file <path>", "file containing the golden post's body text")
  .requiredOption("--format <format>", "short | long")
  .option("--hook-style <style>", "questions | callout (required when --format long)")
  .option("--design <design_template_id>", "a design template id to assign")
  .requiredOption("--length-min <n>", "ideal body character count, lower bound", Number)
  .requiredOption("--length-max <n>", "ideal body character count, upper bound", Number)
  .description("Add a golden (voice-reference) post — max 5 total")
  .action(
    async (opts: {
      title: string;
      bodyFile: string;
      format: string;
      hookStyle?: string;
      design?: string;
      lengthMin: number;
      lengthMax: number;
    }) => {
      await migrate();
      try {
        const goldenPost = await insertGoldenPost({
          title: opts.title,
          body: readFileSync(opts.bodyFile, "utf8"),
          format: opts.format as PostFormat,
          hook_style: (opts.hookStyle as HookStyle) ?? null,
          design_template_id: opts.design ?? null,
          ideal_length_min: opts.lengthMin,
          ideal_length_max: opts.lengthMax,
        });
        process.stdout.write(`${goldenPost.id} added (${goldenPost.format}/${goldenPost.hook_style ?? "n/a"})\n`);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    },
  );

program
  .command("golden-update")
  .argument("<id>")
  .option("--title <title>", "a short label, at most 80 characters")
  .option("--body-file <path>", "file containing the golden post's body text")
  .option("--format <format>", "short | long")
  .option("--hook-style <style>", "questions | callout")
  .option("--design <design_template_id>", "a design template id to assign")
  .option("--length-min <n>", "ideal body character count, lower bound", Number)
  .option("--length-max <n>", "ideal body character count, upper bound", Number)
  .description("Update a golden post")
  .action(
    async (
      id: string,
      opts: {
        title?: string;
        bodyFile?: string;
        format?: string;
        hookStyle?: string;
        design?: string;
        lengthMin?: number;
        lengthMax?: number;
      },
    ) => {
      await migrate();
      try {
        const goldenPost = await updateGoldenPost(id, {
          title: opts.title,
          body: opts.bodyFile ? readFileSync(opts.bodyFile, "utf8") : undefined,
          format: opts.format as PostFormat | undefined,
          hook_style: opts.hookStyle as HookStyle | undefined,
          design_template_id: opts.design,
          ideal_length_min: opts.lengthMin,
          ideal_length_max: opts.lengthMax,
        });
        process.stdout.write(`${goldenPost.id} updated (${goldenPost.format}/${goldenPost.hook_style ?? "n/a"})\n`);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    },
  );

program
  .command("golden-get")
  .argument("<id>")
  .description("Print one golden post")
  .action(async (id: string) => {
    await migrate();
    const goldenPost = await getGoldenPost(id);
    if (!goldenPost) {
      logger.error(`no golden post with id ${id}`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `${goldenPost.id}  ${goldenPost.title ?? "(untitled)"}  ${goldenPost.format}/${goldenPost.hook_style ?? "n/a"}  ` +
        `design=${goldenPost.design_template_id ?? "-"}  length=${goldenPost.ideal_length_min ?? "-"}-${goldenPost.ideal_length_max ?? "-"}\n\n${goldenPost.body}\n`,
    );
  });

program
  .command("golden-list")
  .description("List every golden post")
  .action(async () => {
    await migrate();
    const goldenPosts = await listGoldenPosts();
    if (goldenPosts.length === 0) {
      logger.info("no golden posts yet — add one with golden-add");
      return;
    }
    for (const goldenPost of goldenPosts) {
      process.stdout.write(
        `${goldenPost.id}  ${goldenPost.title ?? "(untitled)"}  ${goldenPost.format}/${goldenPost.hook_style ?? "n/a"}  ` +
          `design=${goldenPost.design_template_id ?? "-"}\n` +
          `    ${goldenPost.body.slice(0, 100).replace(/\s+/g, " ")}…\n`,
      );
    }
  });

program
  .command("golden-delete")
  .argument("<id>")
  .description("Delete a golden post")
  .action(async (id: string) => {
    await migrate();
    try {
      await deleteGoldenPost(id);
      process.stdout.write(`${id} deleted\n`);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

program
  .command("design-add")
  .requiredOption("--name <name>", "a short label, at most 60 characters")
  .requiredOption("--imejis-id <id>", "the Imejis design ID this template renders with")
  .requiredOption("--image-file <path>", "a preview image (png/jpeg/webp) for the picker UI")
  .description("Add a design template")
  .action(async (opts: { name: string; imejisId: string; imageFile: string }) => {
    await migrate();
    try {
      const { createDesignTemplate } = await import("./design-templates/manage.js");
      const designTemplate = await createDesignTemplate({
        name: opts.name,
        imejisDesignId: opts.imejisId,
        imageBuffer: readFileSync(opts.imageFile),
        contentType: contentTypeFromPath(opts.imageFile),
      });
      process.stdout.write(`${designTemplate.id} added (${designTemplate.name})\n`);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

program
  .command("design-update")
  .argument("<id>")
  .option("--name <name>", "a short label, at most 60 characters")
  .option("--imejis-id <id>", "the Imejis design ID this template renders with")
  .option("--image-file <path>", "a replacement preview image (png/jpeg/webp)")
  .description("Update a design template")
  .action(async (id: string, opts: { name?: string; imejisId?: string; imageFile?: string }) => {
    await migrate();
    try {
      const { editDesignTemplate } = await import("./design-templates/manage.js");
      const designTemplate = await editDesignTemplate(id, {
        name: opts.name,
        imejisDesignId: opts.imejisId,
        image: opts.imageFile
          ? { buffer: readFileSync(opts.imageFile), contentType: contentTypeFromPath(opts.imageFile) }
          : undefined,
      });
      process.stdout.write(`${designTemplate.id} updated (${designTemplate.name})\n`);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

program
  .command("design-get")
  .argument("<id>")
  .description("Print one design template")
  .action(async (id: string) => {
    await migrate();
    const { getDesignTemplate } = await import("./store/design-templates.js");
    const designTemplate = await getDesignTemplate(id);
    if (!designTemplate) {
      logger.error(`no design template with id ${id}`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `${designTemplate.id}  ${designTemplate.name}  imejis=${designTemplate.imejis_design_id}\n` +
        `preview: ${designTemplate.preview_image_url}\n`,
    );
  });

program
  .command("design-list")
  .description("List every design template")
  .action(async () => {
    await migrate();
    const { listDesignTemplates } = await import("./store/design-templates.js");
    const designTemplates = await listDesignTemplates();
    if (designTemplates.length === 0) {
      logger.info("no design templates yet — add one with design-add");
      return;
    }
    for (const designTemplate of designTemplates) {
      process.stdout.write(
        `${designTemplate.id}  ${designTemplate.name}  imejis=${designTemplate.imejis_design_id}\n`,
      );
    }
  });

program
  .command("design-delete")
  .argument("<id>")
  .description("Delete a design template")
  .action(async (id: string) => {
    await migrate();
    try {
      const { removeDesignTemplate } = await import("./design-templates/manage.js");
      const { detachedGoldenPosts } = await removeDesignTemplate(id);
      process.stdout.write(
        `${id} deleted` +
          (detachedGoldenPosts > 0 ? ` (${detachedGoldenPosts} golden post(s) unassigned)\n` : "\n"),
      );
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

function contentTypeFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  throw new Error(`unsupported image extension in ${path} — use .png, .jpg/.jpeg, or .webp`);
}

program
  .command("stats")
  .description("Quick database overview")
  .action(async () => {
    await migrate();
    const run = await latestRun();
    process.stdout.write(`vectors stored: ${await countEmbeddings()}\n`);
    if (run) {
      process.stdout.write(
        `latest run: ${run.id}  flow=${run.flow}  ${run.created_at}\n` +
          `  status:   ${JSON.stringify(await countByStatus(run.id))}\n` +
          `  approval: ${JSON.stringify(await countByApproval(run.id))}\n`,
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

// closeDb() is async (ending a connection pool needs a round trip), and
// Node's "exit" event is strictly synchronous — it won't wait for a promise
// started inside it. Closing explicitly here, after the command finishes
// either way, replaces the old process.on("exit", closeDb).
try {
  await program.parseAsync();
} catch (err) {
  logger.error("command failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
} finally {
  await closeDb();
}
