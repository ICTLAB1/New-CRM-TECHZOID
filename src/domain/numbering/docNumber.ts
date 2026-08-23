/** Indian financial year: 1 April – 31 March. */
export function fyShortPair(date: Date = new Date()): { fy: number; next: number } {
  const fy = (date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1) % 100;
  return { fy, next: fy + 1 };
}

/** Document number: PREFIX/2526/0001.
 *  Prefix and sequence are configurable in settings; the FY segment and the
 *  4-digit zero padding are not — existing documents in the live database
 *  carry this exact shape. */
export function buildDocNumber(prefix: string, seq: number | null | undefined, date: Date = new Date()): string {
  const { fy, next } = fyShortPair(date);
  return `${prefix}/${fy}${next}/${String(seq || 1).padStart(4, "0")}`;
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
