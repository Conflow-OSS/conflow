export interface ParsedPost {
  format: string | null;
  hookStyle: string | null;
  topicAngle: string | null;
  body: string;
  charCountFromModel: number | null;
}

export function parsePostXml(modelResponse: string): ParsedPost {
  const body = extractTagContent(modelResponse, "body");
  if (body === null) {
    throw new Error("model response has no <body> tag");
  }

  const charCountText = extractTagContent(modelResponse, "char_count");
  const charCountFromModel = charCountText ? Number.parseInt(charCountText, 10) : NaN;

  return {
    format: extractTagContent(modelResponse, "format"),
    hookStyle: extractTagContent(modelResponse, "hook_style"),
    topicAngle: extractTagContent(modelResponse, "topic_angle"),
    body,
    charCountFromModel: Number.isNaN(charCountFromModel) ? null : charCountFromModel,
  };
}

export function parseTagList(modelResponse: string, tagName: string): string[] {
  const itemPattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "gi");
  const items: string[] = [];
  for (const match of modelResponse.matchAll(itemPattern)) {
    const item = match[1]!.trim();
    if (item.length > 0) {
      items.push(item);
    }
  }
  return items;
}

function extractTagContent(text: string, tagName: string): string | null {
  const tagPattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i");
  const match = text.match(tagPattern);
  return match ? match[1]!.trim() : null;
}
