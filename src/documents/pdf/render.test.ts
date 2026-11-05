import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { renderDocumentPdf } from "./render";
import { buildDocumentModel } from "../../domain/documents/model";
import { DEFAULT_DOC_TEMPLATE } from "../../domain/documents/template";
import { computeDocument } from "../../domain/tax/compute";

/**
 * WHAT IS ACTUALLY ON THE PAGE.
 *
 * The bug this exists to stop: a proforma printed neither its terms nor its
 * payment instructions for months, while every test passed. The model built
 * both — and was asserted to have built both — and no renderer ever read
 * them. Asking the model what it produced could not have caught it. Only
 * asking the PDF could.
 *
 * jsPDF compresses its content streams, so they are inflated here. It is a
 * dozen lines and it is the difference between testing a page and testing
 * an intention.
 */

/** Every text run in the rendered PDF, in one string. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  let out = "";
  let at = 0;
  for (;;) {
    const start = raw.indexOf("stream", at);
    if (start < 0) break;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    /* Past "stream" and its line ending. */
    let from = start + 6;
    while (raw[from] === 0x0d || raw[from] === 0x0a) from += 1;
    try {
      out += inflateSync(raw.subarray(from, end)).toString("latin1");
    } catch {
      out += raw.subarray(from, end).toString("latin1");
    }
    at = end + 9;
  }
  /* jsPDF writes text as (escaped literal) Tj — unescape the few that
     matter so a clause with a bracket in it still matches. */
  return out.replace(/\\([()\\])/g, "$1");
}

const TERMS = [
  "Prices are exclusive of applicable GST unless stated otherwise.",
  "All disputes shall be subject to the jurisdiction of the courts at New Delhi.",
];

const doc = {
  number: "TZ/PI/2026-27/0007", date: "2026-11-05", validUntil: "2026-11-20",
  billName: "ABC Private Limited", billAddress: "123, Business Park, Noida",
  billState: "Uttar Pradesh", billCountry: "India", billGstin: "09AABCA1234A1Z5",
  taxType: "gst", currency: "INR", terms: TERMS,
  items: [{ id: "1", desc: "Microsoft 365 Business Standard", qty: 25, unit: "lic", rate: 12744, gst: 18 }],
  advancePercent: 100,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const settings = {
  company: { name: "TechZoid Technologies Private Limited", gstin: "07AAGCT9158R1Z0" },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const render = (docType: "quotation" | "proforma" | "invoice") => {
  const totals = computeDocument(doc, "Delhi");
  const model = buildDocumentModel({
    doc, settings, totals, docType, template: DEFAULT_DOC_TEMPLATE,
    bankAccount: { name: "HDFC Bank Ltd", accountName: "TechZoid", account: "50200045678901", ifsc: "HDFC0000123" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return pdfText(new Uint8Array(renderDocumentPdf({ model, rows: totals.rows }).output("arraybuffer")));
};

describe("what the PDF actually carries", () => {
  it("prints the terms on a proforma invoice", () => {
    /* THE REGRESSION, in one assertion. */
    const text = render("proforma");
    for (const clause of TERMS) expect(text).toContain(clause);
    expect(text).toContain("TERMS & CONDITIONS");
  });

  it("prints a proforma's payment instructions too", () => {
    /* They were lost by the same mechanism, and they are the point of a
       proforma: it exists to be paid against. */
    expect(render("proforma")).toContain("Kindly make the payment as per the bank details mentioned.");
  });

  it("keeps the bank details on a proforma, which is what its terms column is for", () => {
    /* The reason a proforma's terms print below rather than beside the
       summary. If they ever move back into that column, this fails. */
    const text = render("proforma");
    expect(text).toContain("50200045678901");
    expect(text).toContain("HDFC0000123");
  });

  it("still prints the terms on a quotation, in its own column", () => {
    const text = render("quotation");
    for (const clause of TERMS) expect(text).toContain(clause);
  });

  it("prints the terms on a tax invoice", () => {
    for (const clause of TERMS) expect(render("invoice")).toContain(clause);
  });
});
