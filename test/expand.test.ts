import { describe, expect, it } from "vitest";
import type { ContentModel } from "../src/models/types.js";
import { expandStoryIntoTopics, expandTopicIntoAngles } from "../src/pipeline/expand.js";

function modelReturning(text: string): ContentModel {
  return {
    channel: "zai",
    model: "fake",
    async generate() {
      return { text, channel: "zai", model: "fake" };
    },
  };
}

describe("expandTopicIntoAngles", () => {
  it("returns the requested number of angles", async () => {
    const model = modelReturning(
      "<angles><angle>angle one</angle><angle>angle two</angle><angle>angle three</angle></angles>",
    );
    const angles = await expandTopicIntoAngles("Pod autoscaling", 2, model);
    expect(angles).toEqual(["angle one", "angle two"]);
  });

  it("throws when the model returns too few angles", async () => {
    const model = modelReturning("<angles><angle>only one</angle></angles>");
    await expect(expandTopicIntoAngles("Pod autoscaling", 3, model)).rejects.toThrow(
      /expected 3 angles .* returned 1/,
    );
  });
});

describe("expandStoryIntoTopics", () => {
  it("pulls the requested number of topics out of a story", async () => {
    const model = modelReturning(
      "<topics><topic>simulated a DDoS attack</topic><topic>added quality gates</topic></topics>",
    );
    const topics = await expandStoryIntoTopics("... a long story ...", 2, model);
    expect(topics).toEqual(["simulated a DDoS attack", "added quality gates"]);
  });

  it("throws when the model returns too few topics", async () => {
    const model = modelReturning("<topics><topic>just one</topic></topics>");
    await expect(expandStoryIntoTopics("... story ...", 5, model)).rejects.toThrow(
      /expected 5 topics .* returned 1/,
    );
  });
});
