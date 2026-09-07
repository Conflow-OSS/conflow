import { loadEnv } from "../config/load.js";
import { migrate } from "../store/migrate.js";
import { getPost, postsNeedingCards, setPostImage, setPostImageError } from "../store/posts.js";
import { logger } from "../util/logger.js";
import { cardContentType, renderCard } from "./imejis.js";
import type { ImageStore } from "./image-store.js";

/** How a card gets rendered. Real one calls Imejis; tests inject a fake. */
export interface CardRenderer {
  render(summary: string): Promise<Buffer>;
  contentType(): string;
}

export const imejisRenderer: CardRenderer = {
  render: renderCard,
  contentType: cardContentType,
};

export interface CardBatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Render a card for each approved post in the run that still needs one, up to
 * `limit`. Each post is committed right after its upload, so the batch is
 * resumable — a re-run picks up where it stopped.
 */
export async function generateCardsForRun(input: {
  runId: string;
  limit: number;
  renderer: CardRenderer;
  store: ImageStore;
}): Promise<CardBatchResult> {
  migrate();

  const posts = postsNeedingCards(input.runId, input.limit);
  const result: CardBatchResult = { attempted: 0, succeeded: 0, failed: 0 };

  for (const post of posts) {
    result.attempted++;
    const outcome = await renderAndStore(post.id, post.summary!, input.renderer, input.store);
    if (outcome.ok) result.succeeded++;
    else result.failed++;
  }

  logger.info("card batch done", { runId: input.runId, ...result });
  return result;
}

/** (Re)render one specific post's card — for after you tweak a summary. */
export async function generateOneCard(input: {
  postId: string;
  renderer: CardRenderer;
  store: ImageStore;
}): Promise<{ url: string }> {
  migrate();

  const post = getPost(input.postId);
  if (!post) {
    throw new Error(`no post with id ${input.postId}`);
  }
  if (!post.summary) {
    throw new Error(`post ${input.postId} has no summary to put on a card`);
  }

  const outcome = await renderAndStore(post.id, post.summary, input.renderer, input.store);
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
  return { url: outcome.url };
}

async function renderAndStore(
  postId: string,
  summary: string,
  renderer: CardRenderer,
  store: ImageStore,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const bytes = await renderer.render(summary);
    const stored = await store.put(cardKey(postId), bytes, renderer.contentType());
    setPostImage(postId, stored);
    logger.info("card stored", { postId, url: stored.url });
    return { ok: true, url: stored.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setPostImageError(postId, message);
    logger.error("card failed", { postId, error: message });
    return { ok: false, error: message };
  }
}

function cardKey(postId: string): string {
  return `cards/${postId}.${loadEnv().CARD_IMAGE_FORMAT}`;
}
