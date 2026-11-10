import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { renderDocumentPdf } from "./render";
import { buildDocumentModel } from "../../domain/documents/model";
import { DEFAULT_DOC_TEMPLATE } from "../../domain/documents/template";
import { computeDocument } from "../../domain/tax/compute";
import { scanMatrix } from "../../domain/documents/scanCode";

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

/** The inflated content streams, exactly as written — escapes intact. */
function pdfStreams(bytes: Uint8Array): string {
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
  return out;
}

/** jsPDF writes text as (escaped literal) Tj — unescape the few that
 *  matter so a clause with a bracket in it still matches. */
const unescapePdf = (text: string): string => text.replace(/\\([()\\])/g, "$1");

/** Every text run in the rendered PDF, in one string. */
function pdfText(bytes: Uint8Array): string {
  return unescapePdf(pdfStreams(bytes));
}

/** Every text run in order, as drawn. Joined with single spaces this
 *  reconstructs a paragraph, which is how the hand-rolled wrap on the
 *  terms page is checked for dropped or repeated words. */
function pdfRuns(bytes: Uint8Array): string[] {
  /* Read BEFORE unescaping: a clause containing "(PO)" is written with
     its brackets escaped, and unescaping first would end the literal
     early and silently drop the rest of the clause. */
  const stream = pdfStreams(bytes);
  const runs: string[] = [];
  const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
  for (let m = re.exec(stream); m; m = re.exec(stream)) runs.push(unescapePdf(m[1]!));
  return runs;
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

const modelFor = (docType: "quotation" | "proforma" | "invoice" | "purchase_order") => {
  const totals = computeDocument(doc, "Delhi");
  const model = buildDocumentModel({
    doc, settings, totals, docType, template: DEFAULT_DOC_TEMPLATE,
    bankAccount: { name: "HDFC Bank Ltd", accountName: "TechZoid", account: "50200045678901", ifsc: "HDFC0000123" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { model, rows: totals.rows };
};

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

describe("the quotation's terms and acceptance page", () => {
  it("prints the clauses, under their own heading", () => {
    const text = render("quotation");
    expect(text).toContain("TERMS & CONDITIONS");
    for (const clause of TERMS) expect(text).toContain(clause);
  });

  it("names what is being accepted, on the page that is signed", () => {
    /* A signed page gets detached, scanned and sent back on its own, so it
       has to mean something without the rest of the quotation. */
    const text = render("quotation");
    expect(text).toContain("ACCEPTANCE OF QUOTATION");
    expect(text).toContain("TZ/PI/2026-27/0007");
    expect(text).toContain("ABC Private Limited");
    expect(text).toContain("Authorised Signatory");
  });

  it("gives the amount in figures and in words", () => {
    /* A signature against a figure alone is the easiest thing in the world
       to dispute. */
    const text = render("quotation");
    expect(text).toMatch(/Rupees Only|rupees only/i);
  });

  it("takes a page of its own", () => {
    /* One page more than the same document without it. */
    const { model, rows } = modelFor("quotation");
    const withPage = renderDocumentPdf({ model, rows }).getNumberOfPages();
    const without = renderDocumentPdf({ model: { ...model, termsPage: null }, rows }).getNumberOfPages();
    expect(withPage).toBe(without + 1);
  });

  it("does not print the terms twice", () => {
    /* They moved off the money column to get here. Leaving them in both
       places is the obvious way to get this wrong. */
    const text = render("quotation");
    const clause = TERMS[1]!;
    expect(text.split(clause).length - 1).toBe(1);
  });

  it("does not print the bank details twice either", () => {
    /* The column the terms left is where the bank details go now, and
       drawBankDetails draws them below. Only one of the two may — on
       every kind of document, not just the one that moved. The preview
       got this wrong for quotations while the PDF had it right, which is
       why the decision now lives on the model as money.bankBelow. */
    for (const kind of ["quotation", "proforma", "invoice"] as const) {
      expect(render(kind).split("50200045678901").length - 1, kind).toBe(1);
    }
  });

  it("belongs to a quotation and nothing else", () => {
    /* A proforma and an invoice demand payment rather than offer terms to
       be countersigned, and a purchase order has its own acknowledgement. */
    for (const kind of ["proforma", "invoice"] as const) {
      expect(render(kind), kind).not.toContain("ACCEPTANCE OF QUOTATION");
    }
    expect(modelFor("purchase_order").model.termsPage).toBe(null);
  });
});

describe("terms written with run-in headings", () => {
  /* The supplied domestic set is written "Heading: sentence." The heading
     is set in bold, which splitTextToSize cannot wrap — it measures in one
     font — so the wrap is hand-rolled. These check what that produces. */
  const LABELLED = [
    "Delivery Timeline: Delivery and execution timelines are indicative and subject to product "
    + "availability, vendor approvals, licensing activation and other dependencies beyond our "
    + "reasonable control.",
    "Order Confirmation: Orders shall be considered confirmed only upon receipt of an official "
    + "Purchase Order (PO) and/or advance payment, as applicable.",
    "Important Note: For Government and GeM transactions, the applicable GeM bid conditions, "
    + "contract terms, SLA and statutory requirements shall prevail over these standard quotation "
    + "terms wherever there is any inconsistency.",
  ];

  const labelled = (docType: "quotation" | "proforma" = "quotation") => {
    const d = { ...doc, terms: LABELLED };
    const totals = computeDocument(d, "Delhi");
    const model = buildDocumentModel({
      doc: d, settings, totals, docType, template: DEFAULT_DOC_TEMPLATE,
      bankAccount: { name: "HDFC Bank Ltd", accountName: "TechZoid", account: "50200045678901", ifsc: "HDFC0000123" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return { model, runs: pdfRuns(new Uint8Array(renderDocumentPdf({ model, rows: totals.rows }).output("arraybuffer"))) };
  };

  it("loses no word and repeats none, wrapping around the bold heading", () => {
    /* THE TEST THAT MATTERS for a hand-rolled wrap. Joining the runs in
       order has to give back each clause exactly: a word dropped at a line
       break, or one drawn twice, shows up here and nowhere else. */
    const joined = labelled().runs.join(" ").replace(/\s+/g, " ");
    for (const clause of LABELLED) expect(joined).toContain(clause);
  });

  it("draws the heading as its own run, so it can be bold", () => {
    const { runs } = labelled();
    expect(runs).toContain("Delivery Timeline:");
    expect(runs).toContain("Order Confirmation:");
  });

  it("numbers the terms but not the note", () => {
    /* The note says the GeM conditions prevail OVER these terms. Numbered
       among them it would be one of the things it overrides. */
    const { model, runs } = labelled();
    expect(model.termsPage!.clauses).toHaveLength(2);
    expect(model.termsPage!.notes).toHaveLength(1);
    expect(model.termsPage!.notes[0]).toContain("GeM bid conditions");
    expect(runs).toContain("1.");
    expect(runs).toContain("2.");
    expect(runs).not.toContain("3.");
  });

  it("keeps the note out of the numbering on a proforma too", () => {
    /* A proforma prints its terms under the money block rather than on a
       page of its own. Numbering the note there and not on the quotation
       would have the same document say both things. */
    const { model, runs } = labelled("proforma");
    expect(model.termsPage).toBe(null);
    const blocks = model.notes.filter((b) => b.lines.length);
    expect(blocks.at(-1)!.numbered).toBe(false);
    expect(blocks.at(-1)!.lines[0]).toContain("GeM bid conditions");
    /* The terms block itself carries the two clauses and nothing else;
       the note is its own block below it. (A proforma also prints a
       payment-instructions block, which is numbered and is why counting
       "3." across the whole page would prove nothing here.) */
    const termsBlock = blocks.find((b) => b.heading === "TERMS & CONDITIONS")!;
    expect(termsBlock.lines).toHaveLength(2);
    expect(termsBlock.numbered).not.toBe(false);
    expect(runs).toContain("Important Note:");
  });

  it("says whose terms they are, under the heading", () => {
    /* A signing page arrives detached. The number identifies the
       quotation; the name identifies the company without decoding it. */
    expect(labelled().runs).toContain("TECHZOID TECHNOLOGIES PRIVATE LIMITED");
  });
});

describe("the scan code on the page", () => {
  /**
   * REBUILT FROM THE FILE, not from the model.
   *
   * The renderer draws each horizontal run of dark modules as one
   * rectangle, because 625 separate ones leave hairline seams a phone
   * reads as damage. That merging is where this can go wrong — an
   * off-by-one in a run, a transposed row — and none of it shows in a
   * model assertion or to the eye: a corrupted QR still looks like a QR.
   *
   * So the modules are read back out of the PDF's own rectangle
   * operators and compared to the matrix the document asked for. The
   * geometry is self-locating: the module rows are the only rectangles on
   * the page with that height.
   */
  /** The square's printed size in mm, in its usual place in the header. */
  const SCAN_MM = 24;

  /** The module rectangles themselves, for a test about where they are. */
  const moduleRects = (bytes: Uint8Array, size: number) => {
    const stream = pdfStreams(bytes);
    const out: Array<{ x: number; y: number; w: number; h: number }> = [];
    const re = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re\s+f/g;
    const cellPt = (SCAN_MM / size) * (72 / 25.4);
    for (let m = re.exec(stream); m; m = re.exec(stream)) {
      const r = { x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]! };
      if (Math.abs(Math.abs(r.h) - cellPt) < cellPt * 0.2) out.push(r);
    }
    expect(out.length, "no module rows found in the PDF").toBeGreaterThan(0);
    return out;
  };

  const modulesFromPdf = (bytes: Uint8Array, size: number): boolean[][] => {
    const stream = pdfStreams(bytes);
    const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
    const re = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re\s+f/g;
    for (let m = re.exec(stream); m; m = re.exec(stream)) {
      rects.push({ x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]! });
    }
    /* One cell is 18mm/size; everything else drawn on the page is taller
       than two of them. */
    const cellPt = (SCAN_MM / size) * (72 / 25.4);
    const cells = rects.filter((r) => Math.abs(Math.abs(r.h) - cellPt) < cellPt * 0.2);
    expect(cells.length, "no module rows found in the PDF").toBeGreaterThan(0);

    const x0 = Math.min(...cells.map((r) => r.x));
    const x1 = Math.max(...cells.map((r) => r.x + r.w));
    const yTop = Math.max(...cells.map((r) => r.y));
    const cell = (x1 - x0) / size;

    const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
    for (const r of cells) {
      const row = Math.round((yTop - r.y) / cell);
      const col = Math.round((r.x - x0) / cell);
      const run = Math.max(1, Math.round(r.w / cell));
      for (let i = 0; i < run; i++) {
        if (grid[row] && col + i < size) grid[row]![col + i] = true;
      }
    }
    return grid;
  };

  it("carries the document's number, module for module", () => {
    const { model, rows } = modelFor("quotation");
    const bytes = new Uint8Array(renderDocumentPdf({ model, rows }).output("arraybuffer"));
    const want = scanMatrix(model.scan!.payload);
    expect(modulesFromPdf(bytes, want.length)).toEqual(want);
  });

  it("is in the top right, beside the number it carries", () => {
    /* Where somebody looks first, and where a phone can reach it without
       turning the page over. Pinned because a layout change could move
       it back to the foot of the page without anything else noticing.
       PDF coordinates run up from the bottom-left, so the top right is a
       large y and a large x. */
    const { model, rows } = modelFor("quotation");
    const bytes = new Uint8Array(renderDocumentPdf({ model, rows }).output("arraybuffer"));
    const cells = moduleRects(bytes, scanMatrix(model.scan!.payload).length);
    const A4_W = 595.28, A4_H = 841.89;
    expect(Math.max(...cells.map((r) => r.y))).toBeGreaterThan(A4_H * 0.85);
    expect(Math.min(...cells.map((r) => r.x))).toBeGreaterThan(A4_W * 0.4);
  });

  it("prints the number too, for anyone without a camera", () => {
    /* No caption under the square in the header: the number plaque is
       two centimetres away, and the words would not fit the height the
       header already has. */
    expect(render("quotation")).toContain("TZ/PI/2026-27/0007");
  });

  it("is on every kind of document", () => {
    /* A delivery challan gets lost as readily as a quotation. */
    for (const kind of ["quotation", "proforma", "invoice", "purchase_order"] as const) {
      const { model, rows } = modelFor(kind);
      expect(model.scan, kind).not.toBeNull();
      const bytes = new Uint8Array(renderDocumentPdf({ model, rows }).output("arraybuffer"));
      const want = scanMatrix(model.scan!.payload);
      expect(modulesFromPdf(bytes, want.length), kind).toEqual(want);
    }
  });

  it("costs the document no extra page", () => {
    /* It is drawn inside the signature band. Given its own flow it took a
       page of its own on a full quotation — a page somebody has to print
       to get a square that was already on page one. */
    const { model, rows } = modelFor("quotation");
    const withCode = renderDocumentPdf({ model, rows }).getNumberOfPages();
    const without = renderDocumentPdf({ model: { ...model, scan: null }, rows }).getNumberOfPages();
    expect(withCode).toBe(without);
  });

  it("is left off when the section is switched off", () => {
    /* Counted, not looked for by its caption: there is no caption under
       the square in the header, so asking for one would pass whether the
       code was there or not. */
    const { model, rows } = modelFor("quotation");
    const off = new Uint8Array(renderDocumentPdf({ model: { ...model, scan: null }, rows }).output("arraybuffer"));
    const size = scanMatrix(model.scan!.payload).length;
    const cellPt = (SCAN_MM / size) * (72 / 25.4);
    const stream = pdfStreams(off);
    const re = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re\s+f/g;
    let cells = 0;
    for (let m = re.exec(stream); m; m = re.exec(stream)) {
      if (Math.abs(Math.abs(+m[4]!) - cellPt) < cellPt * 0.2) cells += 1;
    }
    expect(cells).toBe(0);
  });
});
