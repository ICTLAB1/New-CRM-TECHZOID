/**
 * Parity against the v1 implementation.
 *
 * The brief is explicit: where the rewrite and the existing app differ, the
 * existing app is usually right and the difference is a regression. These
 * tests run both implementations over the same inputs and require identical
 * output — so a regression fails the build rather than reaching a customer.
 *
 * The reference module is extracted verbatim from the v1 src/App.jsx by
 * scripts/extract-v1-reference.sh. It is frozen; never edit it by hand.
 */
import { describe, expect, it } from "vitest";
import * as v1 from "../../scripts/v1-reference.mjs";

import { CURRENCIES, getCurrency } from "./currency/currencies";
import { fmtCurrency, fmtCurrencyPdf, fmtMoneyCellPdf, PDF_UNSAFE_CURRENCY_CODES } from "./currency/format";
import { validateGSTIN } from "./gstin/validate";
import { amountInWords, amountInWordsForCurrency } from "./words/amountInWords";
import { buildDocNumber } from "./numbering/docNumber";
import { computeDocument } from "./tax/compute";
import type { TaxType } from "./tax/types";

const AMOUNTS = [
  0, 0.005, 0.5, 1, 7.77, 99.995, 100, 1234.56, 99999.99, 100000, 376656, 1234567.891,
  10000000, 999999999.99, 1e10, -1, -1234.56,
];

const CODES = CURRENCIES.map((c) => c[0]);

describe("currency table", () => {
  it("carries the same 131 entries as v1", () => {
    expect(CODES.length).toBe(131);
    expect(CURRENCIES).toEqual(v1.CURRENCIES);
  });

  it("resolves every code identically, including the INR fallback for unknowns", () => {
    for (const code of [...CODES, "ZZZ", "", "inr"]) {
      expect(getCurrency(code)).toEqual(v1.getCurrency(code));
    }
  });

  it("matches v1 decimal places for the 3-decimal and 0-decimal currencies", () => {
    for (const code of ["KWD", "BHD", "OMR", "JOD", "IQD", "LYD", "TND"]) {
      expect(getCurrency(code).decimals).toBe(3);
    }
    for (const code of [
      "JPY", "KRW", "VND", "IDR", "ISK", "CLP", "PYG", "UGX", "RWF",
      "XAF", "XOF", "XPF", "GNF", "VUV", "DJF", "KMF", "MGA", "BIF",
    ]) {
      // GNF and BIF are named in the brief; assert only the ones v1 ships.
      const row = CURRENCIES.find((c) => c[0] === code);
      if (row) expect(getCurrency(code).decimals).toBe(0);
    }
  });
});

describe("currency formatting parity", () => {
  /* INR now groups in the Indian system — a deliberate, documented deviation
     required by the approved quotation design. Every other currency must
     still match v1 exactly. */
  const NON_INR = CODES.filter((c) => c !== "INR");

  it("fmtCurrency matches v1 for every non-INR currency and amount", () => {
    for (const code of NON_INR) {
      for (const amt of AMOUNTS) {
        expect(fmtCurrency(amt, code)).toBe(v1.fmtCurrency(amt, code));
      }
    }
  });

  it("fmtCurrencyPdf matches v1 for every non-INR currency and amount", () => {
    for (const code of NON_INR) {
      for (const amt of AMOUNTS) {
        expect(fmtCurrencyPdf(amt, code)).toBe(v1.fmtCurrencyPdf(amt, code));
      }
    }
  });

  it("fmtMoneyCellPdf matches v1 for non-INR and never emits a currency prefix", () => {
    for (const code of CODES) {
      for (const amt of AMOUNTS) {
        const out = fmtMoneyCellPdf(amt, code);
        if (code !== "INR") expect(out).toBe(v1.fmtMoneyCellPdf(amt, code));
        expect(out).toMatch(/^-?[0-9,.]+$/);
      }
    }
  });

  describe("deviation: INR groups in lakhs and crores", () => {
    it("v1 grouped INR western-style", () => {
      expect(v1.fmtMoneyCellPdf(2173877.5, "INR")).toBe("2,173,877.50");
    });

    it("groups INR in the Indian system now, as the approved design renders it", () => {
      expect(fmtMoneyCellPdf(2173877.5, "INR")).toBe("21,73,877.50");
      expect(fmtCurrencyPdf(2537979.4, "INR")).toBe("Rs. 25,37,979.40");
    });

    it("leaves every other currency western-grouped", () => {
      expect(fmtMoneyCellPdf(2173877.5, "USD")).toBe("2,173,877.50");
      expect(fmtMoneyCellPdf(2173877.5, "AED")).toBe("2,173,877.50");
    });
  });
});

describe("PDF-unsafe currency symbols", () => {
  it("is the same set as v1", () => {
    expect([...PDF_UNSAFE_CURRENCY_CODES].sort()).toEqual([...v1.PDF_UNSAFE_CURRENCY_CODES].sort());
  });

  it("lists every currency whose symbol leaves the Latin-1 range", () => {
    // jsPDF's built-in fonts corrupt anything above U+00FF. If a currency is
    // added with such a symbol and not listed here, its PDFs render garbage.
    const unlisted = CURRENCIES.filter(([code, symbol]) => {
      const outsideLatin1 = [...symbol].some((ch) => (ch.codePointAt(0) ?? 0) > 0xff);
      return outsideLatin1 && !PDF_UNSAFE_CURRENCY_CODES.has(code);
    }).map(([code, symbol]) => `${code} (${symbol})`);
    expect(unlisted).toEqual([]);
  });

  it("emits only Latin-1 characters for every currency", () => {
    for (const code of CODES) {
      const out = fmtCurrencyPdf(1234.5, code);
      const bad = [...out].filter((ch) => (ch.codePointAt(0) ?? 0) > 0xff);
      expect(bad, `${code} produced non-Latin-1 ${JSON.stringify(bad)}`).toEqual([]);
    }
  });

  it("falls back to 'Rs. ' for INR and to the bare code otherwise", () => {
    expect(fmtCurrencyPdf(100, "INR")).toBe("Rs. 100.00");
    expect(fmtCurrencyPdf(100, "PKR")).toBe("PKR 100.00");
    expect(fmtCurrencyPdf(100, "MUR")).toBe("MUR 100.00");
    // PKR and MUR share the ₨ symbol — keying by code is what keeps them apart.
    expect(getCurrency("PKR").symbol).toBe(getCurrency("MUR").symbol);
  });
});

describe("amount in words parity", () => {
  /** The one documented deviation: v1 printed the literal word "undefined"
   *  when the minor unit rounded up to a full unit (99.995 -> 100 paise).
   *  Those amounts are asserted separately, below. */
  const minorCarries = (amt: number): boolean => {
    const abs = Math.abs(amt);
    return Math.round((abs - Math.floor(abs)) * 100) >= 100;
  };

  it("matches v1 across scales and currencies", () => {
    for (const amt of AMOUNTS.filter((a) => !minorCarries(a))) {
      expect(amountInWords(amt)).toBe(v1.amountInWords(amt));
      for (const code of ["INR", "USD", "EUR", "AED", "JPY", "KWD", "KRW", "GBP"]) {
        expect(amountInWordsForCurrency(amt, code)).toBe(v1.amountInWordsForCurrency(amt, code));
      }
    }
  });

  describe("deviation: minor unit rounding up to a whole unit", () => {
    it("v1 printed the word 'undefined' on the document", () => {
      expect(v1.amountInWords(99.995)).toContain("undefined");
    });

    it("carries into the whole unit instead", () => {
      expect(amountInWords(99.995)).toBe("One Hundred Rupees Only");
      expect(amountInWordsForCurrency(99.995, "USD")).toBe("One Hundred US Dollar Only");
    });

    it("never emits 'undefined' for any amount", () => {
      for (let cents = 0; cents < 1000; cents++) {
        const amt = cents / 1000;
        expect(amountInWords(amt)).not.toContain("undefined");
        expect(amountInWordsForCurrency(amt, "USD")).not.toContain("undefined");
      }
    });
  });

  it("uses Lakh/Crore for INR and Million/Billion otherwise", () => {
    expect(amountInWordsForCurrency(12500000, "INR")).toContain("Crore");
    expect(amountInWordsForCurrency(12500000, "USD")).toContain("Million");
    expect(amountInWordsForCurrency(12500000, "USD")).not.toContain("Crore");
  });

  it("names the currency, not just the number", () => {
    expect(amountInWordsForCurrency(1, "USD")).toBe("One US Dollar Only");
    expect(amountInWords(1)).toBe("One Rupees Only");
  });

  it("omits a minor unit for zero-decimal currencies", () => {
    expect(amountInWordsForCurrency(1000, "JPY")).toBe("One Thousand Japanese Yen Only");
  });
});

describe("GSTIN parity", () => {
  const SAMPLES = [
    "", "  ", "07AAACT2727Q1Z", "07AAACT2727Q1ZSX", "0#AAACT2727Q1ZS",
    "07AAACT2727Q1ZS", "27AAPFU0939F1ZV", "29AAGCB7383J1ZN", "07AAGCB7383J1ZN",
    "24AAACC1206D1ZM", "36AAACT2727Q1ZZ", "07aagcb7383j1zn",
  ];

  it("agrees with v1 on every sample, valid or not", () => {
    for (const s of SAMPLES) {
      expect(validateGSTIN(s), s).toEqual(v1.validateGSTIN(s));
    }
  });

  it("rejects a transposed-digit GSTIN that a regex would pass", () => {
    const good = "27AAPFU0939F1ZV";
    expect(validateGSTIN(good).valid).toBe(true);
    const transposed = "72AAPFU0939F1ZV";
    const r = validateGSTIN(transposed);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("checksum");
  });

  it("decodes the state and PAN from a valid GSTIN", () => {
    const r = validateGSTIN("27AAPFU0939F1ZV");
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.stateCode).toBe("27");
      expect(r.stateName).toBe("Maharashtra");
      expect(r.pan).toBe("AAPFU0939F");
    }
  });

  it("distinguishes incomplete from malformed, so the UI can stay quiet while typing", () => {
    const partial = validateGSTIN("27AAPFU");
    expect(partial.valid).toBe(false);
    if (!partial.valid) expect(partial.reason).toBe("incomplete");
  });
});

describe("document numbering parity", () => {
  it("matches v1 for a range of prefixes and sequences", () => {
    for (const prefix of ["TZ/QT", "TZ/PI", "SO", "DC"]) {
      for (const seq of [0, 1, 9, 10, 999, 1000, 12345]) {
        expect(buildDocNumber(prefix, seq)).toBe(v1.buildDocNumber(prefix, seq));
      }
    }
  });

  it("pads to four digits and carries the Indian financial year", () => {
    expect(buildDocNumber("TZ/QT", 7, new Date("2026-05-10T00:00:00"))).toBe("TZ/QT/2627/0007");
    // January falls in the previous financial year.
    expect(buildDocNumber("TZ/QT", 7, new Date("2026-01-10T00:00:00"))).toBe("TZ/QT/2526/0007");
  });
});

describe("document totals parity", () => {
  // A deterministic pseudo-random walk over the input space: quantities,
  // rates, discounts, tax rates, regimes, states and round-off.
  let seed = 1337;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;

  const TAX_TYPES: readonly TaxType[] = ["gst", "vat", "sales_tax", "none"];
  const STATES = ["Delhi", "Maharashtra", "Karnataka", ""];
  const RATES = [0, 5, 12, 18, 28];

  it("matches v1 over 500 randomised documents", () => {
    for (let n = 0; n < 500; n++) {
      const items = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) => ({
        id: "i" + i,
        qty: Math.floor(rnd() * 50),
        rate: Math.round(rnd() * 500000) / 100,
        disc: Math.round(rnd() * 10000) / 100,
        gst: pick(RATES),
      }));
      const doc = {
        items,
        taxType: pick(TAX_TYPES),
        billState: pick(STATES),
        roundOff: rnd() > 0.5,
      };
      const sellerState = pick(STATES);
      const mine = computeDocument(doc, sellerState);
      const theirs = v1.computeQuote(doc, sellerState);
      expect(mine, JSON.stringify(doc)).toEqual(theirs);
    }
  });
});
