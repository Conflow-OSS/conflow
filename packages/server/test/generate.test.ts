import { describe, expect, it } from "vitest";
import type { ContentModel } from "../src/models/types.js";
import type { PostRequest } from "../src/prompt/assemble.js";
import { generatePost } from "../src/pipeline/generate.js";
import type { GoldenPostRow } from "../src/store/types.js";

const FIXTURE_GOLDENS: GoldenPostRow[] = [
  {
    id: "g1",
    body: "a reference post",
    format: "long",
    hook_style: "questions",
    design_template_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

process.env.LENGTH_TOLERANCE = "0.15";
process.env.SUMMARY_MAX_CHARS = "180";
process.env.LLM_TEMPERATURE = "0.8";
process.env.REGENERATE_TEMPERATURE = "0.9";

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

function generateRequest(): PostRequest {
  return {
    mode: "generate",
    topic: "Pod autoscaling",
    angle: "scaling on queue depth",
    lesson: "you react to backlog, not CPU noise",
    otherLessons: ["you scale down cleanly in quiet periods"],
    format: "long",
    hookStyle: "questions",
    variantNumber: 1,
    variantCount: 2,
    summaryMaxChars: 180,
  };
}

describe("generatePost", () => {
  it("marks a correctly sized post ok", async () => {
    const result = await generatePost(
      generateRequest(),
      modelReturning(post(IN_BAND_LONG_BODY, "Scale on queue depth, not CPU.")),
      FIXTURE_GOLDENS,
    );
    expect(result.status).toBe("ok");
    expect(result.flagReason).toBeNull();
    expect(result.parsed.summary).toBe("Scale on queue depth, not CPU.");
  });

  it("flags a post that is far too short for its format", async () => {
    const result = await generatePost(generateRequest(), modelReturning(post("way too short")), FIXTURE_GOLDENS);
    expect(result.status).toBe("flag_length");
    expect(result.flagReason).toMatch(/body .* below the \d+ minimum/);
  });

  it("flags a post whose summary will not fit the card", async () => {
    const longSummary = "This summary is deliberately far too long to fit on any image card ".repeat(4);
    const result = await generatePost(
      generateRequest(),
      modelReturning(post(IN_BAND_LONG_BODY, longSummary)),
      FIXTURE_GOLDENS,
    );
    expect(result.status).toBe("flag_length");
    expect(result.flagReason).toMatch(/summary \d+ chars — above the \d+ card limit/);
  });

  it("puts the lesson and source facts into the prompt", async () => {
    let capturedUserPrompt = "";
    const capturingModel: ContentModel = {
      channel: "zai",
      model: "fake",
      async generate({ user }) {
        capturedUserPrompt = user;
        return { text: post(IN_BAND_LONG_BODY), channel: "zai", model: "fake" };
      },
    };

    await generatePost(
      { ...generateRequest(), sourceFacts: "I ran the migration with zero downtime using pg_logical." },
      capturingModel,
      FIXTURE_GOLDENS,
    );

    expect(capturedUserPrompt).toContain("you react to backlog, not CPU noise");
    expect(capturedUserPrompt).toContain("I ran the migration with zero downtime using pg_logical.");
  });

  it("raises the temperature and shows the collision when regenerating", async () => {
    let capturedTemperature: number | undefined;
    let capturedUserPrompt = "";
    const capturingModel: ContentModel = {
      channel: "zai",
      model: "fake",
      async generate({ user, temperature }) {
        capturedTemperature = temperature;
        capturedUserPrompt = user;
        return { text: post(IN_BAND_LONG_BODY), channel: "zai", model: "fake" };
      },
    };

    await generatePost(
      {
        ...generateRequest(),
        mode: "regenerate",
        flagReason: "too close to an existing post (similarity 0.94)",
        collidedWith: { body: "the earlier post that this one echoed", similarity: 0.94 },
      },
      capturingModel,
      FIXTURE_GOLDENS,
    );

    expect(capturedTemperature).toBe(0.9);
    expect(capturedUserPrompt).toContain("This is a REVISION");
    expect(capturedUserPrompt).toContain("too close to an existing post (similarity 0.94)");
    expect(capturedUserPrompt).toContain("the earlier post that this one echoed");
  });
});
