import { describe, expect, it } from "vitest";
import { assemblePrompt, type PostRequest } from "../src/prompt/assemble.js";

function longQuestionsRequest(overrides: Partial<PostRequest> = {}): PostRequest {
  return {
    topic: "Blue-green deployments on GKE",
    angle: "shipping on a Friday without the fear",
    lesson: "a bad release is a 30-second traffic switch, not a redeploy",
    otherLessons: [],
    format: "long",
    hookStyle: "questions",
    variantNumber: 2,
    variantCount: 3,
    summaryMaxChars: 180,
    ...overrides,
  };
}

describe("assemblePrompt — system prompt", () => {
  it("replaces every golden placeholder with real example text", () => {
    const { system } = assemblePrompt(longQuestionsRequest());

    expect(system).not.toContain("{{GOLDEN_LONG_QUESTIONS}}");
    expect(system).not.toContain("{{GOLDEN_LONG_CALLOUT}}");
    expect(system).not.toContain("{{GOLDEN_SHORT}}");

    expect(system).toContain("Oya, walk with me"); // from the observability golden
    expect(system).toContain("𝗖𝗧𝗢𝘀 𝗮𝗻𝗱 𝗦𝗶𝘁𝗲 𝗥𝗲𝗹𝗶𝗮𝗯𝗶𝗹𝗶𝘁𝘆 𝗘𝗻𝗴𝗶𝗻𝗲𝗲𝗿𝘀"); // from the SLO golden
    expect(system).toContain("Limit Ranges in namespaces"); // from the short golden
  });
});

describe("assemblePrompt — task prompt", () => {
  it("fills every placeholder", () => {
    const { user } = assemblePrompt(longQuestionsRequest());

    expect(user).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(user).toContain("Blue-green deployments on GKE");
    expect(user).toContain("shipping on a Friday without the fear");
    expect(user).toContain("a bad release is a 30-second traffic switch");
    expect(user).toContain("FORMAT:            long");
    expect(user).toContain("HOOK_STYLE:        questions");
    expect(user).toContain("VARIANT:           2 of 3");
    expect(user).toContain("SUMMARY_MAX_CHARS: 180");
  });

  it("forces hook style to n/a for the short format", () => {
    const { user } = assemblePrompt(longQuestionsRequest({ format: "short", hookStyle: null }));
    expect(user).toContain("HOOK_STYLE:        n/a");
  });

  it("shows the empty labels when no context is supplied", () => {
    const { user } = assemblePrompt(longQuestionsRequest());
    expect(user).toContain("(none — advisory mode)"); // source facts
    expect(user).toMatch(/OTHER LESSONS FOR THIS ANGLE[\s\S]*\(none\)/);
  });

  it("lists the other lessons as a bullet list", () => {
    const { user } = assemblePrompt(
      longQuestionsRequest({
        otherLessons: ["you can test DB migrations on green first", "rollback needs no scripts"],
      }),
    );
    expect(user).toContain("- you can test DB migrations on green first");
    expect(user).toContain("- rollback needs no scripts");
  });
});
