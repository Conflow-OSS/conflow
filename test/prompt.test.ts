import { describe, expect, it } from "vitest";
import { assemblePrompt, type PostRequest } from "../src/prompt/assemble.js";

type GenerateRequest = Extract<PostRequest, { mode: "generate" }>;
type RegenerateRequest = Extract<PostRequest, { mode: "regenerate" }>;

function generateRequest(overrides: Partial<Omit<GenerateRequest, "mode">> = {}): GenerateRequest {
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
    mode: "generate",
  };
}

function regenerateRequest(overrides: Partial<Omit<RegenerateRequest, "mode">> = {}): RegenerateRequest {
  const { mode: _ignored, ...common } = generateRequest();
  return {
    ...common,
    flagReason: "too close to an existing post (similarity 0.91)",
    ...overrides,
    mode: "regenerate",
  };
}

describe("assemblePrompt — system prompt", () => {
  it("replaces every golden placeholder with real example text", () => {
    const { system } = assemblePrompt(generateRequest());

    expect(system).not.toMatch(/\{\{GOLDEN_[A-Z_]+\}\}/);
    expect(system).toContain("Oya, walk with me"); // observability golden
    expect(system).toContain("𝗖𝗧𝗢𝘀 𝗮𝗻𝗱 𝗦𝗶𝘁𝗲 𝗥𝗲𝗹𝗶𝗮𝗯𝗶𝗹𝗶𝘁𝘆 𝗘𝗻𝗴𝗶𝗻𝗲𝗲𝗿𝘀"); // SLO golden
    expect(system).toContain("Limit Ranges in namespaces"); // short golden
  });
});

describe("assemblePrompt — generate task", () => {
  it("fills the context and generate blocks with no leftover placeholders", () => {
    const { user } = assemblePrompt(generateRequest());

    expect(user).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(user).toContain("Blue-green deployments on GKE");
    expect(user).toContain("a bad release is a 30-second traffic switch");
    expect(user).toContain("FORMAT:            long");
    expect(user).toContain("HOOK_STYLE:        questions");
    expect(user).toContain("VARIANT:           2 of 3");
    expect(user).toContain("SUMMARY_MAX_CHARS: 180");
    expect(user).toContain("The whole post must be built around the LESSON");
    expect(user).not.toContain("This is a REVISION");
  });

  it("forces hook style to n/a for the short format", () => {
    const { user } = assemblePrompt(generateRequest({ format: "short", hookStyle: null }));
    expect(user).toContain("HOOK_STYLE:        n/a");
  });

  it("lists the other lessons as a bullet list", () => {
    const { user } = assemblePrompt(
      generateRequest({ otherLessons: ["test DB migrations on green first", "rollback needs no scripts"] }),
    );
    expect(user).toContain("- test DB migrations on green first");
    expect(user).toContain("- rollback needs no scripts");
  });
});

describe("assemblePrompt — regenerate task", () => {
  it("uses the revision block instead of the generate block", () => {
    const { user } = assemblePrompt(regenerateRequest());
    expect(user).toContain("This is a REVISION");
    expect(user).toContain("too close to an existing post (similarity 0.91)");
    expect(user).not.toContain("The whole post must be built around the LESSON, seen through the ANGLE. Make");
  });

  it("includes the collided-with post when there was one", () => {
    const { user } = assemblePrompt(
      regenerateRequest({
        collidedWith: { body: "an older post about the same idea", similarity: 0.91 },
      }),
    );
    expect(user).toContain("too close (similarity 0.91) to this existing");
    expect(user).toContain("an older post about the same idea");
  });

  it("omits the collision section when there was no duplicate", () => {
    const { user } = assemblePrompt(regenerateRequest({ collidedWith: undefined }));
    expect(user).not.toContain("the post you were too close to");
  });
});
