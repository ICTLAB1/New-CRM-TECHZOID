import { describe, expect, it } from "vitest";
import { compareDocuments, numberOf, sortDocuments } from "./order";

const doc = (date: string, number: string, createdAt = 0) => ({ date, number, createdAt });

describe("the sequence at the end of a document number", () => {
  it("reads the run of digits that actually moves", () => {
    expect(numberOf({ number: "TZ/QT/2627/0117" })).toBe(117);
    expect(numberOf({ number: "TZ/Q/26-27/0047" })).toBe(47);
    expect(numberOf({ number: "INV-2026-9" })).toBe(9);
  });

  it("says so when there is no number to read", () => {
    expect(numberOf({ number: "" })).toBe(-1);
    expect(numberOf({ number: "DRAFT" })).toBe(-1);
    expect(numberOf({ number: undefined as unknown as string })).toBe(-1);
  });
});

describe("the order documents are listed in", () => {
  it("puts the newest date first", () => {
    const list = [doc("2026-11-01", "A/1"), doc("2026-11-13", "A/2"), doc("2026-10-20", "A/3")];
    expect(sortDocuments(list).map((d) => d.date)).toEqual(["2026-11-13", "2026-11-01", "2026-10-20"]);
  });

  it("orders one day's documents by number, counting rather than spelling", () => {
    // Compared as text, "0099" would come after "0117" only because both
    // happen to be four digits. A series that reaches five loses even that.
    const list = [
      doc("2026-11-13", "TZ/QT/2627/0099"),
      doc("2026-11-13", "TZ/QT/2627/0117"),
      doc("2026-11-13", "TZ/QT/2627/1002"),
    ];
    expect(sortDocuments(list).map((d) => numberOf(d))).toEqual([1002, 117, 99]);
  });

  it("does not let five digits upset four", () => {
    const list = [doc("2026-11-13", "TZ/QT/2627/9"), doc("2026-11-13", "TZ/QT/2627/10")];
    expect(sortDocuments(list).map((d) => numberOf(d))).toEqual([10, 9]);
  });

  it("keeps two drafts raised the same morning in a stable order", () => {
    // Neither has a number yet; the later one is the one you were just
    // working on, so it comes first.
    const list = [doc("2026-11-13", "", 1000), doc("2026-11-13", "", 2000)];
    expect(sortDocuments(list).map((d) => d.createdAt)).toEqual([2000, 1000]);
  });

  it("sorts by the date on the document, not the day the row was written", () => {
    // A back-dated document belongs where its date says, because the date
    // is the column somebody is reading.
    const backdated = doc("2026-09-01", "A/99", 9_999_999);
    const ordinary = doc("2026-11-13", "A/1", 1);
    expect(sortDocuments([backdated, ordinary])[0]).toBe(ordinary);
  });

  it("leaves the caller's array alone", () => {
    const list = [doc("2026-10-01", "A/1"), doc("2026-11-01", "A/2")];
    const before = [...list];
    sortDocuments(list);
    expect(list).toEqual(before);
  });

  it("copes with documents missing a date entirely", () => {
    const list = [doc("", "A/1"), doc("2026-11-13", "A/2")];
    expect(() => sortDocuments(list)).not.toThrow();
    expect(sortDocuments(list)[0]?.date).toBe("2026-11-13");
  });

  it("is a total order, so sorting twice changes nothing", () => {
    const list = [
      doc("2026-11-13", "A/2", 5), doc("2026-11-13", "A/1", 7),
      doc("2026-11-12", "A/9", 1), doc("2026-11-13", "A/2", 3),
    ];
    const once = sortDocuments(list);
    expect(sortDocuments(once)).toEqual(once);
    expect(compareDocuments(once[0]!, once[0]!)).toBe(0);
  });
});
