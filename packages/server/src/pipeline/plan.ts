import type { GoldenPostRow, HookStyle, PostFormat } from "../store/types.js";

export interface PostSlot {
  format: PostFormat;
  hookStyle: HookStyle;
  goldenPostId: string;
}

/**
 * Decide the format, hook, and voice-reference golden post of every post in
 * a run up front, then shuffle, so the mix is spread evenly instead of
 * clumping. The split is even across whatever golden posts exist — each of
 * the N goldens (max 5, enforced in store/golden-posts.ts) gets 1/N of the
 * posts, using that golden's own format/hook_style. Any remainder (when
 * totalPosts doesn't divide evenly) goes one-per-golden to the first few
 * goldens, so e.g. 100 posts across 3 goldens is 34/33/33, not 33/33/34.
 */
export function planPostSlots(totalPosts: number, goldenPosts: GoldenPostRow[]): PostSlot[] {
  if (goldenPosts.length === 0) {
    throw new Error("at least one golden post is required to generate — add one first");
  }

  const base = Math.floor(totalPosts / goldenPosts.length);
  const remainder = totalPosts % goldenPosts.length;

  const slots: PostSlot[] = [];
  goldenPosts.forEach((golden, index) => {
    const count = base + (index < remainder ? 1 : 0);
    for (let i = 0; i < count; i++) {
      slots.push({ format: golden.format, hookStyle: golden.hook_style, goldenPostId: golden.id });
    }
  });
  return shuffleInPlace(slots);
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let currentIndex = items.length - 1; currentIndex > 0; currentIndex--) {
    const swapIndex = Math.floor(Math.random() * (currentIndex + 1));
    [items[currentIndex], items[swapIndex]] = [items[swapIndex]!, items[currentIndex]!];
  }
  return items;
}
