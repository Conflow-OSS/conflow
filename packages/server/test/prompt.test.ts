import { describe, expect, it } from "vitest";
import { assemblePrompt, type PostRequest } from "../src/prompt/assemble.js";
import type { GoldenPostRow } from "../src/store/types.js";

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

function golden(overrides: Partial<GoldenPostRow> = {}): GoldenPostRow {
  return {
    id: "g1",
    body: "a post",
    format: "long",
    hook_style: "questions",
    design_template_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const FIXTURE_GOLDENS: GoldenPostRow[] = [
  golden({ id: "g1", format: "long", hook_style: "questions", body: "Oya, walk with me through a 3am page." }),
  golden({ id: "g2", format: "long", hook_style: "callout", body: "CTOs and SREs, you might want to see this." }),
  golden({ id: "g3", format: "short", hook_style: null, body: "Limit Ranges in namespaces get skipped a lot." }),
];

describe("assemblePrompt — system prompt", () => {
  it("replaces the golden placeholder with one <example> block per golden post", () => {
    const { system } = assemblePrompt(generateRequest(), FIXTURE_GOLDENS);

    expect(system).not.toContain("{{GOLDEN_EXAMPLES}}");
    expect(system).toContain("Oya, walk with me through a 3am page.");
    expect(system).toContain("CTOs and SREs, you might want to see this.");
    expect(system).toContain("Limit Ranges in namespaces get skipped a lot.");
    expect(system).toContain('<example format="long" hook="questions">');
    expect(system).toContain('<example format="long" hook="callout">');
    expect(system).toContain('<example format="short" hook="n/a">');
  });

  it("renders no examples when there are no golden posts", () => {
    const { system } = assemblePrompt(generateRequest(), []);
    expect(system).not.toContain("{{GOLDEN_EXAMPLES}}");
    expect(system).not.toContain("<example");
  });
});

describe("assemblePrompt — generate task", () => {
  it("fills the context and generate blocks with no leftover placeholders", () => {
    const { user } = assemblePrompt(generateRequest(), FIXTURE_GOLDENS);

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
    const { user } = assemblePrompt(generateRequest({ format: "short", hookStyle: null }), FIXTURE_GOLDENS);
    expect(user).toContain("HOOK_STYLE:        n/a");
  });

  it("lists the other lessons as a bullet list", () => {
    const { user } = assemblePrompt(
      generateRequest({ otherLessons: ["test DB migrations on green first", "rollback needs no scripts"] }),
      FIXTURE_GOLDENS,
    );
    expect(user).toContain("- test DB migrations on green first");
    expect(user).toContain("- rollback needs no scripts");
  });
});

describe("assemblePrompt — regenerate task", () => {
  it("uses the revision block instead of the generate block", () => {
    const { user } = assemblePrompt(regenerateRequest(), FIXTURE_GOLDENS);
    expect(user).toContain("This is a REVISION");
    expect(user).toContain("too close to an existing post (similarity 0.91)");
    expect(user).not.toContain("The whole post must be built around the LESSON, seen through the ANGLE. Make");
  });

  it("includes the collided-with post when there was one", () => {
    const { user } = assemblePrompt(
      regenerateRequest({
        collidedWith: { body: "an older post about the same idea", similarity: 0.91 },
      }),
      FIXTURE_GOLDENS,
    );
    expect(user).toContain("too close (similarity 0.91) to this existing");
    expect(user).toContain("an older post about the same idea");
  });

  it("omits the collision section when there was no duplicate", () => {
    const { user } = assemblePrompt(regenerateRequest({ collidedWith: undefined }), FIXTURE_GOLDENS);
    expect(user).not.toContain("the post you were too close to");
  });
});
