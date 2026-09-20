import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { loadEnv } from "../config/load.js";
import { getDesignTemplate } from "../store/design-templates.js";
import { getGoldenPost } from "../store/golden-posts.js";
import { migrate } from "../store/migrate.js";
import {
  getPost,
  imageKeyInUseElsewhere,
  postsNeedingCards,
  setPostImage,
  setPostImageError,
} from "../store/posts.js";
import type { PostRow } from "../store/types.js";
import { BadRequestError, ConflictError, NotFoundError } from "../util/errors.js";
import { logger } from "../util/logger.js";
import type { ImageStore, StoredImage } from "./image-store.js";
import { cardContentType, renderCard } from "./imejis.js";

/** How a card gets rendered. Real one calls Imejis; tests inject a fake. */
export interface CardRenderer {
  render(summary: string, imejisDesignId: string): Promise<Buffer>;
  contentType(): string;
}

export const imejisRenderer: CardRenderer = {
  render: renderCard,
  contentType: cardContentType,
};

export interface CardBatchResult {
  attempted: number;
  rendered: number;
  reused: number;
  failed: number;
}

/**
 * Render a card for each approved post in the run that still needs one, up to
 * `limit`. The stored image is keyed by the hash of its summary, so an identical
 * summary is never rendered twice — re-running only renders what changed.
 * Each post is committed right after its upload, so the batch is resumable.
 */
export async function generateCardsForRun(input: {
  runId: string;
  limit: number;
  renderer: CardRenderer;
  store: ImageStore;
}): Promise<CardBatchResult> {
  await migrate();
  const renderDelayMs = loadEnv().CARD_RENDER_DELAY_MS;

  const posts = await postsNeedingCards(input.runId, input.limit);
  const result: CardBatchResult = { attempted: 0, rendered: 0, reused: 0, failed: 0 };

  for (const post of posts) {
    result.attempted++;
    const outcome = await placeCard(post, input.renderer, input.store);

    if (outcome.status === "rendered") {
      result.rendered++;
      if (renderDelayMs > 0) await sleep(renderDelayMs);
    } else if (outcome.status === "reused") {
      result.reused++;
    } else {
      result.failed++;
    }
  }

  logger.info("card batch done", { runId: input.runId, ...result });
  return result;
}

/**
 * Render (or reuse) one specific post's card. Idempotent, same as the batch —
 * an unchanged summary hits the same content-addressed key and costs no
 * render, deliberately, since Imejis' free tier is only 100 renders/month.
 */
export async function generateOneCard(input: {
  postId: string;
  renderer: CardRenderer;
  store: ImageStore;
}): Promise<{ url: string }> {
  await migrate();

  const post = await getPost(input.postId);
  if (!post) throw new NotFoundError(`no post with id ${input.postId}`);
  if (post.status === "regenerated") {
    throw new ConflictError(`post ${input.postId} was superseded — it can't have a card generated`);
  }
  if (!post.summary) throw new BadRequestError(`post ${input.postId} has no summary to put on a card`);

  const outcome = await placeCard(post, input.renderer, input.store);
  if (outcome.status === "failed") {
    throw new Error(outcome.error);
  }
  return { url: outcome.url };
}

type PlaceOutcome =
  | { status: "rendered" | "reused"; url: string }
  | { status: "failed"; error: string };

/**
 * Render-or-reuse `post`'s card, then point the post at it. If the post
 * already pointed at a *different* card (its summary changed since — the
 * batch path never hits this, since it only ever looks at posts with no card
 * yet), the old object is deleted, unless another post's card happens to
 * share the exact same content-addressed key — possible because the key is
 * derived from the summary text, not the post id.
 */
async function placeCard(post: PostRow, renderer: CardRenderer, store: ImageStore): Promise<PlaceOutcome> {
  try {
    const imejisDesignId = await resolvePostDesignId(post);
    const key = cardKey(post.summary!, renderer.contentType(), imejisDesignId);
    const previousKey = post.image_key;

    const alreadyStored = await store.find(key);
    const stored = alreadyStored ?? (await renderAndStore(post.summary!, imejisDesignId, key, renderer, store));
    await setPostImage(post.id, stored);

    if (previousKey && previousKey !== key) {
      await deleteCardIfOrphaned(previousKey, post.id, store);
    }

    const status = alreadyStored ? "reused" : "rendered";
    logger.info(`card ${status}`, { postId: post.id, url: stored.url });
    return { status, url: stored.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setPostImageError(post.id, message);
    logger.error("card failed", { postId: post.id, error: message });
    return { status: "failed", error: message };
  }
}

/**
 * Delete an image a post no longer points at — unless some other post's card
 * still lives at that exact key (possible since the key is content-addressed,
 * not tied to a post id). A delete failure is logged, not thrown: whatever
 * the post's current card is already rendered fine, and a leftover object is
 * a bucket-hygiene issue, not a reason to report the whole operation as
 * failed. Exported so `pipeline/edit.ts` can reuse it — an edited summary
 * orphans a card the same way a re-rendered one does.
 */
export async function deleteCardIfOrphaned(key: string, postId: string, store: ImageStore): Promise<void> {
  try {
    if (await imageKeyInUseElsewhere(key, postId)) {
      return;
    }
    await store.delete(key);
  } catch (error) {
    logger.warn("could not delete the previous card", {
      postId,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function renderAndStore(
  summary: string,
  imejisDesignId: string,
  key: string,
  renderer: CardRenderer,
  store: ImageStore,
): Promise<StoredImage> {
  const bytes = await renderer.render(summary, imejisDesignId);
  return store.put(key, bytes, renderer.contentType());
}

/**
 * The card design a post's card is rendered with — inherited from the golden
 * post its format/hook slot was generated against. Throws BadRequestError at
 * whichever link is missing, so `placeCard`'s catch turns it into a clear,
 * per-post `setPostImageError` instead of failing the whole batch.
 */
async function resolvePostDesignId(post: PostRow): Promise<string> {
  if (!post.golden_post_id) {
    throw new BadRequestError(
      `post ${post.id} has no golden post reference — it predates golden-post design assignment, or its golden post was deleted`,
    );
  }
  const golden = await getGoldenPost(post.golden_post_id);
  if (!golden) {
    throw new BadRequestError(`post ${post.id}'s golden post no longer exists`);
  }
  if (!golden.design_template_id) {
    throw new BadRequestError(`golden post ${golden.id} has no design template assigned`);
  }
  const template = await getDesignTemplate(golden.design_template_id);
  if (!template) {
    throw new BadRequestError(`golden post ${golden.id}'s design template no longer exists`);
  }
  return template.imejis_design_id;
}

/** Content-addressed: same design + format + summary → same key → one render, ever. */
function cardKey(summary: string, contentType: string, imejisDesignId: string): string {
  const env = loadEnv();
  const digest = createHash("sha256")
    .update(`${imejisDesignId}:${contentType}:${summary}`)
    .digest("hex");
  return `cards/${digest}.${env.CARD_IMAGE_FORMAT}`;
}
