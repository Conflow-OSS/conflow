import type { HookStyle, PostFormat } from "../store/types.js";

export interface PostSlot {
  format: PostFormat;
  hookStyle: HookStyle;
}

/**
 * Decide the format and hook of every post in a run up front, then shuffle, so
 * the short/long mix is spread evenly instead of clumping.
 */
export function planPostSlots(
  totalPosts: number,
  shortFormRatio: number,
  questionsHookRatio: number,
): PostSlot[] {
  const shortCount = Math.round(totalPosts * shortFormRatio);
  const longCount = totalPosts - shortCount;
  const questionsHookCount = Math.round(longCount * questionsHookRatio);

  const slots: PostSlot[] = [];
  for (let i = 0; i < shortCount; i++) {
    slots.push({ format: "short", hookStyle: null });
  }
  for (let i = 0; i < longCount; i++) {
    slots.push({ format: "long", hookStyle: i < questionsHookCount ? "questions" : "callout" });
  }
  return shuffleInPlace(slots);
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let currentIndex = items.length - 1; currentIndex > 0; currentIndex--) {
    const swapIndex = Math.floor(Math.random() * (currentIndex + 1));
    [items[currentIndex], items[swapIndex]] = [items[swapIndex]!, items[currentIndex]!];
  }
  return items;
}
