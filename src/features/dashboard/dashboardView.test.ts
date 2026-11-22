import { describe, expect, it } from "vitest";
import { changeBetween, donutArcs, groupActivities, type Slice } from "./dashboardView";
import type { AttentionRow } from "../../domain/analytics/dashboard";

/**
 * The arithmetic behind the Command Centre's shapes.
 *
 * A donut whose arcs do not close the circle, or a tile reading
 * "+Infinity%", is the kind of thing that looks right in a screenshot
 * and is wrong on a Monday morning with real data.
 */

describe("the change on a tile", () => {
  it("reads the rise as a signed percentage", () => {
    expect(changeBetween(305000, 392000)).toEqual({ text: "+28.5%", direction: "up" });
  });

  it("reads a fall the same way, with a minus", () => {
    const out = changeBetween(400000, 300000);
    expect(out?.direction).toBe("down");
    expect(out?.text).toBe("−25%");
  });

  it("SAYS NOTHING RATHER THAN INFINITY when the month before was zero", () => {
    /* The one every dashboard gets wrong. A first month of revenue after
       a zero month is an infinite rise, and "+100%" is a number chosen
       to avoid an empty space — somebody will quote it in a meeting. */
    expect(changeBetween(0, 392000)).toBeNull();
    expect(changeBetween(-5, 10)).toBeNull();
  });

  it("says nothing when either figure is not a number", () => {
    expect(changeBetween(Number.NaN, 10)).toBeNull();
    expect(changeBetween(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("calls a hair's breadth flat rather than drawing an arrow on noise", () => {
    expect(changeBetween(1_000_000, 1_000_500)).toEqual({ text: "0%", direction: "flat" });
  });

  it("rounds to one decimal, so a tile is never 28.571428%", () => {
    expect(changeBetween(700, 900)?.text).toBe("+28.6%");
  });
});

describe("the pipeline ring", () => {
  const slice = (id: string, count: number): Slice =>
    ({ id, count, label: id, valueLabel: "—", colour: `var(--stage-1)` });

  it("gives every slice its share of the circle", () => {
    const arcs = donutArcs([slice("a", 1), slice("b", 1), slice("c", 2)]);
    expect(arcs.map((a) => a.length)).toEqual([25, 25, 50]);
  });

  it("CLOSES THE CIRCLE — the lengths total one hundred", () => {
    /* The circumference is set to 100 units so a slice's length IS its
       percentage. Arcs that do not sum to 100 leave a gap in the ring
       that reads as missing data. */
    const arcs = donutArcs([slice("a", 7), slice("b", 11), slice("c", 3), slice("d", 29)]);
    const total = arcs.reduce((n, a) => n + a.length, 0);
    expect(Math.round(total)).toBe(100);
  });

  it("lays each arc after the one before it", () => {
    const arcs = donutArcs([slice("a", 1), slice("b", 3)]);
    /* Offsets run backwards: SVG counts dash offset clockwise from three
       o'clock, and 25 starts the first arc at the top. */
    expect(arcs[0]!.offset).toBe(25);
    expect(arcs[1]!.offset).toBe(25 - 25);
  });

  it("DROPS A STAGE HOLDING NOTHING", () => {
    /* A zero-length arc still paints its round cap, which puts a dot of
       colour on the ring for a stage with no deals in it. */
    const arcs = donutArcs([slice("a", 3), slice("empty", 0), slice("b", 1)]);
    expect(arcs.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("draws nothing at all when every stage is empty", () => {
    expect(donutArcs([slice("a", 0), slice("b", 0)])).toEqual([]);
    expect(donutArcs([])).toEqual([]);
  });

  it("ignores a negative count rather than drawing backwards", () => {
    const arcs = donutArcs([slice("a", 2), slice("bad", -5)]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.length).toBe(100);
  });
});

describe("my activities", () => {
  const row = (kind: string, tone: "bad" | "warn" = "warn"): AttentionRow =>
    ({ kind, id: Math.random().toString(), title: "x", detail: "y", urgency: 1, tone, view: "x" } as AttentionRow);

  it("counts each kind into one line", () => {
    const out = groupActivities([row("follow-up"), row("follow-up"), row("renewal")]);
    expect(out.map((g) => [g.count, g.label])).toEqual([
      [2, "Follow-ups due"],
      [1, "Renewal inside 30 days"],
    ]);
  });

  it("says it in the singular when there is one", () => {
    expect(groupActivities([row("follow-up")])[0]!.label).toBe("Follow-up due");
  });

  it("LEAVES OUT A KIND WITH NOTHING IN IT", () => {
    /* "0 payments overdue" is true and is a line of furniture with a tap
       target on it. */
    const out = groupActivities([row("follow-up")]);
    expect(out).toHaveLength(1);
  });

  it("keeps a fixed order, so the panel does not reshuffle through the day", () => {
    const out = groupActivities([row("renewal"), row("follow-up"), row("overdue-proforma")]);
    expect(out.map((g) => g.id)).toEqual(["follow-up", "overdue-proforma", "renewal"]);
  });

  it("goes red only when one of them actually is", () => {
    expect(groupActivities([row("follow-up", "warn"), row("follow-up", "warn")])[0]!.tone).toBe("warn");
    expect(groupActivities([row("follow-up", "warn"), row("follow-up", "bad")])[0]!.tone).toBe("bad");
  });

  it("sends each line to the screen that fixes it", () => {
    const out = groupActivities([row("overdue-proforma"), row("stale-quotation")]);
    expect(out.map((g) => g.view)).toEqual(["receivables", "quotations"]);
  });

  it("copes with an empty list", () => {
    expect(groupActivities([])).toEqual([]);
  });
});
