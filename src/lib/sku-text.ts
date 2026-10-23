/** `//:` (and legacy `/sku:`) handling for plain-text boxes (SMS / WhatsApp). Works at the caret, not just the end. */

export function skuQueryAt(text: string, caret: number): string | null {
  const m = text.slice(0, caret).match(/(?:\/\/:|\/sku:)(\S*)$/);
  return m ? m[1] : null;
}

/** Replace the `//:query` before the caret with "STYLE link ". Returns the new text and caret. */
export function insertSkuText(text: string, caret: number, product: { style_number: string; url?: string }) {
  const before = text.slice(0, caret);
  const m = before.match(/(?:\/\/:|\/sku:)\S*$/);
  if (!m || !product.url) return null;
  const start = caret - m[0].length;
  const nextIsSpace = /^\s/.test(text.slice(caret));
  const insert = `${product.style_number} ${product.url}${nextIsSpace ? '' : ' '}`;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}
