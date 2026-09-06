import type { ContentModel } from "../models/types.js";
import { parseAngleList } from "./parse.js";

const ANGLE_PROMPT_TEMPLATE = `You are helping a DevOps engineer plan LinkedIn content.

Topic: {{topic}}

Give exactly {{count}} distinct angles on this topic. Each angle is a different lens to write
about it — a different benefit, scenario, or reader concern. Write each as a short phrase of
about 5 to 12 words.

Return only this XML, nothing else:
<angles>
  <angle>first angle</angle>
  <angle>second angle</angle>
</angles>`;

export async function expandTopicIntoAngles(
  topic: string,
  angleCount: number,
  model: ContentModel,
): Promise<string[]> {
  const prompt = ANGLE_PROMPT_TEMPLATE.replace("{{topic}}", topic).replace(
    "{{count}}",
    String(angleCount),
  );

  const response = await model.generate({
    system: "You produce concise, well-formed XML and no prose outside it.",
    user: prompt,
  });

  const angles = parseAngleList(response.text);
  if (angles.length < angleCount) {
    throw new Error(
      `expected ${angleCount} angles for "${topic}" but the model returned ${angles.length}`,
    );
  }
  return angles.slice(0, angleCount);
}
