/**
 * jsPDF's built-in fonts (Helvetica/Times/Courier) only support the
 * WinAnsi/Latin-1 character set. Any text outside that range — emoji, most
 * typographic symbols, non-Latin scripts — renders as corrupted "(cid:0)"
 * glyph codes and can wreck surrounding text on the same line.
 *
 * Every text field in a document is admin- or user-editable (company name,
 * ISO cert lines, terms, notes, salutation, labels, customer names and
 * addresses), so sanitising happens once at the jsPDF API boundary rather
 * than at each of the hundred call sites.
 *
 * Common typography degrades to its ASCII equivalent instead of vanishing:
 * curly quotes, ellipsis, en/em dashes and bullets all have sensible
 * fallbacks. Anything else above U+00FF is dropped.
 */
export function pdfSafeText<T extends string | string[]>(v: T): T;
export function pdfSafeText(v: unknown): string | string[] {
  if (Array.isArray(v)) return v.map((x) => pdfSafeText(x) as string);
  return String(v)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-")
    .replace(/[•●◦]/g, "-")
    .replace(/[^\x00-\xFF]/g, "");
}

/** #RRGGBB -> [r, g, b]. Falls back to near-black, as v1 did. */
export function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m
    ? [parseInt(m[1] as string, 16), parseInt(m[2] as string, 16), parseInt(m[3] as string, 16)]
    : [26, 26, 26];
}
