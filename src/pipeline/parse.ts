export interface ParsedPost {
  format: string | null;
  hookStyle: string | null;
  topicAngle: string | null;
  body: string;
  charCountFromModel: number | null;
  summary: string | null;
  summaryCharCountFromModel: number | null;
}

export function parsePostXml(modelResponse: string): ParsedPost {
  const body = extractTagContent(modelResponse, "body");
  if (body === null) {
    throw new Error("model response has no <body> tag");
  }

  return {
    format: extractTagContent(modelResponse, "format"),
    hookStyle: extractTagContent(modelResponse, "hook_style"),
    topicAngle: extractTagContent(modelResponse, "topic_angle"),
    body,
    charCountFromModel: extractNumberTag(modelResponse, "char_count"),
    summary: extractTagContent(modelResponse, "summary"),
    summaryCharCountFromModel: extractNumberTag(modelResponse, "summary_char_count"),
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

function extractNumberTag(text: string, tagName: string): number | null {
  const raw = extractTagContent(text, tagName);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
