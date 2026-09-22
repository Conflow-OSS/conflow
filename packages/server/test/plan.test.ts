import { describe, expect, it } from "vitest";
import { planPostSlots } from "../src/pipeline/plan.js";
import type { GoldenPostRow } from "../src/store/types.js";

function golden(overrides: Partial<GoldenPostRow> = {}): GoldenPostRow {
  return {
    id: "g1",
    title: "A post",
    body: "a post",
    format: "long",
    hook_style: "questions",
    design_template_id: null,
    ideal_length_min: 900,
    ideal_length_max: 1100,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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
    const goldens = [golden({ id: "g1" }), golden({ id: "g2" })];
    expect(planPostSlots(120, goldens)).toHaveLength(120);
  });

  it("splits evenly across two golden posts", () => {
    const goldens = [
      golden({ id: "g1", format: "short", hook_style: null }),
      golden({ id: "g2", format: "long", hook_style: "callout" }),
    ];
    const slots = planPostSlots(100, goldens);
    const byGolden = countBy(slots, (slot) => slot.goldenPostId);
    expect(byGolden.g1).toBe(50);
    expect(byGolden.g2).toBe(50);
  });

  it("splits a remainder one-per-golden to the first goldens", () => {
    const goldens = [golden({ id: "g1" }), golden({ id: "g2" }), golden({ id: "g3" })];
    const slots = planPostSlots(100, goldens);
    const byGolden = countBy(slots, (slot) => slot.goldenPostId);
    expect(byGolden.g1).toBe(34);
    expect(byGolden.g2).toBe(33);
    expect(byGolden.g3).toBe(33);
  });

  it("splits 100 posts evenly across five goldens", () => {
    const goldens = [1, 2, 3, 4, 5].map((n) => golden({ id: `g${n}` }));
    const slots = planPostSlots(100, goldens);
    const byGolden = countBy(slots, (slot) => slot.goldenPostId);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(byGolden[`g${n}`]).toBe(20);
    }
  });

  it("carries each slot's format and hook_style from its golden post", () => {
    const goldens = [
      golden({ id: "g1", format: "short", hook_style: null }),
      golden({ id: "g2", format: "long", hook_style: "callout" }),
    ];
    const slots = planPostSlots(20, goldens);
    for (const slot of slots) {
      if (slot.goldenPostId === "g1") {
        expect(slot.format).toBe("short");
        expect(slot.hookStyle).toBeNull();
      } else {
        expect(slot.format).toBe("long");
        expect(slot.hookStyle).toBe("callout");
      }
    }
  });

  it("throws when there are no golden posts", () => {
    expect(() => planPostSlots(10, [])).toThrow(/at least one golden post/);
  });
});
