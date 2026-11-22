import type { AttentionRow } from "../../domain/analytics/dashboard";

/**
 * The arithmetic behind the Command Centre's shapes.
 *
 * Here rather than inside the screen so it can be tested without a
 * browser: a donut whose arcs do not add up to a circle, or a percentage
 * that reads "+Infinity%", is the kind of thing that looks fine in a
 * screenshot and is wrong on a Monday morning with real data.
 */

/* ── the change on a tile ─────────────────────────────────────────── */

export interface Change {
  /** Already formatted, with its sign: "+28.6%". */
  text: string;
  direction: "up" | "down" | "flat";
}

/**
 * The change from one period to the next, or null when there is no
 * honest way to state one.
 *
 * FROM NOTHING TO SOMETHING IS NOT A PERCENTAGE. A first month of
 * revenue after a zero month is an infinite rise, and every dashboard
 * that prints "+∞%" or "+100%" there is choosing a number to avoid an
 * empty space. This returns null and the tile shows no trend at all.
 */
export function changeBetween(before: number, after: number): Change | null {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  if (before <= 0) return null;
  const pct = ((after - before) / before) * 100;
  /* Under a tenth of a percent is noise, and an arrow on noise is a
     story about nothing. */
  if (Math.abs(pct) < 0.1) return { text: "0%", direction: "flat" };
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  return {
    text: `${pct > 0 ? "+" : "−"}${rounded}%`,
    direction: pct > 0 ? "up" : "down",
  };
}

/* ── the pipeline ring ────────────────────────────────────────────── */

export interface Slice {
  id: string;
  label: string;
  count: number;
  valueLabel: string;
  colour: string;
}

export interface Arc {
  id: string;
  colour: string;
  /** Percent of the circumference this arc covers. */
  length: number;
  /** SVG stroke-dashoffset that puts it after the ones before it. */
  offset: number;
}

/**
 * Lay the slices around a ring.
 *
 * DRAWN WITH stroke-dasharray ON ONE CIRCLE, which is why the numbers
 * are percentages of 100: the circle's circumference is set to 100 units
 * (r = 15.9) so a slice's length IS its percentage and no π appears
 * anywhere. The offset runs backwards — SVG counts dash offset
 * clockwise from 3 o'clock — hence 25 to start at the top and subtract
 * as we go round.
 *
 * SLICES OF ZERO ARE DROPPED. A zero-length arc still paints its round
 * cap, which puts a dot of colour on the ring for a stage holding
 * nothing.
 */
export function donutArcs(slices: readonly Slice[]): Arc[] {
  const total = slices.reduce((n, s) => n + Math.max(0, s.count), 0);
  if (total <= 0) return [];
  const arcs: Arc[] = [];
  let used = 0;
  for (const s of slices) {
    const count = Math.max(0, s.count);
    if (!count) continue;
    const length = (count / total) * 100;
    arcs.push({ id: s.id, colour: s.colour, length, offset: 25 - used });
    used += length;
  }
  return arcs;
}

/* ── "My Activities" ──────────────────────────────────────────────── */

export interface ActivityGroup {
  id: string;
  count: number;
  label: string;
  tone: "bad" | "warn";
  view: string;
}

/** What each kind of row is called when several are counted together. */
const GROUPS: { kind: string; one: string; many: string; view: string }[] = [
  { kind: "follow-up", one: "Follow-up due", many: "Follow-ups due", view: "customers" },
  { kind: "overdue-proforma", one: "Payment overdue", many: "Payments overdue", view: "receivables" },
  { kind: "stale-quotation", one: "Quotation past validity", many: "Quotations past validity", view: "quotations" },
  { kind: "renewal", one: "Renewal inside 30 days", many: "Renewals inside 30 days", view: "renewals" },
  { kind: "unbacked-win", one: "Win with nothing raised", many: "Wins with nothing raised", view: "pipeline" },
  { kind: "won-mismatch", one: "Figure disagrees with the paperwork", many: "Figures disagree with the paperwork", view: "pipeline" },
];

/**
 * The attention list, counted by kind.
 *
 * THE PANEL IS A COUNT, NOT A LIST. "5 follow-ups due today" is one line
 * somebody acts on; the same five as five rows pushes everything else
 * off the card. The order is the order of GROUPS — fixed, so the panel
 * does not reshuffle itself as the day goes on and somebody loses the
 * line they were about to press.
 *
 * A GROUP WITH NOTHING IN IT IS NOT SHOWN. A row reading "0 payments
 * overdue" is a line of furniture: true, and not worth a tap target.
 */
export function groupActivities(rows: readonly AttentionRow[]): ActivityGroup[] {
  const out: ActivityGroup[] = [];
  for (const g of GROUPS) {
    const mine = rows.filter((r) => r.kind === g.kind);
    if (!mine.length) continue;
    out.push({
      id: g.kind,
      count: mine.length,
      label: mine.length === 1 ? g.one : g.many,
      /* Red only when one of them actually is: a group of warnings
         marked red is the same over-colouring that makes a red screen
         mean nothing. */
      tone: mine.some((r) => r.tone === "bad") ? "bad" : "warn",
      view: g.view,
    });
  }
  return out;
}
