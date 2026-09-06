import { describe, expect, it } from "vitest";
import type { ContentModel } from "../src/models/types.js";
import { generateOneVariant, type VariantRequest } from "../src/pipeline/generate.js";

process.env.LENGTH_TOLERANCE = "0.15";

function modelReturningBody(body: string): ContentModel {
  return {
    channel: "zai",
    model: "fake",
    async generate() {
      return {
        text: `<post><body>${body}</body></post>`,
        channel: "zai",
        model: "fake",
      };
    },
  };
}

function longVariantRequest(): VariantRequest {
  return {
    topic: "Pod autoscaling",
    angle: "scaling on queue depth",
    format: "long",
    hookStyle: "questions",
    variantNumber: 1,
    variantCount: 2,
    previousVariantBodies: [],
  };
}

describe("generateOneVariant", () => {
  it("marks a correctly sized post ok", async () => {
    const body = "word ".repeat(240).trim(); // ~1200 chars, inside the long band
    const variant = await generateOneVariant(longVariantRequest(), modelReturningBody(body));
    expect(variant.status).toBe("ok");
    expect(variant.flagReason).toBeNull();
    expect(variant.parsed.body).toBe(body);
  });

  it("flags a post that is far too short for its format", async () => {
    const body = "way too short";
    const variant = await generateOneVariant(longVariantRequest(), modelReturningBody(body));
    expect(variant.status).toBe("flag_length");
    expect(variant.flagReason).toMatch(/below the \d+ minimum/);
  });

  it("passes source facts through to the prompt", async () => {
    let capturedUserPrompt = "";
    const capturingModel: ContentModel = {
      channel: "zai",
      model: "fake",
      async generate({ user }) {
        capturedUserPrompt = user;
        return {
          text: `<post><body>${"word ".repeat(240).trim()}</body></post>`,
          channel: "zai",
          model: "fake",
        };
      },
    };

    await generateOneVariant(
      { ...longVariantRequest(), sourceFacts: "I ran the migration with zero downtime using pg_logical." },
      capturingModel,
    );

    expect(capturedUserPrompt).toContain("I ran the migration with zero downtime using pg_logical.");
  });
});
