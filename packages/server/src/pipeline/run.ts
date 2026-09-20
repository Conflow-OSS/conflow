import { readFileSync } from "node:fs";
import { loadEnv } from "../config/load.js";
import { embedDocuments } from "../embeddings/voyage.js";
import type { ContentModel } from "../models/types.js";
import { listGoldenPosts } from "../store/golden-posts.js";
import { migrate } from "../store/migrate.js";
import { insertPost } from "../store/posts.js";
import { insertRun, setRunProgress, setRunStatus } from "../store/runs.js";
import { insertTopic } from "../store/topics.js";
import type { GoldenPostRow, RunRow } from "../store/types.js";
import { nearestLedgerMatch, upsertEmbedding } from "../store/vec.js";
import { logger } from "../util/logger.js";
import { type EmbeddedPost, findDuplicate } from "./dedup.js";
import { expandAngleIntoLessons, expandStoryIntoTopics, expandTopicIntoAngles } from "./expand.js";
import { type GeneratedPost, generatePost } from "./generate.js";
import { loadTopicList, parseTopicList } from "./inputs.js";
import { type PostSlot, planPostSlots } from "./plan.js";

export interface MatrixRunResult {
  runId: string;
  postsCreated: number;
  flaggedForLength: number;
  flaggedAsDuplicate: number;
}

export interface RunProgress {
  phase: "expanding" | "generating" | "done";
  postsCreated: number;
  postsExpected: number;
}

export type ProgressReporter = (progress: RunProgress) => void | Promise<void>;

function runConfig(model: ContentModel) {
  const env = loadEnv();
  return { topicCount: env.GEN_X, anglesPerTopic: env.GEN_Y, postsPerAngle: env.GEN_Z, model: model.model };
}

export interface RunConfig {
  topicCount: number;
  anglesPerTopic: number;
  postsPerAngle: number;
}

/**
 * The run's own recorded config is the source of truth for how it executes —
 * not a fresh `loadEnv()` read at execution time, which could silently differ
 * from what was actually requested if the env changed between queuing and the
 * worker picking it up. The CLI's entrypoints below build this from env
 * directly (there's no per-invocation override there); the API lets a caller
 * override any of the three explicitly, falling back to env per-field.
 * Missing/malformed fields (e.g. a run row from before this existed) fall
 * back to env too, so old rows keep working unchanged.
 */
export function parseRunConfig(configJson: string): RunConfig {
  const env = loadEnv();
  let parsed: Partial<RunConfig> = {};
  try {
    parsed = JSON.parse(configJson) as Partial<RunConfig>;
  } catch {
    // leave parsed empty — every field below falls back to env
  }
  return {
    topicCount: parsed.topicCount ?? env.GEN_X,
    anglesPerTopic: parsed.anglesPerTopic ?? env.GEN_Y,
    postsPerAngle: parsed.postsPerAngle ?? env.GEN_Z,
  };
}

// ── CLI entrypoints — read the input file, create the run row, then execute ──

export async function runMatrixFlowFromTopicList(
  topicListPath: string,
  model: ContentModel,
): Promise<MatrixRunResult> {
  await migrate();
  const baseTopics = loadTopicList(topicListPath);
  const run = await insertRun({
    flow: "matrix",
    config: runConfig(model),
    input_kind: "topic_list",
    input_text: baseTopics.join("\n"),
  });
  return runGenerationForRun(run, model);
}

export async function runMatrixFlowFromStory(
  storyPath: string,
  model: ContentModel,
): Promise<MatrixRunResult> {
  await migrate();
  const story = readFileSync(storyPath, "utf8").trim();
  if (story.length === 0) {
    throw new Error(`story file is empty: ${storyPath}`);
  }
  const run = await insertRun({
    flow: "matrix",
    config: runConfig(model),
    input_kind: "story",
    input_text: story,
  });
  return runGenerationForRun(run, model);
}

/**
 * Case-study flow: like the story flow, but the case study is Prince's own
 * project, so its full text is passed as source facts and the model writes
 * grounded, first-person posts instead of general advice.
 */
export async function runCaseStudyFlow(
  caseStudyPath: string,
  model: ContentModel,
): Promise<MatrixRunResult> {
  await migrate();
  const caseStudy = readFileSync(caseStudyPath, "utf8").trim();
  if (caseStudy.length === 0) {
    throw new Error(`case study file is empty: ${caseStudyPath}`);
  }
  const run = await insertRun({
    flow: "casestudy",
    config: runConfig(model),
    input_kind: "story",
    input_text: caseStudy,
  });
  return runGenerationForRun(run, model);
}

/**
 * Execute a generation run whose row already exists. Both the CLI (right after
 * creating the row) and the queue worker (picking up a queued row) call this.
 * Moves the run through running → completed / failed and reports progress.
 */
export async function runGenerationForRun(
  run: RunRow,
  model: ContentModel,
  onProgress?: ProgressReporter,
): Promise<MatrixRunResult> {
  await migrate();
  const config = parseRunConfig(run.config_json);

  const report: ProgressReporter = async (progress) => {
    await setRunProgress(run.id, progress);
    if (onProgress) await onProgress(progress);
  };

  await setRunStatus(run.id, "running");

  try {
    const story = run.input_text ?? "";
    let baseTopics: string[];

    if (run.input_kind === "topic_list") {
      baseTopics = parseTopicList(story);
    } else {
      await report({ phase: "expanding", postsCreated: 0, postsExpected: 0 });
      baseTopics = await expandStoryIntoTopics(story, config.topicCount, model);
      logger.info("story expanded into topics", { runId: run.id, count: baseTopics.length });
    }

    const sourceFacts = run.flow === "casestudy" ? story : undefined;
    const result = await runMatrixLoop({
      run,
      baseTopics,
      sourceFacts,
      model,
      report,
      anglesPerTopic: config.anglesPerTopic,
      postsPerAngle: config.postsPerAngle,
    });

    await setRunStatus(run.id, "completed");
    await report({
      phase: "done",
      postsCreated: result.postsCreated,
      postsExpected: result.postsCreated,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setRunStatus(run.id, "failed", message);
    logger.error("generation run failed", { runId: run.id, error: message });
    throw error;
  }
}

/**
 * The matrix loop: for each base topic, expand into GEN_Y angles, then generate
 * GEN_Z posts per angle, checking each for near-duplicates before it is stored.
 */
async function runMatrixLoop(input: {
  run: RunRow;
  baseTopics: string[];
  sourceFacts?: string;
  model: ContentModel;
  report: ProgressReporter;
  anglesPerTopic: number;
  postsPerAngle: number;
}): Promise<MatrixRunResult> {
  const { run, baseTopics, model, sourceFacts, report, anglesPerTopic, postsPerAngle } = input;

  const postsExpected = baseTopics.length * anglesPerTopic * postsPerAngle;

  logger.info("matrix run start", {
    runId: run.id,
    topics: baseTopics.length,
    anglesPerTopic,
    postsPerAngle,
    postsExpected,
  });

  // Fetched once, up front — fails fast (before any topic-expansion LLM
  // calls) if there's nothing to plan the format/hook/voice mix from.
  const goldenPosts = await listGoldenPosts();
  const postSlots = planPostSlots(postsExpected, goldenPosts);
  let nextSlotIndex = 0;

  const totals = { postsCreated: 0, flaggedForLength: 0, flaggedAsDuplicate: 0 };

  for (let baseIndex = 0; baseIndex < baseTopics.length; baseIndex++) {
    const baseTopic = baseTopics[baseIndex]!;
    const angles = await expandTopicIntoAngles(baseTopic, anglesPerTopic, model);
    logger.info("topic expanded", { baseTopic, angles });

    for (let angleIndex = 0; angleIndex < angles.length; angleIndex++) {
      const angle = angles[angleIndex]!;
      const topicRow = await insertTopic({
        run_id: run.id,
        base_text: baseTopic,
        base_index: baseIndex,
        angle_text: angle,
        angle_index: angleIndex,
      });

      const lessons = await expandAngleIntoLessons(
        baseTopic,
        angle,
        postsPerAngle,
        model,
        sourceFacts,
      );
      logger.info("angle expanded into lessons", { angle, lessons });

      const slotsForThisAngle = postSlots.slice(nextSlotIndex, nextSlotIndex + postsPerAngle);
      nextSlotIndex += postsPerAngle;

      const angleTotals = await generateAndPersistLessons({
        runId: run.id,
        topicId: topicRow.id,
        baseTopic,
        angle,
        lessons,
        slots: slotsForThisAngle,
        sourceFacts,
        model,
        goldenPosts,
      });

      totals.postsCreated += angleTotals.created;
      totals.flaggedForLength += angleTotals.flaggedForLength;
      totals.flaggedAsDuplicate += angleTotals.flaggedAsDuplicate;

      await report({
        phase: "generating",
        postsCreated: totals.postsCreated,
        postsExpected,
      });
    }
  }

  logger.info("matrix run done", { runId: run.id, ...totals });
  return { runId: run.id, ...totals };
}

async function generateAndPersistLessons(input: {
  runId: string;
  topicId: string;
  baseTopic: string;
  angle: string;
  lessons: string[];
  slots: PostSlot[];
  sourceFacts?: string;
  model: ContentModel;
  goldenPosts: GoldenPostRow[];
}): Promise<{ created: number; flaggedForLength: number; flaggedAsDuplicate: number }> {
  const env = loadEnv();

  // Phase 1 — one post per lesson. Each post is told the other lessons so it stays on its own.
  const generatedVariants: Array<{ variant: GeneratedPost; slot: PostSlot; lesson: string }> = [];
  for (let lessonIndex = 0; lessonIndex < input.lessons.length; lessonIndex++) {
    const lesson = input.lessons[lessonIndex]!;
    const slot = input.slots[lessonIndex]!;
    const otherLessons = input.lessons.filter((_, index) => index !== lessonIndex);

    const variant = await generatePost(
      {
        mode: "generate",
        topic: input.baseTopic,
        angle: input.angle,
        lesson,
        otherLessons,
        format: slot.format,
        hookStyle: slot.hookStyle,
        variantNumber: lessonIndex + 1,
        variantCount: input.lessons.length,
        summaryMaxChars: env.SUMMARY_MAX_CHARS,
        sourceFacts: input.sourceFacts,
      },
      input.model,
      input.goldenPosts,
    );
    generatedVariants.push({ variant, slot, lesson });
  }

  // Phase 2 — embed them all at once, then dedup-check and store each in order.
  const embeddings = await embedDocuments(generatedVariants.map((g) => g.variant.parsed.body));
  const storedSiblingEmbeddings: EmbeddedPost[] = [];

  const totals = { created: 0, flaggedForLength: 0, flaggedAsDuplicate: 0 };

  for (let variantIndex = 0; variantIndex < generatedVariants.length; variantIndex++) {
    const { variant, slot, lesson } = generatedVariants[variantIndex]!;
    const embedding = embeddings[variantIndex]!;

    let status = variant.status;
    let flagReason = variant.flagReason;
    let duplicateOfPostId: string | null = null;
    let duplicateScore: number | null = null;

    if (status === "ok") {
      const ledgerMatch = await nearestLedgerMatch(embedding, {
        excludeTopicId: input.topicId,
        windowDays: env.DEDUP_LEDGER_WINDOW_DAYS,
      });
      const match = findDuplicate({
        postEmbedding: embedding,
        siblingEmbeddings: storedSiblingEmbeddings,
        siblingThreshold: env.DEDUP_SIBLING_THRESHOLD,
        ledgerMatch,
        ledgerThreshold: env.DEDUP_LEDGER_THRESHOLD,
      });
      if (match) {
        status = "flag_dup";
        flagReason = match.reason;
        duplicateOfPostId = match.duplicateOfPostId;
        duplicateScore = match.similarity;
      }
    }

    const post = await insertPost({
      kind: "generated",
      run_id: input.runId,
      topic_id: input.topicId,
      variant_index: variantIndex,
      format: slot.format,
      hook_style: slot.hookStyle,
      golden_post_id: slot.goldenPostId,
      topic_angle: variant.parsed.topicAngle,
      lesson_text: lesson,
      body: variant.parsed.body,
      summary: variant.parsed.summary,
      status,
      flag_reason: flagReason,
      dup_of_id: duplicateOfPostId,
      dup_score: duplicateScore,
      model_channel: input.model.channel,
      model_id: input.model.model,
    });
    await upsertEmbedding(post.id, embedding);
    storedSiblingEmbeddings.push({ postId: post.id, embedding });

    totals.created++;
    if (status === "flag_length") totals.flaggedForLength++;
    if (status === "flag_dup") totals.flaggedAsDuplicate++;

    logger.info("post stored", {
      baseTopic: input.baseTopic,
      angle: input.angle,
      variantIndex,
      format: slot.format,
      status,
    });
  }

  return totals;
}
