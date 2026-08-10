/**
 * Normalize common non-GSM characters to GSM-7-safe equivalents.
 * Prevents accidental UCS-2 encoding (67-char segments) and
 * carrier rejections like Twilio error 30019.
 */
const REPLACEMENTS: Record<string, string> = {
  '\u2013': '-',   // en dash
  '\u2014': '-',   // em dash
  '\u2018': "'",   // left single quote
  '\u2019': "'",   // right single quote
  '\u201C': '"',   // left double quote
  '\u201D': '"',   // right double quote
  '\u2026': '...', // ellipsis
  '\u00A0': ' ',   // non-breaking space
  '\u2011': '-',   // non-breaking hyphen
  '\u2022': '*',   // bullet
  '\u00B4': "'",   // acute accent
  '\u02BC': "'",   // modifier apostrophe
};

export function normalizeToGsm(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [bad, good] of Object.entries(REPLACEMENTS)) {
    out = out.split(bad).join(good);
  }
  return out;
}
