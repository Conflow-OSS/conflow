import { describe, expect, it } from "vitest";
import type { ContentModel } from "../src/models/types.js";
import { generateOneVariant, type VariantRequest } from "../src/pipeline/generate.js";

process.env.LENGTH_TOLERANCE = "0.15";
process.env.SUMMARY_MAX_CHARS = "180";

const IN_BAND_LONG_BODY = "word ".repeat(200).trim(); // 999 chars, inside 900–1100

function modelReturning(postXml: string): ContentModel {
  return {
    channel: "zai",
    model: "fake",
    async generate() {
      return { text: postXml, channel: "zai", model: "fake" };
    },
  };
}

function post(body: string, summary?: string): string {
  const summaryTag = summary === undefined ? "" : `<summary>${summary}</summary>`;
  return `<post><body>${body}</body>${summaryTag}</post>`;
}

function longVariantRequest(): VariantRequest {
  return {
    topic: "Pod autoscaling",
    angle: "scaling on queue depth",
    lesson: "you react to backlog, not CPU noise",
    otherLessons: ["you scale down cleanly in quiet periods"],
    format: "long",
    hookStyle: "questions",
    variantNumber: 1,
    variantCount: 2,
  };
}

describe("generateOneVariant", () => {
  it("marks a correctly sized post ok", async () => {
    const variant = await generateOneVariant(
      longVariantRequest(),
      modelReturning(post(IN_BAND_LONG_BODY, "You should scale on queue depth, not CPU.")),
    );
    expect(variant.status).toBe("ok");
    expect(variant.flagReason).toBeNull();
    expect(variant.parsed.summary).toBe("You should scale on queue depth, not CPU.");
  });

  it("flags a post that is far too short for its format", async () => {
    const variant = await generateOneVariant(
      longVariantRequest(),
      modelReturning(post("way too short")),
    );
    expect(variant.status).toBe("flag_length");
    expect(variant.flagReason).toMatch(/body .* below the \d+ minimum/);
  });

  it("flags a post whose summary will not fit the card", async () => {
    const longSummary = "This summary is deliberately far too long to fit on any reasonable image card ".repeat(4);
    const variant = await generateOneVariant(
      longVariantRequest(),
      modelReturning(post(IN_BAND_LONG_BODY, longSummary)),
    );
    expect(variant.status).toBe("flag_length");
    expect(variant.flagReason).toMatch(/summary \d+ chars — above the \d+ card limit/);
  });

  it("passes the lesson and source facts through to the prompt", async () => {
    let capturedUserPrompt = "";
    const capturingModel: ContentModel = {
      channel: "zai",
      model: "fake",
      async generate({ user }) {
        capturedUserPrompt = user;
        return { text: post(IN_BAND_LONG_BODY), channel: "zai", model: "fake" };
      },
    };

    await generateOneVariant(
      {
        ...longVariantRequest(),
        sourceFacts: "I ran the migration with zero downtime using pg_logical.",
      },
      capturingModel,
    );

    expect(capturedUserPrompt).toContain("you react to backlog, not CPU noise");
    expect(capturedUserPrompt).toContain("I ran the migration with zero downtime using pg_logical.");
  });
});
