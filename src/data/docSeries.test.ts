import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { docSeries } from "./docNumber";
import { OBJ_TYPE } from "../domain/documents/objType";
import type { DocType } from "../domain/documents/model";

/**
 * THE INVOICE SERIES BUG, AND WHY THIS FILE EXISTS.
 *
 * Every tax invoice raised from a quotation came out as INV/2026-27/0001.
 * The quotations screen held the object type, the counter key and the
 * prefix as three constants fixed to its OWN document type, so the two
 * paths that raise a document of a DIFFERENT type — a tax invoice and a
 * proforma, both started from a quotation — had no series to draw from and
 * drew from none at all. Three invoices carrying the same number reached
 * the live workspace.
 *
 * Two guards here: the mapping is now a function of the type and is
 * exhaustive, and the two raise paths are still wired through the
 * allocator.
 */

const TYPES: DocType[] = ["quotation", "proforma", "invoice", "purchase_order"];

describe("docSeries", () => {
  it("gives every document type its own object type, counter and prefix", () => {
    const seen = TYPES.map((t) => docSeries(t, {}));
    expect(new Set(seen.map((s) => s.objType)).size).toBe(TYPES.length);
    expect(new Set(seen.map((s) => s.seqKey)).size).toBe(TYPES.length);
    expect(new Set(seen.map((s) => s.prefix)).size).toBe(TYPES.length);
  });

  it("draws a tax invoice from the invoice series, not the quotation one", () => {
    const invoice = docSeries("invoice", { invoicePrefix: "TZ/INV", quotePrefix: "TZ/QT" });
    expect(invoice.objType).toBe(OBJ_TYPE.invoice);
    expect(invoice.seqKey).toBe("invoiceSeq");
    expect(invoice.prefix).toBe("TZ/INV");
  });

  it("draws a proforma from the proforma series", () => {
    const pf = docSeries("proforma", { proformaPrefix: "TZ/PI", quotePrefix: "TZ/QT" });
    expect(pf.objType).toBe(OBJ_TYPE.proforma);
    expect(pf.seqKey).toBe("proformaSeq");
    expect(pf.prefix).toBe("TZ/PI");
  });

  it("falls back to a neutral prefix rather than another company's", () => {
    /* Never "TZ/..." — a second company's first invoice must not go out
       carrying the first company's initials. */
    for (const t of TYPES) expect(docSeries(t, {}).prefix).not.toMatch(/TZ/);
  });
});

describe("raising a document of another type", () => {
  const src = readFileSync(
    new URL("../features/quotations/QuotationsScreen.tsx", import.meta.url),
    "utf8",
  );

  /** The body of a named arrow function in that file. */
  const bodyOf = (name: string): string => {
    const at = src.indexOf(`const ${name} = `);
    expect(at, `${name} not found`).toBeGreaterThan(-1);
    const next = src.indexOf("\n  const ", at + 1);
    return src.slice(at, next === -1 ? src.length : next);
  };

  for (const [fn, type] of [["raiseInvoice", '"invoice"'], ["raiseProforma", '"proforma"']] as const) {
    it(`${fn} takes a number out of the ${type} series before filing it`, () => {
      const body = bodyOf(fn);
      /* Without this the document is filed carrying the preview number
         that its draft was built with, and every one is identical. */
      expect(body).toContain("allocateNumber(");
      expect(body).toContain(type);
    });
  }
});
