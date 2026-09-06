import type { ContentModel } from "../models/types.js";
import { parseTagList } from "./parse.js";

const XML_ONLY_SYSTEM_PROMPT = "You produce concise, well-formed XML and no prose outside it.";

const TOPIC_TO_ANGLES_TEMPLATE = `You are helping a DevOps engineer plan LinkedIn content.

Topic: {{topic}}

Give exactly {{count}} distinct angles on this topic. Each angle is a different lens to write
about it — a different benefit, scenario, or reader concern. Write each as a short phrase of
about 5 to 12 words.

Return only this XML, nothing else:
<angles>
  <angle>first angle</angle>
  <angle>second angle</angle>
</angles>`;

const STORY_TO_TOPICS_TEMPLATE = `You are helping a DevOps engineer turn a long story into LinkedIn content.

Below is a story or case study. Pull out exactly {{count}} distinct topics, each worth its own
post — concrete things that happened, decisions made, problems solved, or lessons learned. Do
not let the topics overlap. Write each as a short phrase of about 4 to 12 words.

STORY:
{{story}}

Return only this XML, nothing else:
<topics>
  <topic>first topic</topic>
  <topic>second topic</topic>
</topics>`;

export async function expandTopicIntoAngles(
  topic: string,
  angleCount: number,
  model: ContentModel,
): Promise<string[]> {
  const prompt = TOPIC_TO_ANGLES_TEMPLATE.replace("{{topic}}", topic).replace(
    "{{count}}",
    String(angleCount),
  );
  const angles = await generateTagList(prompt, "angle", model);

  if (angles.length < angleCount) {
    throw new Error(
      `expected ${angleCount} angles for "${topic}" but the model returned ${angles.length}`,
    );
  }
  return angles.slice(0, angleCount);
}

export async function expandStoryIntoTopics(
  story: string,
  topicCount: number,
  model: ContentModel,
): Promise<string[]> {
  const prompt = STORY_TO_TOPICS_TEMPLATE.replace("{{count}}", String(topicCount)).replace(
    "{{story}}",
    story,
  );
  const topics = await generateTagList(prompt, "topic", model);

  if (topics.length < topicCount) {
    throw new Error(`expected ${topicCount} topics but the model returned ${topics.length}`);
  }
  return topics.slice(0, topicCount);
}

async function generateTagList(
  prompt: string,
  tagName: string,
  model: ContentModel,
): Promise<string[]> {
  const response = await model.generate({ system: XML_ONLY_SYSTEM_PROMPT, user: prompt });
  return parseTagList(response.text, tagName);
}
