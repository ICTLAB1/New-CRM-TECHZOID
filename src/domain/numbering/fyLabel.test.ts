import { describe, expect, it } from "vitest";
import { buildDocNumber, fyLabel } from "./docNumber";

/**
 * The financial year on a document number.
 *
 * The bug behind migration 032 was not in this function — the label was
 * always right. It was that the counter behind it never reset, so the label
 * said one thing and the sequence said another. These pin the label so that
 * when the series is keyed on it, both halves agree.
 */

describe("the Indian financial year", () => {
  it("runs 1 April to 31 March", () => {
    expect(fyLabel(new Date(2026, 3, 1))).toBe("2026-27");
    expect(fyLabel(new Date(2027, 2, 31))).toBe("2026-27");
    /* One day later is a different year, and a different series. */
    expect(fyLabel(new Date(2027, 3, 1))).toBe("2027-28");
  });

  it("puts a month before April in the year that started the previous April", () => {
    expect(fyLabel(new Date(2027, 0, 15))).toBe("2026-27");
    expect(fyLabel(new Date(2026, 2, 31))).toBe("2025-26");
  });

  it("writes the second year as two digits, padded", () => {
    /* 2009-10, not 2009-1. */
    expect(fyLabel(new Date(2009, 5, 1))).toBe("2009-10");
    expect(fyLabel(new Date(2099, 5, 1))).toBe("2099-00");
  });

  it("is the same label the document number prints", () => {
    /* One function, two callers — the series and the label cannot drift. */
    const at = new Date(2027, 3, 1);
    expect(buildDocNumber("TZ/QT", 1, at)).toBe(`TZ/QT/${fyLabel(at)}/0001`);
  });
});

describe("the number a new financial year opens with", () => {
  it("is 0001, which is the whole point of the change", () => {
    /* Before migration 032 the counter carried on: the first quotation of
       2027-28 would have printed as 0025 because the 2026-27 series had
       reached 24. The label said new year, the number said carry on. */
    expect(buildDocNumber("TZ/QT", 1, new Date(2027, 3, 1))).toBe("TZ/QT/2027-28/0001");
    expect(buildDocNumber("TZ/QT", 25, new Date(2027, 2, 31))).toBe("TZ/QT/2026-27/0025");
  });

  it("pads to four digits and does not truncate beyond them", () => {
    expect(buildDocNumber("TZ/INV", 7, new Date(2026, 5, 1))).toBe("TZ/INV/2026-27/0007");
    expect(buildDocNumber("TZ/INV", 12345, new Date(2026, 5, 1))).toBe("TZ/INV/2026-27/12345");
  });
});
