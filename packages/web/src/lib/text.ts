/** Matches LinkedIn's own desktop truncation point, for the "…see more" feel. */
export const CARD_PREVIEW_CHARS = 210;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}
