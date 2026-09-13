import { describe, expect, it } from "vitest";
import { planPostSlots } from "../src/pipeline/plan.js";

function countBy<T>(items: T[], pick: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe("planPostSlots", () => {
  it("produces exactly totalPosts slots", () => {
    expect(planPostSlots(120, 0.35, 0.5)).toHaveLength(120);
  });

  it("splits short vs long by the ratio", () => {
    const slots = planPostSlots(100, 0.35, 0.5);
    const byFormat = countBy(slots, (slot) => slot.format);
    expect(byFormat.short).toBe(35);
    expect(byFormat.long).toBe(65);
  });

  it("splits the long posts between the two hook styles", () => {
    const slots = planPostSlots(100, 0.4, 0.5);
    const longSlots = slots.filter((slot) => slot.format === "long");
    const byHook = countBy(longSlots, (slot) => slot.hookStyle ?? "none");
    expect(byHook.questions).toBe(30);
    expect(byHook.callout).toBe(30);
  });

  it("gives short posts no hook style", () => {
    const slots = planPostSlots(20, 1, 0.5);
    expect(slots.every((slot) => slot.format === "short" && slot.hookStyle === null)).toBe(true);
  });
});
