import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { loadEnv } from "../config/load.js";
import { migrate } from "../store/migrate.js";
import { getPost, postsNeedingCards, setPostImage, setPostImageError } from "../store/posts.js";
import { logger } from "../util/logger.js";
import type { ImageStore, StoredImage } from "./image-store.js";
import { cardContentType, renderCard } from "./imejis.js";

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
    const outcome = await placeCard(post.id, post.summary!, input.renderer, input.store);

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

/** (Re)render one specific post's card — always a fresh render, no cache. */
export async function generateOneCard(input: {
  postId: string;
  renderer: CardRenderer;
  store: ImageStore;
}): Promise<{ url: string }> {
  await migrate();

  const post = await getPost(input.postId);
  if (!post) throw new Error(`no post with id ${input.postId}`);
  if (!post.summary) throw new Error(`post ${input.postId} has no summary to put on a card`);

  const stored = await renderAndStore(post.summary, input.renderer, input.store);
  await setPostImage(input.postId, stored);
  logger.info("card re-rendered", { postId: input.postId, url: stored.url });
  return { url: stored.url };
}

type PlaceOutcome =
  | { status: "rendered" | "reused"; url: string }
  | { status: "failed"; error: string };

async function placeCard(
  postId: string,
  summary: string,
  renderer: CardRenderer,
  store: ImageStore,
): Promise<PlaceOutcome> {
  const key = cardKey(summary, renderer.contentType());
  try {
    const alreadyStored = await store.find(key);
    if (alreadyStored) {
      await setPostImage(postId, alreadyStored);
      logger.info("card reused", { postId, url: alreadyStored.url });
      return { status: "reused", url: alreadyStored.url };
    }

    const bytes = await renderer.render(summary);
    const stored = await store.put(key, bytes, renderer.contentType());
    await setPostImage(postId, stored);
    logger.info("card rendered", { postId, url: stored.url });
    return { status: "rendered", url: stored.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setPostImageError(postId, message);
    logger.error("card failed", { postId, error: message });
    return { status: "failed", error: message };
  }
}

async function renderAndStore(
  summary: string,
  renderer: CardRenderer,
  store: ImageStore,
): Promise<StoredImage> {
  const bytes = await renderer.render(summary);
  return store.put(cardKey(summary, renderer.contentType()), bytes, renderer.contentType());
}

/** Content-addressed: same design + format + summary → same key → one render, ever. */
function cardKey(summary: string, contentType: string): string {
  const env = loadEnv();
  const digest = createHash("sha256")
    .update(`${env.IMEJIS_DESIGN_ID}:${contentType}:${summary}`)
    .digest("hex");
  return `cards/${digest}.${env.CARD_IMAGE_FORMAT}`;
}
