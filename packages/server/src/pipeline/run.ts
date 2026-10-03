import { readFileSync } from "node:fs";
import { loadEnv } from "../config/load.js";
import { embedDocuments } from "../embeddings/voyage.js";
import type { ContentModel } from "../models/types.js";
import { getDb } from "../store/db.js";
import { listGoldenPosts } from "../store/golden-posts.js";
import { countByStatus, insertPost, listPostsByTopic } from "../store/posts.js";
import { insertRun, setRunProgress, setRunSlots, setRunStatus } from "../store/runs.js";
import { insertTopic, listTopicsByRun, setTopicLessons } from "../store/topics.js";
import type { GoldenPostRow, RunRow, TopicRow } from "../store/types.js";
import { nearestLedgerMatch, upsertEmbedding } from "../store/vec.js";
import { logger } from "../util/logger.js";
import { type EmbeddedPost, findDuplicate, loadEmbeddingsForPosts } from "./dedup.js";
import { expandAngleIntoLessons, expandStoryIntoTopics, expandTopicIntoAngles } from "./expand.js";
import { type GeneratedPost, generatePost } from "./generate.js";
import { loadTopicList, parseTopicList } from "./inputs.js";
import { type PostSlot, planPostSlots } from "./plan.js";

/** Rebuilt from the DB rather than accumulated in memory, so it's correct
 *  whether this is a run's first attempt or a resumed one. */
async function summarizeRun(runId: string): Promise<MatrixRunResult> {
  const counts = await countByStatus(runId);
  const postsCreated = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return {
    runId,
    postsCreated,
    flaggedForLength: counts.flag_length ?? 0,
    flaggedAsDuplicate: counts.flag_dup ?? 0,
  };
}

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
 *
 * Safe to call more than once for the same run — a redelivered queue job (a
 * stalled lock, a Spot interruption) lands here too. Two guards make that
 * safe instead of wasteful:
 *   - if the run already reached "completed", this is a no-op — deliberately
 *     NOT true for "failed" too: a run can fail for a transient reason (a
 *     network blip that exhausted its retries, say), and failed runs aren't
 *     just inert history — see runs.ts's RunStatus / the CLI's lack of any
 *     "retry" command for why nothing currently re-invokes this on a failed
 *     run automatically, but if anything ever does (a future retry action, a
 *     human re-enqueueing it by hand), it must actually resume, not silently
 *     no-op forever.
 *   - a Postgres advisory lock keyed on the run id makes sure only one
 *     attempt is actually doing work at a time; a second attempt that
 *     arrives while the first is still running backs off immediately rather
 *     than racing it.
 * Within a single, lock-holding attempt, runMatrixLoop/generateAndPersistLessons
 * also resume from whatever's already in the DB (existing topics, lessons,
 * posts) rather than redoing it — see their own comments.
 */
export async function runGenerationForRun(
  run: RunRow,
  model: ContentModel,
  onProgress?: ProgressReporter,
): Promise<MatrixRunResult> {
  if (run.status === "completed") {
    logger.info("run already finished — a redelivered job has nothing to do", {
      runId: run.id,
      status: run.status,
    });
    return summarizeRun(run.id);
  }

  const reserved = await getDb().reserve();
  try {
    const [{ locked }] = await reserved<[{ locked: boolean }]>`
      SELECT pg_try_advisory_lock(hashtext(${run.id})::bigint) AS locked
    `;
    if (!locked) {
      logger.warn("another attempt is already working this run — stepping aside", { runId: run.id });
      return summarizeRun(run.id);
    }

    try {
      return await runGenerationLocked(run, model, onProgress);
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtext(${run.id})::bigint)`;
    }
  } finally {
    reserved.release();
  }
}

async function runGenerationLocked(
  run: RunRow,
  model: ContentModel,
  onProgress?: ProgressReporter,
): Promise<MatrixRunResult> {
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
    await runMatrixLoop({
      run,
      baseTopics,
      sourceFacts,
      model,
      report,
      anglesPerTopic: config.anglesPerTopic,
      postsPerAngle: config.postsPerAngle,
    });

    const result = await summarizeRun(run.id);
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
 *
 * Resumable: everything it's about to do, it first checks the DB for.
 *   - the post-slot plan (format/hook/golden per position) is persisted once
 *     on the run and reused — planPostSlots shuffles randomly, so recomputing
 *     it on a resumed run would hand an already-generated post a different
 *     slot than it actually got, and a not-yet-generated one a different one
 *     than it was always going to get.
 *   - a base topic that already has topic rows skips re-asking the model for
 *     angles; it reuses the stored rows instead.
 *   - generateAndPersistLessons does the same one level deeper, for lessons
 *     and posts.
 */
async function runMatrixLoop(input: {
  run: RunRow;
  baseTopics: string[];
  sourceFacts?: string;
  model: ContentModel;
  report: ProgressReporter;
  anglesPerTopic: number;
  postsPerAngle: number;
}): Promise<void> {
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

  let postSlots: PostSlot[];
  if (run.slots_json) {
    postSlots = JSON.parse(run.slots_json) as PostSlot[];
  } else {
    postSlots = planPostSlots(postsExpected, goldenPosts);
    await setRunSlots(run.id, JSON.stringify(postSlots));
  }
  let nextSlotIndex = 0;

  const existingTopics = await listTopicsByRun(run.id);
  const topicsByBaseIndex = new Map<number, TopicRow[]>();
  for (const topic of existingTopics) {
    const forBase = topicsByBaseIndex.get(topic.base_index) ?? [];
    forBase.push(topic);
    topicsByBaseIndex.set(topic.base_index, forBase);
  }

  for (let baseIndex = 0; baseIndex < baseTopics.length; baseIndex++) {
    const baseTopic = baseTopics[baseIndex]!;
    const existingForBase = (topicsByBaseIndex.get(baseIndex) ?? []).sort(
      (a, b) => a.angle_index - b.angle_index,
    );

    let angles: string[];
    if (existingForBase.length > 0) {
      angles = existingForBase.map((topic) => topic.angle_text);
      logger.info("topic's angles already stored — resuming", {
        runId: run.id,
        baseTopic,
        angleCount: angles.length,
      });
    } else {
      angles = await expandTopicIntoAngles(baseTopic, anglesPerTopic, model);
      logger.info("topic expanded", { baseTopic, angles });
    }

    for (let angleIndex = 0; angleIndex < angles.length; angleIndex++) {
      const angle = angles[angleIndex]!;
      const topicRow =
        existingForBase.find((topic) => topic.angle_index === angleIndex) ??
        (await insertTopic({
          run_id: run.id,
          base_text: baseTopic,
          base_index: baseIndex,
          angle_text: angle,
          angle_index: angleIndex,
        }));

      let lessons: string[];
      if (topicRow.lessons_json) {
        lessons = JSON.parse(topicRow.lessons_json) as string[];
      } else {
        lessons = await expandAngleIntoLessons(baseTopic, angle, postsPerAngle, model, sourceFacts);
        await setTopicLessons(topicRow.id, JSON.stringify(lessons));
        logger.info("angle expanded into lessons", { angle, lessons });
      }

      const slotsForThisAngle = postSlots.slice(nextSlotIndex, nextSlotIndex + postsPerAngle);
      nextSlotIndex += postsPerAngle;

      await generateAndPersistLessons({
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

      const progressSoFar = await summarizeRun(run.id);
      await report({
        phase: "generating",
        postsCreated: progressSoFar.postsCreated,
        postsExpected,
      });
    }
  }

  logger.info("matrix run done", { runId: run.id });
}

/**
 * Resumable at the post level: a variant_index that already has a stored post
 * is left alone, so an interrupted-and-retried angle only generates whatever
 * was actually missing. Known gap, deliberately not closed here: the
 * run-level advisory lock (runGenerationForRun) is what actually makes this
 * safe — as long as it's held, there is only ever one execution deciding
 * which variant_index values are missing. It relies on that lock's session
 * staying alive for as long as the code believes it holds it; if the
 * specific DB connection holding the lock were to drop (not the whole worker
 * process — just that one connection) while this function is mid-flight on a
 * model call that doesn't touch the DB, Postgres releases the lock
 * immediately, and a second attempt could start working before the first
 * notices and stops. There's no DB constraint on (topic_id, variant_index)
 * as a second line of defense against that narrow case, because posts'
 * regenerate path legitimately reuses the same pair for a replacement row —
 * closing it fully means changing regenerate to free the pair before writing
 * the replacement, not after, which is a separate, riskier change left for
 * later.
 */
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
}): Promise<void> {
  const env = loadEnv();

  const existingPosts = await listPostsByTopic(input.topicId);
  const existingVariantIndexes = new Set(existingPosts.map((post) => post.variant_index));
  const missingIndexes = input.lessons
    .map((_lesson, index) => index)
    .filter((index) => !existingVariantIndexes.has(index));

  if (missingIndexes.length === 0) {
    logger.info("angle already fully generated — resuming", {
      angle: input.angle,
      topicId: input.topicId,
    });
    return;
  }

  // Phase 1 — one post per missing lesson. Every lesson under this angle is
  // still passed as context (not just the missing ones), so a post generated
  // now still stays off a sibling that was written in an earlier attempt.
  const generatedVariants: Array<{ variant: GeneratedPost; slot: PostSlot; lesson: string; variantIndex: number }> =
    [];
  for (const variantIndex of missingIndexes) {
    const lesson = input.lessons[variantIndex]!;
    const slot = input.slots[variantIndex]!;
    const otherLessons = input.lessons.filter((_, index) => index !== variantIndex);

    const variant = await generatePost(
      {
        mode: "generate",
        topic: input.baseTopic,
        angle: input.angle,
        lesson,
        otherLessons,
        format: slot.format,
        hookStyle: slot.hookStyle,
        variantNumber: variantIndex + 1,
        variantCount: input.lessons.length,
        summaryMaxChars: env.SUMMARY_MAX_CHARS,
        sourceFacts: input.sourceFacts,
      },
      input.model,
      input.goldenPosts,
    );
    generatedVariants.push({ variant, slot, lesson, variantIndex });
  }

  // Phase 2 — embed the newly generated ones, seed sibling context with
  // whatever this topic already had stored (from an earlier, interrupted
  // attempt), then dedup-check and store each new variant in order.
  const embeddings = await embedDocuments(generatedVariants.map((g) => g.variant.parsed.body));
  const storedSiblingEmbeddings: EmbeddedPost[] = await loadEmbeddingsForPosts(
    existingPosts.map((post) => post.id),
  );

  for (let i = 0; i < generatedVariants.length; i++) {
    const { variant, slot, lesson, variantIndex } = generatedVariants[i]!;
    const embedding = embeddings[i]!;

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

    logger.info("post stored", {
      baseTopic: input.baseTopic,
      angle: input.angle,
      variantIndex,
      format: slot.format,
      status,
    });
  }
}
