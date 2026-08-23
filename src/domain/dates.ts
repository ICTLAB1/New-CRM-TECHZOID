/**
 * Dates, formatted once.
 *
 * Two forms, deliberately: a table has room for the year and needs it to be
 * unambiguous; a pipeline card does not and the year is almost always the
 * current one. Both come from here so they can never drift into three formats
 * across four screens.
 */
export const TODAY = (): string => new Date().toISOString().slice(0, 10);

const parse = (iso: string): Date | null => {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return isNaN(d.getTime()) ? null : d;
};

/** "21 Aug 2026" — lists, tables, detail views. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parse(iso);
  if (!d) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** "21 Aug" — cards and other places with one line to spare. */
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parse(iso);
  if (!d) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export const isOverdue = (iso: string | null | undefined, today: string = TODAY()): boolean =>
  !!iso && iso < today;

/** Add days to an ISO date, staying on the local calendar. */
export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
