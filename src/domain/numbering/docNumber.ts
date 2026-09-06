/** Indian financial year: 1 April – 31 March. */
export function fyShortPair(date: Date = new Date()): { fy: number; next: number } {
  const fy = (date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1) % 100;
  return { fy, next: fy + 1 };
}

/**
 * The Indian financial year an instant falls in, written 2026-27.
 *
 * Extracted from buildDocNumber because it is now needed in two places: the
 * label printed on the document, and the series the number is drawn from.
 * Those two MUST agree — a number printed under 2027-28 that came out of the
 * 2026-27 counter is worse than either mistake alone — so there is one
 * function and both callers use it.
 */
export function fyLabel(date: Date = new Date()): string {
  const fyStart = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
}

/**
 * Document number: PREFIX/2026-27/0001.
 *
 * DEVIATION FROM v1 (deliberate, client-requested): v1 produced
 * PREFIX/2627/0001 — both years compressed to two digits with no
 * separator. The client supplied a reference quotation with the full
 * four-digit starting year and a hyphen (2026-27) and asked for it
 * exactly. This only affects documents created from here on — a document
 * number already stored is just text; changing this function does not
 * touch it.
 *
 * Prefix and sequence stay configurable in settings; the FY segment and
 * the 4-digit zero padding do not.
 */
export function buildDocNumber(prefix: string, seq: number | null | undefined, date: Date = new Date()): string {
  return `${prefix}/${fyLabel(date)}/${String(seq || 1).padStart(4, "0")}`;
}

export function fyBounds(date: Date = new Date()): { startMs: number; endMs: number; label: string } {
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return {
    startMs: new Date(y, 3, 1).getTime(),
    endMs: new Date(y + 1, 2, 31, 23, 59, 59, 999).getTime(),
    label: "FY " + y + "-" + String((y + 1) % 100).padStart(2, "0"),
  };
}

export function monthBounds(date: Date = new Date()): { startMs: number; endMs: number; label: string } {
  const y = date.getFullYear();
  const m = date.getMonth();
  return {
    startMs: new Date(y, m, 1).getTime(),
    endMs: new Date(y, m + 1, 0, 23, 59, 59, 999).getTime(),
    label: date.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
  };
}
