import { loadEnv } from "../config/load.js";
import { embedDocuments } from "../embeddings/voyage.js";
import type { ContentModel } from "../models/types.js";
import { listGoldenPosts } from "../store/golden-posts.js";
import { migrate } from "../store/migrate.js";
import { getPost, insertPost, setStatus, standingVariantsOfTopic } from "../store/posts.js";
import { getRun } from "../store/runs.js";
import { getTopic } from "../store/topics.js";
import type { PostRow, PostStatus } from "../store/types.js";
import { nearestLedgerMatch, upsertEmbedding } from "../store/vec.js";
import { logger } from "../util/logger.js";
import { findDuplicate, loadEmbeddingsForPosts } from "./dedup.js";
import { generatePost } from "./generate.js";
import { parseRunConfig } from "./run.js";

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
  await migrate();
  const env = loadEnv();

  const oldPost = await getPost(postId);
  if (!oldPost) {
    throw new Error(`no post with id ${postId}`);
  }
  if (oldPost.kind !== "generated" || !oldPost.topic_id || !oldPost.run_id) {
    throw new Error(`post ${postId} is not a regeneratable generated post`);
  }
  if (oldPost.status === "regenerated") {
    throw new Error(`post ${postId} has already been replaced`);
  }

  const topic = await getTopic(oldPost.topic_id);
  if (!topic) {
    throw new Error(`post ${postId} points at a missing topic`);
  }

  const run = await getRun(oldPost.run_id);
  const sourceFacts =
    run?.flow === "casestudy" ? (run.input_text ?? undefined) : undefined;

  const siblings = await standingVariantsOfTopic(oldPost.topic_id, postId);
  const lesson = oldPost.lesson_text ?? topic.angle_text;
  const otherLessons = siblings
    .map((sibling) => sibling.lesson_text)
    .filter((lessonText): lessonText is string => lessonText !== null);
  const goldenPosts = await listGoldenPosts();

  const variant = await generatePost(
    {
      mode: "regenerate",
      topic: topic.base_text,
      angle: topic.angle_text,
      lesson,
      otherLessons,
      format: oldPost.format,
      hookStyle: oldPost.hook_style,
      variantNumber: (oldPost.variant_index ?? 0) + 1,
      variantCount: run ? parseRunConfig(run.config_json).postsPerAngle : env.GEN_Z,
      summaryMaxChars: env.SUMMARY_MAX_CHARS,
      sourceFacts,
      flagReason: describeWhatToFix(oldPost),
      collidedWith: await loadCollisionPost(oldPost),
    },
    model,
    goldenPosts,
  );

  const [embedding] = await embedDocuments([variant.parsed.body]);

  let status = variant.status;
  let flagReason = variant.flagReason;
  let duplicateOfPostId: string | null = null;
  let duplicateScore: number | null = null;

  if (status === "ok") {
    const ledgerMatch = await nearestLedgerMatch(embedding!, {
      excludeTopicId: oldPost.topic_id,
      windowDays: env.DEDUP_LEDGER_WINDOW_DAYS,
    });
    const match = findDuplicate({
      postEmbedding: embedding!,
      siblingEmbeddings: await loadEmbeddingsForPosts(siblings.map((sibling) => sibling.id)),
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

  const newPost = await insertPost({
    kind: "generated",
    run_id: oldPost.run_id,
    topic_id: oldPost.topic_id,
    variant_index: oldPost.variant_index,
    format: oldPost.format,
    hook_style: oldPost.hook_style,
    golden_post_id: oldPost.golden_post_id,
    topic_angle: variant.parsed.topicAngle,
    lesson_text: lesson,
    body: variant.parsed.body,
    summary: variant.parsed.summary,
    status,
    flag_reason: flagReason,
    dup_of_id: duplicateOfPostId,
    dup_score: duplicateScore,
    model_channel: model.channel,
    model_id: model.model,
  });
  await upsertEmbedding(newPost.id, embedding!);
  await setStatus(postId, "regenerated", { superseded_by_id: newPost.id });

  logger.info("post regenerated", { oldPostId: postId, newPostId: newPost.id, status });
  return { oldPostId: postId, newPostId: newPost.id, status };
}

function describeWhatToFix(oldPost: PostRow): string {
  if (oldPost.flag_reason) {
    return oldPost.flag_reason;
  }
  return "you were asked for a fresh take on this lesson";
}

/** The post the old one was flagged as too close to, when it was a duplicate. */
async function loadCollisionPost(
  oldPost: PostRow,
): Promise<{ body: string; similarity: number } | undefined> {
  if (oldPost.status !== "flag_dup" || !oldPost.dup_of_id) {
    return undefined;
  }
  const collided = await getPost(oldPost.dup_of_id);
  if (!collided) {
    return undefined;
  }
  return { body: collided.body, similarity: oldPost.dup_score ?? 0 };
}
