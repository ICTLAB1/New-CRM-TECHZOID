import { describe, expect, it } from "vitest";
import { hexToRgb, pdfSafeText } from "./text";

describe("pdfSafeText", () => {
  it("degrades typographic punctuation to ASCII", () => {
    expect(pdfSafeText("‘a’ “b” c… d–e f—g")).toBe("'a' \"b\" c... d-e f-g");
  });

  it("turns bullets into hyphens rather than dropping them", () => {
    expect(pdfSafeText("• point")).toBe("- point");
  });

  it("strips anything above Latin-1", () => {
    expect(pdfSafeText("Total ₹100")).toBe("Total 100");
    expect(pdfSafeText("emoji 🎉 here")).toBe("emoji  here");
    expect(pdfSafeText("日本語")).toBe("");
  });

  it("keeps Latin-1 accents, which the built-in fonts do render", () => {
    expect(pdfSafeText("Zürich café naïve")).toBe("Zürich café naïve");
  });

  it("maps over arrays, as splitTextToSize returns", () => {
    expect(pdfSafeText(["a’b", "c…"])).toEqual(["a'b", "c..."]);
  });

  it("never emits a character jsPDF would corrupt", () => {
    const messy = "₹ € ¥ ₨ ₩ ₽ ｦ 🎉 — ‘ ’ “ ” … • ●";
    const out = pdfSafeText(messy);
    expect([...out].every((ch) => (ch.codePointAt(0) ?? 0) <= 0xff)).toBe(true);
  });
});

describe("hexToRgb", () => {
  it("parses with and without the hash", () => {
    expect(hexToRgb("#2563EB")).toEqual([37, 99, 235]);
    expect(hexToRgb("2563eb")).toEqual([37, 99, 235]);
  });

  it("falls back to near-black for anything unparseable", () => {
    expect(hexToRgb("")).toEqual([26, 26, 26]);
    expect(hexToRgb(null)).toEqual([26, 26, 26]);
    expect(hexToRgb("rebeccapurple")).toEqual([26, 26, 26]);
  });
});
