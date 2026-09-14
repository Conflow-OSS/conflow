/** Matches LinkedIn's own desktop truncation point, for the "…see more" feel. */
export const CARD_PREVIEW_CHARS = 210;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * LinkedIn's post composer collapses blank lines it sees as genuinely
 * empty when you paste plain text into it — a widely-reported LinkedIn
 * paste-handling quirk, not specific to this app (it hits anyone pasting
 * from Word, Notion, Google Docs, anywhere). The standard workaround is to
 * put an invisible character on each blank line so LinkedIn's "is this
 * empty?" check sees content there and leaves the spacing alone. Only
 * transforms the clipboard copy — the stored post body/summary is untouched.
 */
export function toClipboardSafeText(text: string): string {
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? ZERO_WIDTH_SPACE : line))
    .join("\n");
}
