import { describe, expect, it } from "vitest";
import {
  CURRENCY_BY_COUNTRY, DEFAULT_INTERNATIONAL_CURRENCY, currencyForCountry,
} from "./currencyForCountry";
import { COUNTRIES } from "./countries";
import { CURRENCIES, minorUnitName } from "../currency/currencies";
import { amountInWordsForCurrency } from "../words/amountInWords";

/**
 * What a customer abroad gets quoted in.
 *
 * The bug: a customer outside India was saved with no currency, and
 * normalisation filled the blank with INR. A quotation to Dubai came out
 * priced in rupees without anybody making a mistake.
 */

const SUPPORTED = new Set(CURRENCIES.map((c) => c[0]));

describe("every country maps to a currency this CRM can render", () => {
  /* The real guard. A country pointing at a currency with no symbol and no
     rounding rule would print a quotation with a blank where the money goes,
     and it would only ever be noticed by the customer. */
  it("names only supported currencies", () => {
    const unsupported = Object.entries(CURRENCY_BY_COUNTRY)
      .filter(([, code]) => !SUPPORTED.has(code))
      .map(([country, code]) => `${country} -> ${code}`);
    expect(unsupported).toEqual([]);
  });

  it("covers every country the forms offer", () => {
    const missing = COUNTRIES
      .filter((c) => c !== "Other")
      .filter((c) => !(c in CURRENCY_BY_COUNTRY));
    expect(missing).toEqual([]);
  });

  it("has an answer for the ones that are not countries", () => {
    /* "Other" is in the list on purpose, and a blank arrives from an older
       record. Neither may produce undefined. */
    expect(currencyForCountry("Other")).toBe(DEFAULT_INTERNATIONAL_CURRENCY);
    expect(currencyForCountry("")).toBe(DEFAULT_INTERNATIONAL_CURRENCY);
    expect(currencyForCountry(null)).toBe(DEFAULT_INTERNATIONAL_CURRENCY);
    expect(currencyForCountry(undefined)).toBe(DEFAULT_INTERNATIONAL_CURRENCY);
    expect(currencyForCountry("Narnia")).toBe(DEFAULT_INTERNATIONAL_CURRENCY);
  });
});

describe("the ones this business actually sells to", () => {
  it("quotes India in rupees and the UAE in dirhams", () => {
    /* The two that matter most here: an Indian reseller with a UAE office. */
    expect(currencyForCountry("India")).toBe("INR");
    expect(currencyForCountry("United Arab Emirates")).toBe("AED");
  });

  it("gets the rest of the Gulf right", () => {
    expect(currencyForCountry("Saudi Arabia")).toBe("SAR");
    expect(currencyForCountry("Qatar")).toBe("QAR");
    expect(currencyForCountry("Kuwait")).toBe("KWD");
    expect(currencyForCountry("Oman")).toBe("OMR");
    expect(currencyForCountry("Bahrain")).toBe("BHD");
  });

  it("uses the euro across the eurozone rather than a retired currency", () => {
    for (const c of ["Germany", "France", "Ireland", "Netherlands", "Spain", "Italy", "Croatia"]) {
      expect(currencyForCountry(c), c).toBe("EUR");
    }
  });

  it("handles the neighbours whose own currency this CRM cannot print", () => {
    /* Named one that is genuinely used there rather than inventing a symbol
       and a rounding rule. */
    expect(currencyForCountry("Bhutan")).toBe("INR");
    expect(currencyForCountry("Brunei")).toBe("SGD");
    expect(currencyForCountry("Lesotho")).toBe("ZAR");
  });

  it("keeps three-decimal currencies three-decimal", () => {
    /* A dinar has 1000 fils. Rounding it like a dollar loses money on every
       line, which is the kind of error nobody spots until a reconciliation. */
    for (const code of ["KWD", "BHD", "OMR", "JOD"]) {
      const row = CURRENCIES.find((c) => c[0] === code);
      expect(row?.[3], code).toBe(3);
    }
  });
});

describe("the amount in words on a foreign invoice", () => {
  it("names the currency's own small change, not cents", () => {
    /* "…and Fifty Cents Only" on an invoice to Dubai is wrong in a way a
       Gulf customer notices at once: a dirham has fils. Every currency used
       to say Cents because the rupee was the only one anybody had thought
       about. */
    expect(amountInWordsForCurrency(3637.5, "AED")).toMatch(/Fils/);
    expect(amountInWordsForCurrency(3637.5, "AED")).not.toMatch(/Cents/);
    expect(amountInWordsForCurrency(120.25, "GBP")).toMatch(/Pence/);
    expect(amountInWordsForCurrency(99.99, "SAR")).toMatch(/Halalas/);
    expect(amountInWordsForCurrency(10.5, "PKR")).toMatch(/Paisa/);
  });

  it("still says rupees and paise for India", () => {
    expect(amountInWordsForCurrency(99.5, "INR")).toMatch(/Paise/);
  });

  it("falls back to cents for a currency nobody has named", () => {
    expect(minorUnitName("XDR")).toBe("Cents");
  });

  it("says nothing about small change for a currency that has none", () => {
    /* The yen has no subunit in practice, and "and Zero Cents" on an invoice
       to Tokyo reads as a bug. */
    expect(amountInWordsForCurrency(1500, "JPY")).not.toMatch(/Cents|Sen/);
  });
});
