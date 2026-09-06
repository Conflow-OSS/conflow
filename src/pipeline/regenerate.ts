import { loadEnv } from "../config/load.js";
import { embedDocuments } from "../embeddings/voyage.js";
import type { ContentModel } from "../models/types.js";
import { migrate } from "../store/migrate.js";
import { getPost, insertPost, setStatus, standingVariantsOfTopic } from "../store/posts.js";
import { getRun } from "../store/runs.js";
import { getTopic } from "../store/topics.js";
import type { PostStatus } from "../store/types.js";
import { upsertEmbedding } from "../store/vec.js";
import { logger } from "../util/logger.js";
import { findDuplicate, loadEmbeddingsForPosts, loadLedgerEmbeddings } from "./dedup.js";
import { generateOneVariant } from "./generate.js";

export interface RegenerateResult {
  oldPostId: string;
  newPostId: string;
  status: PostStatus;
}

/**
 * Replace one generated post with a fresh attempt at the same slot. The old row
 * is kept but marked `regenerated` so it drops out of dedup and review.
 */
export async function regeneratePost(
  postId: string,
  model: ContentModel,
): Promise<RegenerateResult> {
  migrate();
  const env = loadEnv();

  const oldPost = getPost(postId);
  if (!oldPost) {
    throw new Error(`no post with id ${postId}`);
  }
  if (oldPost.kind !== "generated" || !oldPost.topic_id || !oldPost.run_id) {
    throw new Error(`post ${postId} is not a regeneratable generated post`);
  }
  if (oldPost.status === "regenerated") {
    throw new Error(`post ${postId} has already been replaced`);
  }

  const topic = getTopic(oldPost.topic_id);
  if (!topic) {
    throw new Error(`post ${postId} points at a missing topic`);
  }

  const run = getRun(oldPost.run_id);
  const sourceFacts =
    run?.flow === "casestudy" ? (run.input_text ?? undefined) : undefined;

  const siblings = standingVariantsOfTopic(oldPost.topic_id, postId);

  const variant = await generateOneVariant(
    {
      topic: topic.base_text,
      angle: topic.angle_text,
      format: oldPost.format,
      hookStyle: oldPost.hook_style,
      variantNumber: (oldPost.variant_index ?? 0) + 1,
      variantCount: readPostsPerAngle(run?.config_json) ?? env.GEN_Z,
      previousVariantBodies: siblings.map((sibling) => sibling.body),
      sourceFacts,
    },
    model,
  );

  const [embedding] = await embedDocuments([variant.parsed.body]);

  let status = variant.status;
  let flagReason = variant.flagReason;
  let duplicateOfPostId: string | null = null;
  let duplicateScore: number | null = null;

  if (status === "ok") {
    const match = findDuplicate({
      postEmbedding: embedding!,
      siblingEmbeddings: loadEmbeddingsForPosts(siblings.map((sibling) => sibling.id)),
      ledgerEmbeddings: loadLedgerEmbeddings(oldPost.topic_id),
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

  const newPost = insertPost({
    kind: "generated",
    run_id: oldPost.run_id,
    topic_id: oldPost.topic_id,
    variant_index: oldPost.variant_index,
    format: oldPost.format,
    hook_style: oldPost.hook_style,
    topic_angle: variant.parsed.topicAngle,
    body: variant.parsed.body,
    status,
    flag_reason: flagReason,
    dup_of_id: duplicateOfPostId,
    dup_score: duplicateScore,
    model_channel: model.channel,
    model_id: model.model,
  });
  upsertEmbedding(newPost.id, embedding!);
  setStatus(postId, "regenerated");

  logger.info("post regenerated", { oldPostId: postId, newPostId: newPost.id, status });
  return { oldPostId: postId, newPostId: newPost.id, status };
}

function readPostsPerAngle(configJson: string | undefined): number | null {
  if (!configJson) return null;
  try {
    const parsed = JSON.parse(configJson) as { postsPerAngle?: number };
    return typeof parsed.postsPerAngle === "number" ? parsed.postsPerAngle : null;
  } catch {
    return null;
  }
}
