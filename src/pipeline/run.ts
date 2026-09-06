import { readFileSync } from "node:fs";
import { loadEnv } from "../config/load.js";
import type { ContentModel } from "../models/types.js";
import { migrate } from "../store/migrate.js";
import { insertPost } from "../store/posts.js";
import { insertRun } from "../store/runs.js";
import { insertTopic } from "../store/topics.js";
import type { InputKind } from "../store/types.js";
import { logger } from "../util/logger.js";
import { expandStoryIntoTopics, expandTopicIntoAngles } from "./expand.js";
import { generateOneVariant } from "./generate.js";
import { loadTopicList } from "./inputs.js";
import { planPostSlots } from "./plan.js";

export interface MatrixRunResult {
  runId: string;
  postsCreated: number;
  flaggedForLength: number;
}

export async function runMatrixFlowFromTopicList(
  topicListPath: string,
  model: ContentModel,
): Promise<MatrixRunResult> {
  migrate();
  const baseTopics = loadTopicList(topicListPath);
  return runMatrix({
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

  return runMatrix({ baseTopics, inputKind: "story", inputText: story, model });
}

/**
 * The shared matrix loop: for each base topic, expand into GEN_Y angles, then
 * generate GEN_Z posts per angle. Deduplication arrives in M9.
 */
async function runMatrix(input: {
  baseTopics: string[];
  inputKind: InputKind;
  inputText: string;
  model: ContentModel;
}): Promise<MatrixRunResult> {
  const env = loadEnv();
  const { baseTopics, model } = input;

  const anglesPerTopic = env.GEN_Y;
  const postsPerAngle = env.GEN_Z;
  const totalPosts = baseTopics.length * anglesPerTopic * postsPerAngle;

  const run = insertRun({
    flow: "matrix",
    config: {
      topics: baseTopics.length,
      anglesPerTopic,
      postsPerAngle,
      model: model.model,
    },
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
  let postsCreated = 0;
  let flaggedForLength = 0;

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

      const previousVariantBodies: string[] = [];
      for (let variantIndex = 0; variantIndex < postsPerAngle; variantIndex++) {
        const slot = postSlots[nextSlotIndex]!;
        nextSlotIndex++;

        const variant = await generateOneVariant(
          {
            topic: baseTopic,
            angle,
            format: slot.format,
            hookStyle: slot.hookStyle,
            variantNumber: variantIndex + 1,
            variantCount: postsPerAngle,
            previousVariantBodies,
          },
          model,
        );

        insertPost({
          kind: "generated",
          run_id: run.id,
          topic_id: topicRow.id,
          variant_index: variantIndex,
          format: slot.format,
          hook_style: slot.hookStyle,
          topic_angle: variant.parsed.topicAngle,
          body: variant.parsed.body,
          status: variant.status,
          flag_reason: variant.flagReason,
          model_channel: model.channel,
          model_id: model.model,
        });

        previousVariantBodies.push(variant.parsed.body);
        postsCreated++;
        if (variant.status === "flag_length") {
          flaggedForLength++;
        }

        logger.info("post generated", {
          baseIndex,
          angleIndex,
          variantIndex,
          format: slot.format,
          status: variant.status,
        });
      }
    }
  }

  logger.info("matrix run done", { runId: run.id, postsCreated, flaggedForLength });
  return { runId: run.id, postsCreated, flaggedForLength };
}
