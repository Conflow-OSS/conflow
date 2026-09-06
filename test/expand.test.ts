import { describe, expect, it } from "vitest";
import type { ContentModel } from "../src/models/types.js";
import {
  expandAngleIntoLessons,
  expandStoryIntoTopics,
  expandTopicIntoAngles,
} from "../src/pipeline/expand.js";

function modelReturning(text: string): ContentModel {
  return {
    channel: "zai",
    model: "fake",
    async generate() {
      return { text, channel: "zai", model: "fake" };
    },
  };
}

function modelEchoingPrompt(text: string): { model: ContentModel; lastPrompt: () => string } {
  let lastPrompt = "";
  return {
    lastPrompt: () => lastPrompt,
    model: {
      channel: "zai",
      model: "fake",
      async generate({ user }) {
        lastPrompt = user;
        return { text, channel: "zai", model: "fake" };
      },
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

describe("expandAngleIntoLessons", () => {
  it("returns the requested number of lessons for the angle", async () => {
    const model = modelReturning(
      "<lessons><lesson>trace IDs skip log-grepping</lesson><lesson>juniors can run the incident</lesson></lessons>",
    );
    const lessons = await expandAngleIntoLessons(
      "Distributed tracing",
      "cutting mean-time-to-detect",
      2,
      model,
    );
    expect(lessons).toEqual(["trace IDs skip log-grepping", "juniors can run the incident"]);
  });

  it("throws when the model returns too few lessons", async () => {
    const model = modelReturning("<lessons><lesson>only one</lesson></lessons>");
    await expect(
      expandAngleIntoLessons("Distributed tracing", "onboarding", 3, model),
    ).rejects.toThrow(/expected 3 lessons .* returned 1/);
  });

  it("includes the source facts in the prompt when given", async () => {
    const echo = modelEchoingPrompt(
      "<lessons><lesson>a</lesson><lesson>b</lesson></lessons>",
    );
    await expandAngleIntoLessons("Tracing", "incidents", 2, echo.model, "We cut MTTD from 40m to 6m.");
    expect(echo.lastPrompt()).toContain("We cut MTTD from 40m to 6m.");
  });
});
