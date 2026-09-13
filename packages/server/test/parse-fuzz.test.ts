import { describe, expect, it } from "vitest";
import { parsePostXml, parseTagList } from "../src/pipeline/parse.js";

// The model output is untrusted. parsePostXml must always either return a
// ParsedPost with a real body, or throw a plain Error — never crash, never hang.

const MALFORMED_RESPONSES: Array<[string, string]> = [
  ["empty string", ""],
  ["whitespace only", "   \n\t  "],
  ["plain prose, no tags", "Sure! Here is your post about Kubernetes autoscaling."],
  ["truncated before the closing body tag", "<post><body>the post got cut off here"],
  ["empty body", "<post><body></body></post>"],
  ["body with only whitespace", "<post><body>   \n  </body></post>"],
  ["opening tag only", "<body>"],
  ["closing tag only", "</body>"],
  ["mismatched tags", "<post><body>hello</summary></post>"],
  ["unclosed nested angle brackets", "<post><body>if a < b then c</body></post>"],
  ["json instead of xml", '{"body": "a post", "format": "long"}'],
  ["huge input without a body", "x".repeat(200_000)],
];

describe("parsePostXml fuzzing", () => {
  it.each(MALFORMED_RESPONSES)("handles: %s", (_name, response) => {
    let result: ReturnType<typeof parsePostXml> | undefined;
    let thrown: unknown;
    try {
      result = parsePostXml(response);
    } catch (error) {
      thrown = error;
    }

    if (thrown !== undefined) {
      expect(thrown).toBeInstanceOf(Error);
    } else {
      expect(typeof result?.body).toBe("string");
      expect(result?.body.length).toBeGreaterThan(0);
    }
  });

  it("extracts the body even from a valid post wrapped in noise", () => {
    const noisy =
      "Here you go:\n```xml\n<post><format>short</format>" +
      "<body>the real body</body><summary>the point</summary></post>\n```\nEnjoy!";
    const parsed = parsePostXml(noisy);
    expect(parsed.body).toBe("the real body");
    expect(parsed.summary).toBe("the point");
  });

  it("tolerates attributes on tags", () => {
    const parsed = parsePostXml('<post><body lang="en">attributed body</body></post>');
    expect(parsed.body).toBe("attributed body");
  });
});

describe("parseTagList fuzzing", () => {
  it("returns an empty array for anything without the tag", () => {
    for (const [, response] of MALFORMED_RESPONSES) {
      expect(Array.isArray(parseTagList(response, "lesson"))).toBe(true);
    }
  });

  it("skips empty items", () => {
    const response = "<lessons><lesson>real</lesson><lesson>   </lesson><lesson></lesson></lessons>";
    expect(parseTagList(response, "lesson")).toEqual(["real"]);
  });
});
