import { describe, expect, it } from "vitest";
import { mismatchNote, wonFigure, wonMismatches } from "./reconcile";

/**
 * REPORTED FAULT: "Total sales or closed orders values are not getting
 * matched with the order won or invoice."
 *
 * The cause is fixed at the moment of the win, but a code fix cannot reach
 * a figure frozen months ago. This is what finds those.
 */

const day = (n: number) => Date.UTC(2026, 0, n);

/* A total per document number, so the tax engine is not in the way of
   testing the comparison. */
const totals: Record<string, number> = {
  "INV-1": 472000,
  "SO-1": 460000,
  "PF-1": 450000,
  "QT-1": 429992,
  "QT-EMPTY": 0,
};
const total = (doc: { number?: string }) => totals[String(doc.number)] ?? 0;

const won = (over: Record<string, unknown> = {}) => ({
  id: "c1", stage: "won", wonAt: day(5), ...over,
});

describe("what a won deal is reported at, against its paperwork", () => {
  it("finds the estimate frozen instead of the order", () => {
    /* The reported case: ₹50,000 guessed in March, a ₹4,72,000 invoice
       raised in October, and the revenue report showing the guess. */
    const f = wonFigure(won({ wonValue: 50000 }), { invoices: [{ customerId: "c1", number: "INV-1" }] }, total);
    expect(f.recorded).toBe(50000);
    expect(f.documented).toBe(472000);
    expect(f.tier).toBe("invoice");
    expect(f.number).toBe("INV-1");
    expect(f.matches).toBe(false);
  });

  it("says nothing when the two agree", () => {
    const f = wonFigure(won({ wonValue: 472000 }), { invoices: [{ customerId: "c1", number: "INV-1" }] }, total);
    expect(f.matches).toBe(true);
    expect(mismatchNote(f, (n) => `₹${n}`)).toBe("");
  });

  it("does not call a rounding difference a mismatch", () => {
    /* Rupees. A difference under one is the same figure rounded twice, and
       a screen that flags those is a screen nobody reads. */
    const f = wonFigure(won({ wonValue: 472000.4 }), { invoices: [{ customerId: "c1", number: "INV-1" }] }, total);
    expect(f.matches).toBe(true);
  });

  it("DOES report a small real gap — the tolerance is one rupee, not a margin", () => {
    /* Without this the tolerance could be widened to any size and every
       test above would still pass: a ₹2 gap and a ₹4,22,000 gap are both
       mismatches, and only the first one pins the boundary. A revised
       order that came in ₹1,500 under the quotation is exactly the case
       somebody needs told about. */
    const two = wonFigure(won({ wonValue: 471998 }), { invoices: [{ customerId: "c1", number: "INV-1" }] }, total);
    expect(two.matches).toBe(false);
    const fifteenHundred = wonFigure(won({ wonValue: 470500 }), { invoices: [{ customerId: "c1", number: "INV-1" }] }, total);
    expect(fifteenHundred.matches).toBe(false);
  });

  it("reads the frozen figure, not the live estimate, as what is counted", () => {
    /* wonAmount is wonValue ?? value, and that is what the reports sum. */
    const f = wonFigure(won({ value: 900000, wonValue: 472000 }), { invoices: [{ customerId: "c1", number: "INV-1" }] }, total);
    expect(f.recorded).toBe(472000);
    expect(f.matches).toBe(true);
  });

  it("falls back to the live value for a win stamped before wonValue existed", () => {
    const f = wonFigure(won({ value: 50000 }), { invoices: [{ customerId: "c1", number: "INV-1" }] }, total);
    expect(f.recorded).toBe(50000);
    expect(f.matches).toBe(false);
  });
});

describe("which document it compares against", () => {
  /* THE SAME LADDER AS backing.ts: a quotation is us asking, an invoice is
     the customer having agreed. */
  it("prefers a tax invoice over everything else", () => {
    const f = wonFigure(won({ wonValue: 1 }), {
      invoices: [{ customerId: "c1", number: "INV-1" }],
      orders: [{ customerId: "c1", number: "SO-1" }],
      proformas: [{ customerId: "c1", number: "PF-1" }],
      quotations: [{ customerId: "c1", number: "QT-1" }],
    }, total);
    expect(f.tier).toBe("invoice");
    expect(f.documented).toBe(472000);
  });

  it("DOES NOT ADD AN ORDER TO THE INVOICE RAISED FROM IT", () => {
    /* One sale, two documents. Totalling both would report ₹9,32,000 of
       revenue where ₹4,72,000 was sold — the screen for finding wrong
       numbers inventing a worse one. */
    const f = wonFigure(won({ wonValue: 472000 }), {
      invoices: [{ customerId: "c1", number: "INV-1" }],
      orders: [{ customerId: "c1", number: "SO-1" }],
    }, total);
    expect(f.documented).toBe(472000);
    expect(f.matches).toBe(true);
  });

  it("uses the order where no invoice has been raised", () => {
    const f = wonFigure(won({ wonValue: 1 }), {
      orders: [{ customerId: "c1", number: "SO-1" }],
      quotations: [{ customerId: "c1", number: "QT-1" }],
    }, total);
    expect(f.tier).toBe("order");
    expect(f.documented).toBe(460000);
  });

  it("falls all the way back to the quotation", () => {
    const f = wonFigure(won({ wonValue: 1 }), { quotations: [{ customerId: "c1", number: "QT-1" }] }, total);
    expect(f.tier).toBe("quotation");
    expect(f.documented).toBe(429992);
  });

  it("ignores another customer's documents", () => {
    const f = wonFigure(won({ wonValue: 50000 }), { invoices: [{ customerId: "c2", number: "INV-1" }] }, total);
    expect(f.tier).toBe("none");
    expect(f.matches).toBe(true);
  });
});

describe("what it refuses to guess", () => {
  /* A CLIENT WITH SEVERAL INVOICES HAS NOT WON ONE DEAL WORTH THEIR SUM,
     and nothing on a document says which win it belonged to. */
  it("offers no figure where there is more than one document at that tier", () => {
    const f = wonFigure(won({ wonValue: 50000 }), {
      invoices: [
        { customerId: "c1", number: "INV-1" },
        { customerId: "c1", number: "INV-2" },
      ],
    }, total);
    expect(f.several).toBe(true);
    expect(f.documented).toBe(0);
    /* Not reported as a mismatch: nobody can act on a number this does not
       have. */
    expect(f.matches).toBe(true);
  });

  it("does not drop to a weaker tier to find a single document", () => {
    /* Two invoices and one quotation is not a reason to report the
       quotation's total as what the deal was worth. */
    const f = wonFigure(won({ wonValue: 50000 }), {
      invoices: [
        { customerId: "c1", number: "INV-1" },
        { customerId: "c1", number: "INV-2" },
      ],
      quotations: [{ customerId: "c1", number: "QT-1" }],
    }, total);
    expect(f.tier).toBe("invoice");
    expect(f.several).toBe(true);
  });

  it("says nothing about a deal with no paperwork at all", () => {
    /* backing.ts already reports those, and as something worse than a
       mismatch — a sale with nothing behind it. */
    const f = wonFigure(won({ wonValue: 50000 }), {}, total);
    expect(f.tier).toBe("none");
    expect(f.matches).toBe(true);
  });

  it("says nothing about a document with nothing priced on it", () => {
    const f = wonFigure(won({ wonValue: 50000 }), { quotations: [{ customerId: "c1", number: "QT-EMPTY" }] }, total);
    expect(f.documented).toBe(0);
    expect(f.matches).toBe(true);
  });
});

describe("the list of deals to look at", () => {
  const ws = {
    invoices: [
      { customerId: "wrong", number: "INV-1" },
      { customerId: "right", number: "INV-1" },
    ],
  };
  const customers = [
    { id: "wrong", stage: "won", wonAt: day(5), wonValue: 50000 },
    { id: "right", stage: "won", wonAt: day(5), wonValue: 472000 },
    { id: "open", stage: "quoted", value: 10 },
  ];

  it("holds only the won deals whose figures disagree", () => {
    const rows = wonMismatches(customers, ws, total);
    expect(rows.map((r) => r.customer.id)).toEqual(["wrong"]);
    expect(rows[0]!.figure.documented).toBe(472000);
  });

  it("leaves out a deal that was won and later lost", () => {
    /* countsAsWon refuses a lost deal, so nothing is over-counted and
       nothing needs correcting. */
    const lost = [{ id: "wrong", stage: "lost", wonAt: day(5), lostAt: day(9), wonValue: 50000 }];
    expect(wonMismatches(lost, ws, total)).toEqual([]);
  });

  it("can be asked only about wins since a date", () => {
    const older = [{ id: "wrong", stage: "won", wonAt: day(2), wonValue: 50000 }];
    expect(wonMismatches(older, ws, total, day(4))).toEqual([]);
    expect(wonMismatches(older, ws, total, day(1))).toHaveLength(1);
  });
});

describe("how it reads on screen", () => {
  it("names both figures and the document", () => {
    const f = wonFigure(won({ wonValue: 50000 }), { invoices: [{ customerId: "c1", number: "INV-1" }] }, total);
    expect(mismatchNote(f, (n) => `₹${n.toLocaleString("en-IN")}`))
      .toBe("Counted as ₹50,000, but INV-1 is ₹4,72,000");
  });

  it("falls back to the kind of document where it has no number", () => {
    const f = wonFigure(won({ wonValue: 50000 }), { invoices: [{ customerId: "c1" }] }, (d) =>
      d.number === undefined ? 472000 : 0);
    expect(mismatchNote(f, (n) => `₹${n}`)).toBe("Counted as ₹50000, but tax invoice is ₹472000");
  });
});
