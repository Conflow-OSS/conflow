import { readFileSync } from "node:fs";
import { loadEnv } from "../config/load.js";
import { embedDocuments } from "../embeddings/voyage.js";
import type { ContentModel } from "../models/types.js";
import { migrate } from "../store/migrate.js";
import { insertPost } from "../store/posts.js";
import { insertRun } from "../store/runs.js";
import { insertTopic } from "../store/topics.js";
import type { Flow, InputKind } from "../store/types.js";
import { upsertEmbedding } from "../store/vec.js";
import { logger } from "../util/logger.js";
import { type EmbeddedPost, findDuplicate, loadLedgerEmbeddings } from "./dedup.js";
import { expandAngleIntoLessons, expandStoryIntoTopics, expandTopicIntoAngles } from "./expand.js";
import { type GeneratedVariant, generateOneVariant } from "./generate.js";
import { loadTopicList } from "./inputs.js";
import { type PostSlot, planPostSlots } from "./plan.js";

export interface MatrixRunResult {
  runId: string;
  postsCreated: number;
  flaggedForLength: number;
  flaggedAsDuplicate: number;
}

export async function runMatrixFlowFromTopicList(
  topicListPath: string,
  model: ContentModel,
): Promise<MatrixRunResult> {
  migrate();
  const baseTopics = loadTopicList(topicListPath);
  return runMatrix({
    flow: "matrix",
    baseTopics,
    inputKind: "topic_list",
    inputText: baseTopics.join("\n"),
    model,
  });
}

export async function runMatrixFlowFromStory(
  storyPath: string,
  model: ContentModel,
): Promise<MatrixRunResult> {
  migrate();
  const env = loadEnv();

  const story = readFileSync(storyPath, "utf8").trim();
  if (story.length === 0) {
    throw new Error(`story file is empty: ${storyPath}`);
  }

  const baseTopics = await expandStoryIntoTopics(story, env.GEN_X, model);
  logger.info("story expanded into topics", { count: baseTopics.length, topics: baseTopics });

  return runMatrix({ flow: "matrix", baseTopics, inputKind: "story", inputText: story, model });
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
  migrate();
  const env = loadEnv();

  const caseStudy = readFileSync(caseStudyPath, "utf8").trim();
  if (caseStudy.length === 0) {
    throw new Error(`case study file is empty: ${caseStudyPath}`);
  }

  const baseTopics = await expandStoryIntoTopics(caseStudy, env.GEN_X, model);
  logger.info("case study expanded into topics", { count: baseTopics.length, topics: baseTopics });

  return runMatrix({
    flow: "casestudy",
    baseTopics,
    inputKind: "story",
    inputText: caseStudy,
    sourceFacts: caseStudy,
    model,
  });
}

/**
 * The shared matrix loop: for each base topic, expand into GEN_Y angles, then
 * generate GEN_Z posts per angle, checking each for near-duplicates before it
 * is stored.
 */
async function runMatrix(input: {
  flow: Flow;
  baseTopics: string[];
  inputKind: InputKind;
  inputText: string;
  sourceFacts?: string;
  model: ContentModel;
}): Promise<MatrixRunResult> {
  const env = loadEnv();
  const { baseTopics, model, sourceFacts } = input;

  const anglesPerTopic = env.GEN_Y;
  const postsPerAngle = env.GEN_Z;
  const totalPosts = baseTopics.length * anglesPerTopic * postsPerAngle;

  const run = insertRun({
    flow: input.flow,
    config: { topics: baseTopics.length, anglesPerTopic, postsPerAngle, model: model.model },
    input_kind: input.inputKind,
    input_text: input.inputText,
  });

  logger.info("matrix run start", {
    runId: run.id,
    topics: baseTopics.length,
    anglesPerTopic,
    postsPerAngle,
    totalPosts,
  });

  const postSlots = planPostSlots(totalPosts, env.SHORT_FORM_RATIO, env.HOOK_SPLIT);
  let nextSlotIndex = 0;

  const totals = { postsCreated: 0, flaggedForLength: 0, flaggedAsDuplicate: 0 };

  for (let baseIndex = 0; baseIndex < baseTopics.length; baseIndex++) {
    const baseTopic = baseTopics[baseIndex]!;
    const angles = await expandTopicIntoAngles(baseTopic, anglesPerTopic, model);
    logger.info("topic expanded", { baseTopic, angles });

    for (let angleIndex = 0; angleIndex < angles.length; angleIndex++) {
      const angle = angles[angleIndex]!;
      const topicRow = insertTopic({
        run_id: run.id,
        base_text: baseTopic,
        base_index: baseIndex,
        angle_text: angle,
        angle_index: angleIndex,
      });

      const lessons = await expandAngleIntoLessons(baseTopic, angle, postsPerAngle, model, sourceFacts);
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
      });

      totals.postsCreated += angleTotals.created;
      totals.flaggedForLength += angleTotals.flaggedForLength;
      totals.flaggedAsDuplicate += angleTotals.flaggedAsDuplicate;
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
}): Promise<{ created: number; flaggedForLength: number; flaggedAsDuplicate: number }> {
  const env = loadEnv();

  // Phase 1 — one post per lesson. Each post is told the other lessons so it stays on its own.
  const generatedVariants: Array<{ variant: GeneratedVariant; slot: PostSlot; lesson: string }> = [];
  for (let lessonIndex = 0; lessonIndex < input.lessons.length; lessonIndex++) {
    const lesson = input.lessons[lessonIndex]!;
    const slot = input.slots[lessonIndex]!;
    const otherLessons = input.lessons.filter((_, index) => index !== lessonIndex);

    const variant = await generateOneVariant(
      {
        topic: input.baseTopic,
        angle: input.angle,
        lesson,
        otherLessons,
        format: slot.format,
        hookStyle: slot.hookStyle,
        variantNumber: lessonIndex + 1,
        variantCount: input.lessons.length,
        sourceFacts: input.sourceFacts,
      },
      input.model,
    );
    generatedVariants.push({ variant, slot, lesson });
  }

  // Phase 2 — embed them all at once, then dedup-check and store each in order.
  const embeddings = await embedDocuments(generatedVariants.map((g) => g.variant.parsed.body));
  const ledgerEmbeddings = loadLedgerEmbeddings(input.topicId);
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
      const match = findDuplicate({
        postEmbedding: embedding,
        siblingEmbeddings: storedSiblingEmbeddings,
        ledgerEmbeddings,
        siblingThreshold: env.DEDUP_SIBLING_THRESHOLD,
        ledgerThreshold: env.DEDUP_LEDGER_THRESHOLD,
      });
      if (match) {
        status = "flag_dup";
        flagReason = match.reason;
        duplicateOfPostId = match.duplicateOfPostId;
        duplicateScore = match.similarity;
      }
    }

    const post = insertPost({
      kind: "generated",
      run_id: input.runId,
      topic_id: input.topicId,
      variant_index: variantIndex,
      format: slot.format,
      hook_style: slot.hookStyle,
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
    upsertEmbedding(post.id, embedding);
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
