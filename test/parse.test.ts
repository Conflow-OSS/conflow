import { describe, expect, it } from "vitest";
import { parseAngleList, parsePostXml } from "../src/pipeline/parse.js";

const CLEAN_POST = `<post>
  <format>long</format>
  <hook_style>questions</hook_style>
  <topic_angle>keeping staging and prod in sync</topic_angle>
  <body>What if your environments never drifted apart again??

Here is the body of the post.

#DevOps #IaC</body>
  <char_count>84</char_count>
</post>`;

describe("parsePostXml", () => {
  it("reads every field from a clean response", () => {
    const parsed = parsePostXml(CLEAN_POST);
    expect(parsed.format).toBe("long");
    expect(parsed.hookStyle).toBe("questions");
    expect(parsed.topicAngle).toBe("keeping staging and prod in sync");
    expect(parsed.body).toContain("What if your environments never drifted apart again??");
    expect(parsed.body).toContain("#DevOps #IaC");
    expect(parsed.charCountFromModel).toBe(84);
  });

  it("still works when the model wraps the XML in a code fence and chatter", () => {
    const noisy = "Sure, here is the post:\n\n```xml\n" + CLEAN_POST + "\n```\nHope that helps!";
    const parsed = parsePostXml(noisy);
    expect(parsed.format).toBe("long");
    expect(parsed.body).toContain("Here is the body of the post.");
  });

  it("returns null for a missing char_count rather than NaN", () => {
    const withoutCount = CLEAN_POST.replace(/<char_count>.*<\/char_count>/, "");
    expect(parsePostXml(withoutCount).charCountFromModel).toBeNull();
  });

  it("throws when there is no body tag", () => {
    expect(() => parsePostXml("<post><format>long</format></post>")).toThrow(/no <body> tag/);
  });
});

describe("parseAngleList", () => {
  it("collects every angle and trims whitespace", () => {
    const response = `<angles>
      <angle>cutting mean-time-to-detect during an incident</angle>
      <angle>  giving new engineers a safe way to debug  </angle>
    </angles>`;
    expect(parseAngleList(response)).toEqual([
      "cutting mean-time-to-detect during an incident",
      "giving new engineers a safe way to debug",
    ]);
  });

  it("returns an empty list when there are no angle tags", () => {
    expect(parseAngleList("no xml here")).toEqual([]);
  });
});
