import { describe, expect, it } from "vitest";
import { daysLeft, dueForRenewal, expiryLabel, expiryTone, valueAtRisk, type Subscription } from "./expiry";

const NOW = new Date("2026-08-24T10:00:00");
const sub = (o: Partial<Subscription> = {}): Subscription => ({ id: "s1", ownerId: "u1", ...o });

describe("days left", () => {
  it("counts today as zero", () => {
    expect(daysLeft(sub({ expiryDate: "2026-08-24" }), NOW)).toBe(0);
  });

  it("counts forward and back in whole calendar days", () => {
    // v1 measured to 23:59 on the expiry date from the current clock, so a
    // subscription expiring today read "1 day left" all day.
    expect(daysLeft(sub({ expiryDate: "2026-09-23" }), NOW)).toBe(30);
    expect(daysLeft(sub({ expiryDate: "2026-08-14" }), NOW)).toBe(-10);
  });

  it("gives the same answer whatever time of day it is asked", () => {
    for (const hour of ["00:01", "09:30", "17:45", "23:58"]) {
      expect(daysLeft(sub({ expiryDate: "2026-08-24" }), new Date(`2026-08-24T${hour}:00`)), hour).toBe(0);
    }
  });

  it("never expires without an expiry date", () => {
    // A perpetual licence is the usual case, and must not read as overdue.
    expect(daysLeft(sub({}), NOW)).toBe(Infinity);
    expect(daysLeft(sub({ expiryDate: "" }), NOW)).toBe(Infinity);
  });

  it("treats an unparseable date as no expiry rather than as expired", () => {
    expect(daysLeft(sub({ expiryDate: "not a date" }), NOW)).toBe(Infinity);
  });
});

describe("urgency", () => {
  it("is red inside a week, amber inside a month, green beyond", () => {
    expect(expiryTone(sub({ expiryDate: "2026-08-28" }), NOW)).toBe("bad");
    expect(expiryTone(sub({ expiryDate: "2026-09-10" }), NOW)).toBe("warn");
    expect(expiryTone(sub({ expiryDate: "2026-12-01" }), NOW)).toBe("good");
  });

  it("lets an explicit status win over the date", () => {
    // A cancelled or renewed subscription is not "expiring in four days".
    const soon = { expiryDate: "2026-08-26" };
    expect(expiryTone(sub({ ...soon, status: "Cancelled" }), NOW)).toBe("neutral");
    expect(expiryTone(sub({ ...soon, status: "Renewed" }), NOW)).toBe("good");
    expect(expiryTone(sub({ ...soon, status: "Perpetual License" }), NOW)).toBe("accent");
  });

  it("treats an already-lapsed licence as overdue, not as history", () => {
    // The customer is unlicensed today. v1 greyed this out, which
    // contradicted the sort putting it first.
    expect(expiryTone(sub({ expiryDate: "2026-01-01" }), NOW)).toBe("bad");
  });
});

describe("labels", () => {
  it("phrases the common cases", () => {
    expect(expiryLabel(sub({ expiryDate: "2026-08-24" }), NOW)).toBe("Expires today");
    expect(expiryLabel(sub({ expiryDate: "2026-08-25" }), NOW)).toBe("1 day left");
    expect(expiryLabel(sub({ expiryDate: "2026-09-03" }), NOW)).toBe("10 days left");
    expect(expiryLabel(sub({ expiryDate: "2026-08-23" }), NOW)).toBe("Expired 1 day ago");
    expect(expiryLabel(sub({ expiryDate: "2026-08-14" }), NOW)).toBe("Expired 10 days ago");
  });

  it("says so plainly when there is no expiry date", () => {
    expect(expiryLabel(sub({}), NOW)).toBe("No expiry date");
  });

  it("repeats an explicit status instead of a countdown", () => {
    expect(expiryLabel(sub({ expiryDate: "2026-08-26", status: "Renewed" }), NOW)).toBe("Renewed");
  });
});

describe("what is due", () => {
  const subs = [
    sub({ id: "a", expiryDate: "2026-08-26", sellPrice: 100000 }),
    sub({ id: "b", expiryDate: "2026-09-20", sellPrice: 50000 }),
    sub({ id: "c", expiryDate: "2026-12-01", sellPrice: 900000 }),
    sub({ id: "d", expiryDate: "2026-08-25", sellPrice: 25000, status: "Cancelled" }),
    sub({ id: "e", expiryDate: "2026-08-25", sellPrice: 30000, status: "Renewed" }),
    sub({ id: "f", sellPrice: 400000, status: "Perpetual License" }),
    sub({ id: "g", expiryDate: "2026-08-01", sellPrice: 60000 }),
    sub({ id: "h", expiryDate: "2026-08-20", sellPrice: 70000, renewalStage: "Lost" }),
  ];

  it("lists what expires inside the window, soonest first", () => {
    expect(dueForRenewal(subs, 30, NOW).map((s) => s.id)).toEqual(["g", "a", "b"]);
  });

  it("includes what has already lapsed — that is the most urgent of all", () => {
    expect(dueForRenewal(subs, 30, NOW).map((s) => s.id)).toContain("g");
  });

  it("leaves out cancelled, renewed and perpetual records", () => {
    const ids = dueForRenewal(subs, 30, NOW).map((s) => s.id);
    expect(ids).not.toContain("d");
    expect(ids).not.toContain("e");
    expect(ids).not.toContain("f");
  });

  it("leaves out a renewal someone has marked Lost", () => {
    // Otherwise the due list stops being a to-do.
    expect(dueForRenewal(subs, 30, NOW).map((s) => s.id)).not.toContain("h");
  });

  it("respects the window", () => {
    expect(dueForRenewal(subs, 7, NOW).map((s) => s.id)).toEqual(["g", "a"]);
    expect(dueForRenewal(subs, 200, NOW).map((s) => s.id)).toContain("c");
  });

  it("totals the value at risk", () => {
    expect(valueAtRisk(subs, 30, NOW)).toBe(210000);
  });

  it("reports zero at risk when nothing is due", () => {
    expect(valueAtRisk([], 30, NOW)).toBe(0);
  });
});
