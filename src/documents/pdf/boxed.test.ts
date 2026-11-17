import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { COPY_LABELS, renderBoxedPdf } from "./boxed";
import { buildPdf } from "./deliver";
import { buildDocumentModel } from "../../domain/documents/model";
import { DEFAULT_DOC_TEMPLATE, normalizeDocTemplate } from "../../domain/documents/template";
import { computeDocument } from "../../domain/tax/compute";

/**
 * WHAT IS ACTUALLY ON THE BOXED PAGE.
 *
 * Same method as render.test.ts, and for the same reason: the bug that file
 * exists to stop was a renderer that never read what the model built, while
 * every test of the model passed. A layout can only be tested by asking the
 * PDF.
 *
 * The assertions here are the ones where being wrong costs real money: the
 * tax columns, the copy markings, and whether the figures a customer checks
 * are on the sheet at all. Appearance is checked by rendering to an image
 * and looking at it, which is not something a test can do for you.
 */

function pdfStreams(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  let out = "";
  let at = 0;
  for (;;) {
    const start = raw.indexOf("stream", at);
    if (start < 0) break;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
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

const unescapePdf = (text: string): string => text.replace(/\\([()\\])/g, "$1");

/** Every text run in order, as drawn. */
function runsOf(bytes: Uint8Array): string[] {
  const stream = pdfStreams(bytes);
  const runs: string[] = [];
  const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
  for (let m = re.exec(stream); m; m = re.exec(stream)) runs.push(unescapePdf(m[1]!));
  return runs;
}

const ITEM = {
  id: "1", desc: "Microsoft 365 Business Standard", sku: "CFQ7TTC0LDPB",
  hsn: "997331", qty: 25, unit: "Nos", rate: 12_744, gst: 18,
};

const docFor = (over: Record<string, unknown> = {}) => ({
  number: "TZ/INV/2026-27/0007", date: "2026-11-05", validUntil: "2026-11-20",
  billName: "ABC Private Limited", billAddress: "123, Business Park",
  billCity: "Noida", billState: "Uttar Pradesh", billCountry: "India",
  billGstin: "09AABCA1234A1Z5",
  taxType: "gst", currency: "INR",
  terms: ["Prices are exclusive of applicable GST unless stated otherwise."],
  items: [ITEM],
  ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

const settings = {
  company: { name: "TechZoid Technologies Private Limited", state: "Delhi", gstin: "07AAGCT9158R1Z0" },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function build(
  over: Record<string, unknown> = {},
  docType: "invoice" | "quotation" = "invoice",
  sellerState = "Delhi",
) {
  const doc = docFor(over);
  const totals = computeDocument(doc, sellerState);
  const model = buildDocumentModel({
    doc, settings, totals, docType, template: DEFAULT_DOC_TEMPLATE,
    bankAccount: { name: "HDFC Bank Ltd", accountName: "TechZoid", account: "50200045678901", ifsc: "HDFC0000123" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { model, totals };
}

function render(
  over: Record<string, unknown> = {},
  docType: "invoice" | "quotation" = "invoice",
  sellerState = "Delhi",
  copies?: number,
) {
  const { model, totals } = build(over, docType, sellerState);
  const pdf = renderBoxedPdf({ model, rows: totals.rows, totals, copies });
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  return { pdf, runs: runsOf(bytes), text: runsOf(bytes).join(" ") };
}

describe("the boxed layout's tax columns", () => {
  it("prints CGST and SGST within the state, and no IGST column", () => {
    /* Uttar Pradesh customer, Uttar Pradesh seller. */
    const { runs } = render({}, "invoice", "Uttar Pradesh");
    expect(runs).toContain("CGST");
    expect(runs).toContain("SGST");
    expect(runs).not.toContain("IGST");
  });

  it("prints one IGST column across states, and no CGST or SGST", () => {
    const { runs } = render({}, "invoice", "Delhi");
    expect(runs).toContain("IGST");
    expect(runs).not.toContain("CGST");
    expect(runs).not.toContain("SGST");
  });

  it("halves the tax into the two columns within a state", () => {
    const { model, totals } = build({}, "invoice", "Uttar Pradesh");
    const bytes = new Uint8Array(
      renderBoxedPdf({ model, rows: totals.rows, totals }).output("arraybuffer"),
    );
    const half = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(totals.taxTotal / 2);
    /* Twice on the line, twice on the totals strip. */
    expect(runsOf(bytes).filter((r) => r === half).length).toBeGreaterThanOrEqual(4);
  });
});

describe("what the sheet carries", () => {
  it("prints the three copy markings on a tax invoice, one per page", () => {
    const { runs, pdf } = render();
    expect(pdf.getNumberOfPages()).toBe(3);
    for (const label of COPY_LABELS) expect(runs).toContain(label);
  });

  it("prints a quotation once, with no copy marking", () => {
    const { runs } = render({}, "quotation");
    for (const label of COPY_LABELS) expect(runs).not.toContain(label);
  });

  it("certifies the particulars on an invoice and not on a quotation", () => {
    const line = "Certified that the particulars given above are true and correct.";
    expect(render().text).toContain(line);
    expect(render({}, "quotation").text).not.toContain(line);
  });

  it("carries the quotation's terms and its acceptance box", () => {
    const { text } = render({}, "quotation");
    expect(text).toContain("Prices are exclusive of applicable GST unless stated otherwise.");
    expect(text).toContain("ACCEPTANCE OF QUOTATION");
  });

  it("names the place of supply with its GST state code", () => {
    expect(render().runs).toContain("Uttar Pradesh (09)");
  });

  it("prints the amount in words and the grand total", () => {
    const { model, totals } = build();
    const { text } = render();
    expect(text).toContain(model.money.grandValue);
    expect(model.money.amountInWords).toBeTruthy();
    expect(text.replace(/\s+/g, " ")).toContain(
      String(model.money.amountInWords).split(" ").slice(0, 4).join(" "),
    );
    expect(totals.grand).toBeGreaterThan(0);
  });
});

describe("the columns it leaves out", () => {
  it("drops Basic and Disc. when nothing is discounted", () => {
    const { runs } = render();
    expect(runs).not.toContain("Disc.");
    expect(runs).not.toContain("Basic");
    expect(runs).toContain("Taxable");
  });

  it("draws them as soon as one line is discounted", () => {
    const { runs } = render({ items: [{ ...ITEM, disc: 10 }] });
    expect(runs).toContain("Disc.");
    expect(runs).toContain("Basic");
  });

  it("drops the part-number column when no line has one", () => {
    const { runs } = render({ items: [{ ...ITEM, sku: "" }] });
    expect(runs).not.toContain("Part No.");
    expect(render().runs).toContain("Part No.");
  });
});

describe("a document longer than a page", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ ...ITEM, id: String(i + 1) }));

  it("repeats the heading and identifies every continuation page", () => {
    const { runs, pdf } = render({ items: many }, "invoice", "Delhi", 1);
    expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
    /* One column heading per page: a continuation sheet whose columns are
       unlabelled is a sheet nobody can read. */
    expect(runs.filter((r) => r === "Taxable").length).toBeGreaterThanOrEqual(
      pdf.getNumberOfPages(),
    );
    expect(runs.filter((r) => r.includes("continued")).length).toBe(
      pdf.getNumberOfPages() - 1,
    );
  });

  it("numbers every page of every copy", () => {
    const { runs, pdf } = render({ items: many });
    const pages = pdf.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) expect(runs).toContain(`Page ${p} of ${pages}`);
  });

  it("keeps the totals and the signature together on the last page", () => {
    const { runs } = render({ items: many }, "invoice", "Delhi", 1);
    const total = runs.lastIndexOf("Total");
    const signatory = runs.lastIndexOf("Authorised Signatory");
    expect(total).toBeGreaterThan(-1);
    expect(signatory).toBeGreaterThan(total);
  });
});

describe("the layout setting", () => {
  it("defaults to the standard sheet, and only accepts a layout we can draw", () => {
    expect(normalizeDocTemplate({}).layout).toBe("standard");
    expect(normalizeDocTemplate(null).layout).toBe("standard");
    expect(normalizeDocTemplate({ layout: "boxed" }).layout).toBe("boxed");
    /* A settings row naming a layout this build does not have prints the
       standard sheet rather than nothing at all. */
    expect(normalizeDocTemplate(
      { layout: "parchment" } as unknown as Record<string, never>,
    ).layout).toBe("standard");
  });

  it("makes buildPdf draw the boxed sheet, which is what download, email and preview all call", () => {
    const doc = docFor();
    const totals = computeDocument(doc, "Delhi");
    const of = (layout: "standard" | "boxed") => buildDocumentModel({
      doc, settings, totals, docType: "invoice",
      template: normalizeDocTemplate({ layout }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    /* COMPARED BY WHAT IS ON THE PAGE, not by the bytes: jsPDF stamps a
       creation time into every file, so two renders a second apart are
       never byte-identical and a byte comparison would pass whatever the
       renderer did. */
    const sheet = (opts: Parameters<typeof buildPdf>[0]) =>
      runsOf(Buffer.from(buildPdf(opts).base64, "base64"));

    const boxed = sheet({ model: of("boxed"), rows: totals.rows, totals });
    const standard = sheet({ model: of("standard"), rows: totals.rows, totals });
    /* The copy marking exists only on the boxed sheet. */
    expect(boxed).toContain(COPY_LABELS[0]);
    expect(standard).not.toContain(COPY_LABELS[0]);

    /* WITHOUT TOTALS A BOXED MODEL FALLS BACK rather than guessing which
       tax columns to draw — see DeliverOptions. */
    const noTotals = sheet({ model: of("boxed"), rows: totals.rows });
    expect(noTotals).toEqual(standard);
  });

  it("reaches the model, which is what every destination reads", () => {
    const doc = docFor();
    const totals = computeDocument(doc, "Delhi");
    const boxed = buildDocumentModel({
      doc, settings, totals, docType: "invoice",
      template: normalizeDocTemplate({ layout: "boxed" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(boxed.layout).toBe("boxed");
    expect(build().model.layout).toBe("standard");
  });
});
