import { describe, expect, it } from "vitest";
import { addDays, fmtDate, fmtDateShort, isOverdue } from "./dates";

describe("date formatting", () => {
  it("gives tables the year", () => {
    expect(fmtDate("2026-08-21")).toBe("21 Aug 2026");
  });

  it("gives cards the day and month only", () => {
    expect(fmtDateShort("2026-08-21")).toBe("21 Aug");
  });

  it("shows an em dash for a missing date rather than 'Invalid Date'", () => {
    for (const fn of [fmtDate, fmtDateShort]) {
      expect(fn(null)).toBe("—");
      expect(fn(undefined)).toBe("—");
      expect(fn("")).toBe("—");
    }
  });

  it("returns unparseable input unchanged instead of inventing a date", () => {
    expect(fmtDate("not a date")).toBe("not a date");
  });

  it("reads a date as local, not UTC — a follow-up must not shift a day", () => {
    expect(fmtDate("2026-01-01")).toBe("01 Jan 2026");
  });
});

describe("overdue", () => {
  it("is true strictly before today", () => {
    expect(isOverdue("2026-08-20", "2026-08-23")).toBe(true);
  });

  it("is false on the day itself", () => {
    expect(isOverdue("2026-08-23", "2026-08-23")).toBe(false);
  });

  it("is false for a future date and for no date at all", () => {
    expect(isOverdue("2026-09-01", "2026-08-23")).toBe(false);
    expect(isOverdue(null, "2026-08-23")).toBe(false);
    expect(isOverdue("", "2026-08-23")).toBe(false);
  });
});

describe("addDays", () => {
  it("moves forward and back", () => {
    expect(addDays("2026-08-23", 15)).toBe("2026-09-07");
    expect(addDays("2026-08-23", -1)).toBe("2026-08-22");
  });

  it("crosses month and year boundaries", () => {
    expect(addDays("2026-12-28", 5)).toBe("2027-01-02");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });

  it("handles a leap year", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("returns unparseable input unchanged", () => {
    expect(addDays("nonsense", 5)).toBe("nonsense");
  });
});
