import { getImageStore } from "../cards/factory.js";
import type { ImageStore } from "../cards/image-store.js";
import { deleteCardIfOrphaned } from "../cards/run.js";
import { loadEnv } from "../config/load.js";
import { embedDocuments } from "../embeddings/voyage.js";
import { migrate } from "../store/migrate.js";
import { editPostContent, getPost, standingVariantsOfTopic } from "../store/posts.js";
import type { PostRow, PostStatus } from "../store/types.js";
import { nearestLedgerMatch, upsertEmbedding } from "../store/vec.js";
import { BadRequestError, ConflictError, NotFoundError } from "../util/errors.js";
import { logger } from "../util/logger.js";
import { findDuplicate, loadEmbeddingsForPosts } from "./dedup.js";
import { checkLengths } from "./generate.js";

export interface EditPostInput {
  body?: string;
  summary?: string;
}

/**
 * Overwrite a generated post's body/summary in place. Recomputes the embedding
 * and re-runs dedup + the length check when the body changes, and always
 * resets approval back to pending — an edit invalidates whatever review the
 * old text already got. Seed posts, superseded posts, and published posts
 * can't be edited through here.
 */
export async function editPost(
  postId: string,
  input: EditPostInput,
  imageStore: ImageStore = getImageStore(),
): Promise<PostRow> {
  await migrate();
  const env = loadEnv();

  const post = await getPost(postId);
  if (!post) {
    throw new NotFoundError(`no post with id ${postId}`);
  }
  if (post.kind !== "generated" || !post.topic_id) {
    throw new BadRequestError(`post ${postId} is not an editable generated post`);
  }
  if (post.status === "regenerated") {
    throw new ConflictError(`post ${postId} was already replaced — edit its replacement instead`);
  }
  if (post.published_at) {
    throw new ConflictError(`post ${postId} is already published and can't be edited`);
  }

  const newBody = input.body ?? post.body;
  const newSummary = input.summary === undefined ? post.summary : input.summary;
  const bodyChanged = newBody !== post.body;
  const summaryChanged = newSummary !== post.summary;

  if (!bodyChanged && !summaryChanged) {
    return post;
  }

  let status: PostStatus = post.status;
  let flagReason = post.flag_reason;
  let dupOfId: string | null = null;
  let dupScore: number | null = null;
  let embedding: number[] | null = null;

  if (bodyChanged) {
    const lengthCheck = checkLengths({ body: newBody, summary: newSummary }, post.format, env.SUMMARY_MAX_CHARS);
    status = lengthCheck.status;
    flagReason = lengthCheck.reason;

    [embedding] = await embedDocuments([newBody]);

    if (status === "ok") {
      const siblings = await standingVariantsOfTopic(post.topic_id, postId);
      const siblingEmbeddings = await loadEmbeddingsForPosts(siblings.map((sibling) => sibling.id));
      const ledgerMatch = await nearestLedgerMatch(embedding, {
        excludeTopicId: post.topic_id,
        windowDays: env.DEDUP_LEDGER_WINDOW_DAYS,
      });
      const match = findDuplicate({
        postEmbedding: embedding,
        siblingEmbeddings,
        siblingThreshold: env.DEDUP_SIBLING_THRESHOLD,
        ledgerMatch,
        ledgerThreshold: env.DEDUP_LEDGER_THRESHOLD,
      });
      if (match) {
        status = "flag_dup";
        flagReason = match.reason;
        dupOfId = match.duplicateOfPostId;
        dupScore = match.similarity;
      }
    }
  }

  await editPostContent(postId, {
    body: newBody,
    summary: newSummary,
    status,
    flag_reason: flagReason,
    dup_of_id: dupOfId,
    dup_score: dupScore,
    image_url: summaryChanged ? null : post.image_url,
    image_key: summaryChanged ? null : post.image_key,
    image_generated_at: summaryChanged ? null : post.image_generated_at,
    image_error: summaryChanged ? null : post.image_error,
  });

  if (bodyChanged && embedding) {
    await upsertEmbedding(postId, embedding);
  }

  if (summaryChanged && post.image_key) {
    await deleteCardIfOrphaned(post.image_key, postId, imageStore);
  }

  logger.info("post edited", { postId, bodyChanged, summaryChanged, status });
  return (await getPost(postId)) as PostRow;
}
