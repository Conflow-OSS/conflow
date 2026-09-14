import type { ContentModel } from "../models/types.js";
import { parseTagList } from "./parse.js";

const XML_ONLY_SYSTEM_PROMPT = "You produce concise, well-formed XML and no prose outside it.";

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

const TOPIC_TO_ANGLES_TEMPLATE = `You are helping a DevOps engineer plan LinkedIn content.

Topic: {{topic}}

Give exactly {{count}} distinct angles on this topic. An angle is the reader's situation or the
benefit category — a different lens to write about the topic. Write each as a short phrase of
about 5 to 12 words.

Return only this XML, nothing else:
<angles>
  <angle>first angle</angle>
  <angle>second angle</angle>
</angles>`;

const ANGLE_TO_LESSONS_TEMPLATE = `You are helping a DevOps engineer plan LinkedIn content.

Topic: {{topic}}
Angle: {{angle}}
{{source_facts_block}}
Give exactly {{count}} distinct lessons for this angle. A lesson is ONE specific thing the
reader learns or should do — a concrete mechanism or outcome, not a restatement of the angle.
Each lesson must be substantial enough to be the single spine of a whole post, and the lessons
must not overlap. Write each as a sentence or short phrase.

Return only this XML, nothing else:
<lessons>
  <lesson>first lesson</lesson>
  <lesson>second lesson</lesson>
</lessons>`;

export async function expandStoryIntoTopics(
  story: string,
  topicCount: number,
  model: ContentModel,
): Promise<string[]> {
  const prompt = fill(STORY_TO_TOPICS_TEMPLATE, { count: topicCount, story });
  return requireExactly(
    await generateTagList(prompt, "topic", model),
    topicCount,
    `topics for the story`,
  );
}

export async function expandTopicIntoAngles(
  topic: string,
  angleCount: number,
  model: ContentModel,
): Promise<string[]> {
  const prompt = fill(TOPIC_TO_ANGLES_TEMPLATE, { topic, count: angleCount });
  return requireExactly(
    await generateTagList(prompt, "angle", model),
    angleCount,
    `angles for "${topic}"`,
  );
}

export async function expandAngleIntoLessons(
  topic: string,
  angle: string,
  lessonCount: number,
  model: ContentModel,
  sourceFacts?: string,
): Promise<string[]> {
  const sourceFactsBlock = sourceFacts?.trim()
    ? `\nWhat actually happened (draw the lessons from this):\n${sourceFacts.trim()}\n`
    : "";
  const prompt = fill(ANGLE_TO_LESSONS_TEMPLATE, {
    topic,
    angle,
    count: lessonCount,
    source_facts_block: sourceFactsBlock,
  });
  return requireExactly(
    await generateTagList(prompt, "lesson", model),
    lessonCount,
    `lessons for the angle "${angle}"`,
  );
}

function fill(template: string, values: Record<string, string | number>): string {
  let filled = template;
  for (const [key, value] of Object.entries(values)) {
    filled = filled.replaceAll(`{{${key}}}`, String(value));
  }
  return filled;
}

async function generateTagList(
  prompt: string,
  tagName: string,
  model: ContentModel,
): Promise<string[]> {
  const response = await model.generate({ system: XML_ONLY_SYSTEM_PROMPT, user: prompt });
  return parseTagList(response.text, tagName);
}

function requireExactly(items: string[], wanted: number, description: string): string[] {
  if (items.length < wanted) {
    throw new Error(`expected ${wanted} ${description} but the model returned ${items.length}`);
  }
  return items.slice(0, wanted);
}
