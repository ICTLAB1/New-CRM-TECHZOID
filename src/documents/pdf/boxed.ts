import { jsPDF } from "jspdf";
import type { DocumentModel, Pair } from "../../domain/documents/model";
import { scanMatrix } from "../../domain/documents/scanCode";
import { STATES } from "../../domain/geo/states";
import { taxTypeLabel } from "../../domain/tax/types";
import type { ComputedRow, DocumentTotals } from "../../domain/tax/types";
import type { DocImages } from "./render";
import { hexToRgb, pdfSafeText } from "./text";

/**
 * The boxed tax-invoice layout — the one Indian distributors print.
 *
 * WHAT IT IS AND WHY IT EXISTS. Every rule on this page is doing a job: the
 * sheet is a grid of bordered, labelled cells, and a reader's eye goes to a
 * cell rather than along a line. It is the format a customer's accounts
 * department has processed ten thousand times, which is the whole argument
 * for it — a GST invoice is not read, it is checked, field by field,
 * against a purchase order. The CRM's other layout is a better document to
 * receive; this is a better document to process.
 *
 * IT IS A LAYOUT, NOT A COPY. It was drawn from a distributor's invoice the
 * company was sent. Nothing of that supplier's is reproduced — not the
 * name, the logo, the GSTIN, the bank details, the terms URL, nor the
 * declarations that are theirs to make. Every word and figure here comes
 * from the DocumentModel, which is to say from this company's own settings
 * and this company's own document.
 *
 * NOR DOES IT CLAIM WHAT THE CRM CANNOT DO. The invoice it was drawn from
 * carries an IRN and the signed QR the e-invoice portal returns. This CRM
 * does not register invoices with that portal, so there is no IRN and no
 * signed QR, and a box labelled as either would be a lie told in the one
 * place a customer's auditor looks. The square printed here is the CRM's
 * own document QR, captioned as that by the model. Likewise the TCS,
 * freight, transporter and e-way-bill columns of a goods distributor's
 * sheet: nothing in this product computes them, so they are not drawn as
 * empty cells implying a figure of nil that nobody worked out.
 *
 * GEOMETRY ONLY, like its sibling in render.ts. Nothing here decides what
 * the document says. Two things it does work out for itself, because both
 * are facts about the page's shape rather than its wording: which tax
 * columns to draw (CGST and SGST within a state, IGST across states), and
 * which columns to leave out when every row would print the same number
 * twice — see KEEPING THE DESCRIPTION READABLE below.
 *
 * Verify changes by rendering to an image and LOOKING at it, at 1, 5, 20
 * and 60 line items, intra-state and inter-state. Measuring coordinates
 * programmatically gave false results repeatedly in the other renderer, in
 * both directions.
 */

const A4 = { w: 210, h: 297 };
/* Tighter than the airy layout: this one earns its density. */
const M = 7;
const CW = A4.w - M * 2;
/* What the page number needs at the foot. */
const FOOT = 5;

const INK = hexToRgb("#111111");
const MUTED = hexToRgb("#555555");
const RULE = hexToRgb("#222222");
const HAIR = hexToRgb("#888888");
const TINT = hexToRgb("#F0F0F0");

/* Type sizes. Small, because the grid is the point. */
const T_TINY = 5.4;
const T_SMALL = 6.0;
const T_BODY = 6.8;
const T_TITLE = 10.5;

/** The three copies a GST invoice is printed in. */
export const COPY_LABELS = [
  "Original for Recipient",
  "Duplicate for Transporter",
  "Triplicate for Supplier",
] as const;

export interface BoxedOptions {
  model: DocumentModel;
  rows: ComputedRow[];
  totals: DocumentTotals;
  images?: DocImages;
  /**
   * How many copies to print.
   *
   * Three on a tax invoice, which is what the rules ask for and what this
   * format exists to serve. One on anything else: nobody needs a
   * "Duplicate for Transporter" of a quotation, and printing one would be
   * a document claiming to be something it is not.
   */
  copies?: number;
}

/* ── small helpers ────────────────────────────────────────────────── */

const money = (n: number): string =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number.isFinite(n) ? n : 0);

const qtyText = (n: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(Number.isFinite(n) ? n : 0);

/** A value, or an empty string — never "undefined" or "null" on the page. */
const val = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;

/**
 * The value from a labelled pair list, by the start of its label.
 *
 * The model carries these as display pairs rather than named fields, so
 * this layout — which puts them in named cells rather than a list — has to
 * find them. Matched on a prefix, case-insensitively, so "Invoice No." and
 * "Invoice Number" both answer to "invoice no".
 */
function pick(pairs: ReadonlyArray<Pair>, ...starts: string[]): string {
  for (const start of starts) {
    const want = start.toLowerCase();
    for (const [label, value] of pairs) {
      if (val(label).toLowerCase().startsWith(want)) return val(value).trim();
    }
  }
  return "";
}

/** The same, over the reference strip's cells. */
function pickRef(
  cells: ReadonlyArray<{ label: string; value: string }>,
  ...starts: string[]
): string {
  for (const start of starts) {
    const want = start.toLowerCase();
    for (const cell of cells) {
      if (val(cell.label).toLowerCase().startsWith(want)) return val(cell.value).trim();
    }
  }
  return "";
}

/** "GSTIN 07AAG..." -> ["GSTIN", "07AAG..."] */
function splitReg(reg: string): [string, string] {
  const text = val(reg).trim();
  const at = text.indexOf(" ");
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + 1).trim()];
}

/* ── the renderer ─────────────────────────────────────────────────── */

export function renderBoxedPdf(opts: BoxedOptions): jsPDF {
  const { model } = opts;
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const copies = Math.max(1, opts.copies ?? (model.isInvoice ? COPY_LABELS.length : 1));

  for (let copy = 0; copy < copies; copy += 1) {
    if (copy > 0) pdf.addPage();
    drawCopy(pdf, opts, model.isInvoice ? COPY_LABELS[copy] ?? "" : "");
  }

  /* Page numbers last, once the total is known. A page of a tax invoice
     that does not say which of how many it is cannot be filed. */
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal").setFontSize(T_TINY).setTextColor(...MUTED);
    pdf.text(`Page ${p} of ${pages}`, A4.w - M, A4.h - M + 2, { align: "right" });
  }

  return pdf;
}

/* ── one copy of the document ─────────────────────────────────────── */

function drawCopy(pdf: jsPDF, opts: BoxedOptions, copyLabel: string): void {
  const { model, rows, totals, images } = opts;

  pdf.setLineWidth(0.25);
  pdf.setDrawColor(...RULE);

  let y = drawMasthead(pdf, M, model, copyLabel, images, false);
  y = drawSupplier(pdf, y, model);
  y = drawReferences(pdf, y, model);
  y = drawParties(pdf, y, model);
  y = drawPlaceOfSupply(pdf, y, model);

  /* The tail is measured before the items are drawn, because whether the
     last row fits depends on what has to follow it on the same page. */
  const tailH = measureTail(pdf, model);
  const cols = itemColumns(rows, totals);

  y = drawItems(pdf, y, { model, rows, images, copyLabel }, cols, tailH);
  y = drawTotalsStrip(pdf, y, rows, totals, cols);
  y = drawHsnSummary(pdf, y, model);
  y = drawMoney(pdf, y, model);
  drawFoot(pdf, y, model);

  drawTermsPage(pdf, model);
}

/**
 * A QUOTATION'S OWN LAST PAGE: the terms in full, and the box the customer
 * signs to accept them.
 *
 * It is a page and not a column for the same reason it is one in the other
 * renderer. A quotation is an offer; a signature turns it into a contract,
 * and the terms that signature incorporates have to be legible and complete
 * beside it — not set at 5.4pt in the corner of a grid, wrapping wherever
 * the item table left room. Signed pages get detached, scanned and emailed
 * back on their own, so this one repeats the number and says what it is.
 *
 * Null on an invoice, which is a demand for payment rather than an offer to
 * be countersigned, and the page is then not drawn at all.
 */
function drawTermsPage(pdf: jsPDF, model: DocumentModel): void {
  const t = model.termsPage;
  if (!t) return;

  pdf.addPage();
  pdf.setLineWidth(0.25);
  pdf.setDrawColor(...RULE);

  const headH = 9;
  pdf.rect(M, M, CW, headH);
  pdf.setFont("helvetica", "bold").setFontSize(T_BODY + 1).setTextColor(...INK);
  pdf.text(pdfSafeText(val(t.title).toUpperCase()), M + 2.5, M + 4.2);
  pdf.setFont("helvetica", "normal").setFontSize(T_SMALL).setTextColor(...MUTED);
  pdf.text(pdfSafeText(val(t.subtitle)), M + 2.5, M + 7.4);
  pdf.text(pdfSafeText(val(t.issuer)), A4.w - M - 2.5, M + 4.2, { align: "right" });

  let y = M + headH;
  const lineH = 3.5;
  const limit = A4.h - M - FOOT - measureAcceptance(pdf, t) - 3;

  /** Opens the next page of clauses when this one is full. */
  const carry = (need: number): void => {
    if (y + need <= limit) return;
    pdf.addPage();
    pdf.rect(M, M, CW, 6.4);
    pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
    pdf.text(pdfSafeText(`${val(t.title).toUpperCase()} — continued`), M + 2.5, M + 4.2);
    y = M + 6.4;
  };

  /* HANGING INDENT. The number sits in the margin and the text keeps its
     own left edge, so a clause that wraps stays under its first word
     rather than under its number — which is how one clause gets read as
     two, and a term nobody agreed to gets argued over later. */
  const para = (text: string, number: string): void => {
    const indent = number ? 6 : 0;
    pdf.setFont("helvetica", "normal").setFontSize(T_BODY);
    const lines = pdf.splitTextToSize(pdfSafeText(text), CW - 6 - indent) as string[];
    const h = lines.length * lineH + 1.4;
    carry(h);
    pdf.rect(M, y, CW, h);
    if (number) {
      pdf.setTextColor(...INK);
      pdf.text(number, M + 3, y + 3.3);
    }
    pdf.setTextColor(...MUTED);
    let ly = y + 3.3;
    for (const line of lines) {
      pdf.text(line, M + 3 + indent, ly);
      ly += lineH;
    }
    y += h;
  };

  t.clauses.forEach((clause, i) => para(val(clause), `${i + 1}.`));

  /* Statements ABOUT the terms, printed after them and never numbered
     among them — a note read as clause 12 is a clause nobody agreed to. */
  for (const note of t.notes) {
    if (val(note).trim()) para(val(note), "");
  }

  /* Straight under the terms it accepts. Pinning it to the foot of the
     sheet left half a page of white between the two, which reads as a
     page that lost something. */
  const need = measureAcceptance(pdf, t);
  if (y + 3 + need > A4.h - M - FOOT) {
    pdf.addPage();
    y = M;
  }
  drawAcceptance(pdf, y + 3, t);
}

const ACC_HEAD = 5;
const ACC_LINE = 3.4;

/** The statement, wrapped — it is a sentence, not a label, and it names the
 *  document, the date and the amount being accepted. */
function acceptanceStatement(
  pdf: jsPDF,
  a: NonNullable<DocumentModel["termsPage"]>["acceptance"],
): string[] {
  pdf.setFont("helvetica", "normal").setFontSize(T_SMALL);
  return val(a.statement).trim()
    ? (pdf.splitTextToSize(pdfSafeText(val(a.statement)), CW - 5) as string[])
    : [];
}

/** The closing line, wrapped clear of the seal label on its right. */
function acceptanceFoot(pdf: jsPDF, t: NonNullable<DocumentModel["termsPage"]>): string[] {
  if (!val(t.footNote).trim()) return [];
  pdf.setFont("helvetica", "normal").setFontSize(T_TINY);
  return pdf.splitTextToSize(pdfSafeText(val(t.footNote)), CW - 40) as string[];
}

function measureAcceptance(
  pdf: jsPDF,
  t: NonNullable<DocumentModel["termsPage"]>,
): number {
  const a = t.acceptance;
  /* 9.8 is the gap to the first signature rule: 2.2 of air, then 7.6 for
     the "For ..." line. A smaller figure here put the last field's "Date"
     label underneath the closing strip's own rule. */
  return ACC_HEAD + 3.2 + acceptanceStatement(pdf, a).length * ACC_LINE
    + 9.8 + a.fields.length * 7 + 2 + Math.max(acceptanceFoot(pdf, t).length, 1) * 3.2 + 1.6;
}

function drawAcceptance(
  pdf: jsPDF,
  top: number,
  t: NonNullable<DocumentModel["termsPage"]>,
): number {
  const a = t.acceptance;
  const stmt = acceptanceStatement(pdf, a);
  const foot = acceptanceFoot(pdf, t);
  const h = measureAcceptance(pdf, t);
  const footH = Math.max(foot.length, 1) * 3.2 + 1.6;

  pdf.rect(M, top, CW, h);
  pdf.setFillColor(...TINT);
  pdf.rect(M + 0.15, top + 0.15, CW - 0.3, ACC_HEAD - 0.3, "F");
  pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
  pdf.text(pdfSafeText(val(a.heading).toUpperCase()), M + 2.5, top + ACC_HEAD - 1.4);

  let y = top + ACC_HEAD + 3.2;
  pdf.setFont("helvetica", "normal").setFontSize(T_SMALL).setTextColor(...MUTED);
  for (const line of stmt) {
    pdf.text(line, M + 2.5, y);
    y += ACC_LINE;
  }

  /* The two signature columns start level, whatever the statement did. */
  const half = CW / 2;
  const colTop = y + 2.2;
  pdf.setDrawColor(...HAIR);
  pdf.line(M + half, colTop - 2, M + half, top + h - footH);
  pdf.setDrawColor(...RULE);

  for (const side of [
    { x: M + 2.5, who: val(a.customerName) },
    { x: M + half + 2.5, who: val(a.companyName) },
  ]) {
    pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
    pdf.text(pdfSafeText(`For ${side.who}`), side.x, colTop + 1.4);
    let fy = colTop + 7.6;
    for (const field of a.fields) {
      pdf.setDrawColor(...HAIR);
      pdf.line(side.x, fy, side.x + half - 7, fy);
      pdf.setDrawColor(...RULE);
      pdf.setFont("helvetica", "normal").setFontSize(T_TINY).setTextColor(...MUTED);
      pdf.text(pdfSafeText(val(field)), side.x, fy + 2.8);
      fy += 7;
    }
  }

  /* The closing line gets a strip of its own, and WRAPS inside it. Printed
     on the same line as the last signature rule it landed on top of the
     word "Date"; clipped to one line it lost the sentence that says how an
     offer is accepted. */
  const footTop = top + h - footH;
  pdf.line(M, footTop, A4.w - M, footTop);
  pdf.setFont("helvetica", "normal").setFontSize(T_TINY).setTextColor(...MUTED);
  let fy = footTop + 3;
  for (const line of foot) {
    pdf.text(line, M + 2.5, fy);
    fy += 3.2;
  }
  if (val(a.sealLabel).trim()) {
    pdf.text(pdfSafeText(val(a.sealLabel)), A4.w - M - 2.5, footTop + 3, { align: "right" });
  }

  return top + h;
}

/**
 * The masthead and the title band.
 *
 * `continued` draws the shorter version used at the top of a second or
 * third page: the same identity, plus the document's number, so a page
 * that comes away from the staple is still a page of this invoice rather
 * than an orphan nobody can file.
 */
function drawMasthead(
  pdf: jsPDF,
  top: number,
  model: DocumentModel,
  copyLabel: string,
  images: DocImages | undefined,
  continued: boolean,
): number {
  let y = top;
  const mastH = continued ? 7 : 9;
  pdf.rect(M, y, CW, mastH);

  const logo = images?.logo ?? model.header.logo;
  if (logo?.src && logo.h > 0) {
    const h = Math.min(mastH - 2.4, 6.4);
    const w = Math.min(32, (logo.w / logo.h) * h);
    try {
      pdf.addImage(logo.src, "PNG", A4.w - M - w - 2.4, y + (mastH - h) / 2, w, h);
    } catch {
      /* A logo that will not decode must not take the document with it. */
    }
  }

  pdf.setFont("helvetica", "bold")
    .setFontSize(continued ? T_BODY + 1 : T_TITLE)
    .setTextColor(...INK);
  pdf.text(pdfSafeText(model.header.companyName.toUpperCase()), M + 2.5, y + mastH / 2 + 1.3);
  y += mastH;

  const titleH = 6.4;
  pdf.rect(M, y, CW, titleH);
  pdf.setFont("helvetica", "bold").setFontSize(T_BODY + 0.6).setTextColor(...INK);
  pdf.text(pdfSafeText(model.title.toUpperCase()), A4.w / 2, y + titleH / 2 + 1.05, {
    align: "center",
  });

  pdf.setFont("helvetica", "normal").setFontSize(T_SMALL).setTextColor(...MUTED);
  if (continued) {
    pdf.text(pdfSafeText(`${model.number} — continued`), M + 2.5, y + titleH / 2 + 1);
  }
  if (copyLabel) {
    pdf.text(copyLabel, A4.w - M - 2.5, y + titleH / 2 + 1, { align: "right" });
  }
  return y + titleH;
}

/**
 * The supplier's own particulars, and the document QR beside them.
 *
 * The QR sits where the invoice this was drawn from carries the e-invoice
 * portal's signed code. It is NOT that code: it encodes this document's own
 * number so a printed sheet can be found in the CRM by pointing a camera at
 * it, and the model's own caption says which it is.
 */
function drawSupplier(pdf: jsPDF, top: number, model: DocumentModel): number {
  const pairs: Array<[string, string]> = [];
  const addr = model.header.addressLines.filter((l) => val(l).trim()).join(", ");
  if (addr) pairs.push(["Address", addr]);
  if (val(model.header.contactLine).trim()) pairs.push(["Contact", model.header.contactLine]);
  for (const reg of model.header.registration) {
    const [label, value] = splitReg(reg);
    if (label) pairs.push([label, value]);
  }
  if (model.header.uaeOffice) {
    const parts = [model.header.uaeOffice.addressLine, ...model.header.uaeOffice.regParts]
      .filter((p) => val(p).trim())
      .join(" · ");
    if (parts) pairs.push(["UAE Office", parts]);
  }

  const scanBox = model.scan ? 23 : 0;
  const rightW = scanBox ? scanBox + 7 : 0;
  const leftW = CW - rightW;

  const rowH = 4.6;
  const boxH = Math.max(Math.max(pairs.length, 1) * rowH, scanBox ? scanBox + 5 : 0);

  /* Left: the labelled rows, one per strip, so each is its own cell. */
  let y = top;
  for (const [label, value] of pairs) {
    pdf.rect(M, y, leftW, rowH);
    pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
    pdf.text(pdfSafeText(label), M + 2, y + rowH / 2 + 0.85);
    pdf.setFont("helvetica", "normal").setTextColor(...MUTED);
    pdf.text(pdfSafeText(clip(val(value), 150)), M + 24, y + rowH / 2 + 0.85);
    y += rowH;
  }
  /* Pad the left column down to the QR's height so the grid closes. */
  if (y < top + boxH) pdf.rect(M, y, leftW, top + boxH - y);

  if (scanBox && model.scan) {
    const x = M + leftW;
    pdf.rect(x, top, rightW, boxH);
    paintScan(pdf, model.scan.payload, x + (rightW - scanBox) / 2, top + 1.2, scanBox - 2.4);
    pdf.setFont("helvetica", "normal").setFontSize(T_TINY).setTextColor(...MUTED);
    pdf.text(pdfSafeText(model.scan.caption), x + rightW / 2, top + boxH - 1.8, {
      align: "center",
    });
  }

  return top + boxH;
}

/** Numbers, dates and terms, in named cells three across. */
function drawReferences(pdf: jsPDF, top: number, model: DocumentModel): number {
  const d = model.details;
  const r = model.references ?? [];
  const noun = model.isInvoice ? "Invoice" : model.isPurchaseOrder ? "Order" : "Document";

  const grid: Array<Array<[string, string]>> = [
    [
      [`${noun} No.`, model.number],
      ["Customer Order No.", pickRef(r, "customer ref", "customer order", "po ")],
      ["Payment Terms", pickRef(r, "payment terms")],
    ],
    [
      [`${noun} Date`, pick(d, "invoice date", "quotation date", "order date", "date")],
      ["Our Reference", pickRef(r, "enquiry ref", "reference")],
      ["Delivery Terms", pickRef(r, "delivery terms")],
    ],
    [
      [
        model.isInvoice ? "Payment Due" : "Valid Until",
        pick(d, "payment due", "due date", "valid until", "valid till"),
      ],
      ["Sales Executive", pick(d, "sales executive", "prepared by", "contact person")],
      ["Currency", `${model.currency}${model.taxType ? ` · ${taxTypeLabel(model.taxType)}` : ""}`],
    ],
  ];

  let y = top;
  const h = 4.8;
  for (const row of grid) {
    const w = CW / row.length;
    pdf.rect(M, y, CW, h);
    row.forEach(([label, value], n) => {
      const x = M + w * n;
      if (n > 0) {
        pdf.setDrawColor(...HAIR);
        pdf.line(x, y, x, y + h);
        pdf.setDrawColor(...RULE);
      }
      pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
      pdf.text(pdfSafeText(label), x + 2, y + h / 2 + 0.85);
      pdf.setFont("helvetica", "normal").setTextColor(...MUTED);
      pdf.text(pdfSafeText(clip(val(value) || "—", 42)), x + 25, y + h / 2 + 0.85);
    });
    y += h;
  }
  return y;
}

/** Bill To and Ship To, in bordered columns of equal height. */
function drawParties(pdf: jsPDF, top: number, model: DocumentModel): number {
  const parties = model.parties.slice(0, 2);
  if (!parties.length) return top;

  const w = CW / parties.length;
  const headH = 4.4;
  const lineH = 3.1;

  const bodies = parties.map((p) => {
    const out: Array<{ text: string; strong: boolean }> = [];
    /* Bold metrics for the bold line — see the item grid. */
    pdf.setFont("helvetica", "bold").setFontSize(T_TINY);
    if (val(p.name).trim()) {
      for (const line of pdf.splitTextToSize(pdfSafeText(val(p.name)), w - 4) as string[]) {
        out.push({ text: line, strong: true });
      }
    }
    pdf.setFont("helvetica", "normal").setFontSize(T_TINY);
    for (const l of p.lines ?? []) {
      if (!val(l).trim()) continue;
      for (const line of pdf.splitTextToSize(pdfSafeText(val(l)), w - 4) as string[]) {
        out.push({ text: line, strong: false });
      }
    }
    for (const [label, value] of p.rows ?? []) {
      if (!val(value).trim()) continue;
      out.push({ text: pdfSafeText(`${label} : ${val(value)}`), strong: false });
    }
    return out;
  });

  const h = headH + Math.max(...bodies.map((b) => b.length), 1) * lineH + 2.2;

  parties.forEach((p, n) => {
    const x = M + w * n;
    pdf.rect(x, top, w, h);
    pdf.setFillColor(...TINT);
    pdf.rect(x + 0.15, top + 0.15, w - 0.3, headH - 0.3, "F");
    pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
    pdf.text(pdfSafeText(val(p.heading).toUpperCase()), x + 2, top + headH - 1.35);

    let ly = top + headH + 2.5;
    for (const line of bodies[n] ?? []) {
      pdf.setFont("helvetica", line.strong ? "bold" : "normal").setFontSize(T_TINY);
      pdf.setTextColor(...(line.strong ? INK : MUTED));
      pdf.text(line.text, x + 2, ly);
      ly += lineH;
    }
  });

  return top + h;
}

/**
 * Place of supply.
 *
 * It decides which tax is charged, so it gets its own labelled strip rather
 * than being left inside the customer's address. Read from the model, never
 * guessed; no value, no strip.
 */
function drawPlaceOfSupply(pdf: jsPDF, top: number, model: DocumentModel): number {
  const ship = model.parties[1] ?? model.parties[0];
  const place =
    pickRef(model.references ?? [], "place of supply")
    || val(ship?.rows?.find(([l]) => /state|place/i.test(val(l)))?.[1]).trim()
    || stateFromLines(ship?.lines ?? []);
  if (!place) return top;

  const h = 4.8;
  pdf.rect(M, top, CW, h);
  pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
  pdf.text("Place of Supply", M + 2, top + h / 2 + 0.85);
  pdf.setFont("helvetica", "normal").setTextColor(...MUTED);
  pdf.text(pdfSafeText(clip(place, 140)), M + 25, top + h / 2 + 0.85);
  return top + h;
}

/**
 * The state out of an address, with its GST code.
 *
 * The model prints the ship-to address as plain lines and keeps no state
 * field of its own, so the state is found by MATCHING those lines against
 * the real list of states and union territories — not by taking the second
 * line, or the line before the country, which is a different line for every
 * customer who writes their address differently. No match, no strip: an
 * unlabelled guess at the place of supply is the one thing worse than
 * leaving it off, because it decides which tax is charged.
 */
function stateFromLines(lines: ReadonlyArray<string>): string {
  for (const line of lines) {
    const text = val(line).trim().toLowerCase();
    if (!text) continue;
    for (const [name, code] of STATES) {
      const n = name.toLowerCase();
      if (text === n || text.includes(n)) return `${name} (${code})`;
    }
  }
  return "";
}

/* ── the item grid ────────────────────────────────────────────────── */

interface Col {
  key: string;
  title: string;
  /** The group this column sits under in the two-row header, if any. */
  group?: string;
  w: number;
  align: "left" | "right" | "center";
}

/**
 * Which columns the grid gets, and how wide.
 *
 * WHICH TAX COLUMNS. Within one state a sale carries CGST and SGST, each at
 * half the rate; across states it carries IGST at the whole rate. That is
 * two different tables, and printing the wrong one is not a cosmetic fault
 * — it is a figure a customer's accounts department will reject. The answer
 * is already worked out in the totals, so it is read here, not re-derived.
 *
 * KEEPING THE DESCRIPTION READABLE. The description is the only column a
 * human actually reads, and it gets whatever the figures do not need. So a
 * column every row would leave blank is not drawn: with no discount
 * anywhere, "Basic" and "Taxable" hold the same number twice, so both the
 * basic and the discount column go; with no part numbers, that column goes.
 * The worst case — intra-state, discounted, with part numbers — leaves the
 * description about 40mm, which is why it wraps rather than clips. An
 * always-empty column is worse than no column: it reads as a figure of nil
 * that nobody computed.
 */
function itemColumns(rows: ComputedRow[], totals: DocumentTotals): Col[] {
  const hasPart = rows.some((r) => val(r.sku).trim());
  const hasDisc = rows.some((r) => (r.discAmt || 0) > 0) || (totals.discount || 0) > 0;
  const taxed = (totals.taxTotal || 0) > 0 || rows.some((r) => (Number(r.gst) || 0) > 0);

  const cols: Col[] = [
    { key: "sr", title: "Sr", w: 5.5, align: "center" },
    ...(hasPart ? [{ key: "part", title: "Part No.", w: 20, align: "left" as const }] : []),
    { key: "desc", title: "Description / HSN·SAC", w: 0, align: "left" },
    { key: "qty", title: "Qty", w: 13, align: "right" },
    { key: "rate", title: "Rate", w: 15, align: "right" },
    ...(hasDisc
      ? [
        { key: "basic", title: "Basic", w: 17, align: "right" as const },
        { key: "disc", title: "Disc.", w: 13, align: "right" as const },
      ]
      : []),
    { key: "taxable", title: "Taxable", w: 17, align: "right" },
    ...(taxed
      ? totals.intra
        ? [
          { key: "pct", title: "Rate %", group: "GST", w: 9, align: "right" as const },
          { key: "cgst", title: "CGST", group: "GST", w: 15, align: "right" as const },
          { key: "sgst", title: "SGST", group: "GST", w: 15, align: "right" as const },
        ]
        : [
          { key: "pct", title: "Rate %", group: "IGST", w: 9, align: "right" as const },
          { key: "igst", title: "Amount", group: "IGST", w: 18, align: "right" as const },
        ]
      : []),
    { key: "total", title: "Amount", w: 18, align: "right" },
  ];

  const fixed = cols.reduce((sum, c) => sum + c.w, 0);
  const desc = cols.find((c) => c.key === "desc");
  if (desc) desc.w = CW - fixed;
  return cols;
}

const colXs = (cols: Col[]): number[] => {
  const xs: number[] = [];
  let x = M;
  for (const c of cols) {
    xs.push(x);
    x += c.w;
  }
  return xs;
};

function cellX(c: Col, x: number): number {
  if (c.align === "right") return x + c.w - 1.5;
  if (c.align === "center") return x + c.w / 2;
  return x + 1.5;
}

/**
 * The column header, in two rows when any column belongs to a group.
 *
 * A grouped header is not decoration: "GST" over "CGST" and "SGST" says
 * the two money columns are halves of one tax, where three peer headings
 * read as three separate charges.
 */
function drawItemHead(pdf: jsPDF, top: number, cols: Col[]): number {
  const grouped = cols.some((c) => c.group);
  const h = grouped ? 8.4 : 5.6;
  const split = top + 4;
  const xs = colXs(cols);

  pdf.setFillColor(...TINT);
  pdf.rect(M, top, CW, h, "F");
  pdf.rect(M, top, CW, h);
  pdf.setFont("helvetica", "bold").setFontSize(T_TINY).setTextColor(...INK);

  cols.forEach((c, i) => {
    const sameGroup = !!c.group && cols[i - 1]?.group === c.group;
    if (i > 0 && !sameGroup) {
      pdf.setDrawColor(...HAIR);
      pdf.line(xs[i]!, top, xs[i]!, top + h);
      pdf.setDrawColor(...RULE);
    }
    if (!c.group) {
      pdf.text(c.title, cellX(c, xs[i]!), top + h / 2 + 0.85, { align: c.align });
      return;
    }
    /* Inside a group: the sub-heading in the lower half, with a hairline
       over it, and the group's own title centred over the whole span once. */
    pdf.text(c.title, cellX(c, xs[i]!), top + h - 1.3, { align: c.align });
    pdf.setDrawColor(...HAIR);
    pdf.line(xs[i]!, split, xs[i]! + c.w, split);
    if (sameGroup) pdf.line(xs[i]!, split, xs[i]!, top + h);
    pdf.setDrawColor(...RULE);
    if (!sameGroup) {
      const span = cols.filter((o) => o.group === c.group).reduce((s, o) => s + o.w, 0);
      pdf.text(c.group, xs[i]! + span / 2, top + 2.9, { align: "center" });
    }
  });

  return top + h;
}

/** Everything after the item rows, measured so the last row knows if it fits. */
function measureTail(pdf: jsPDF, model: DocumentModel): number {
  return 5.6 + measureHsn(model) + measureMoney(pdf, model) + measureFoot(pdf, model);
}

function drawItems(
  pdf: jsPDF,
  top: number,
  ctx: { model: DocumentModel; rows: ComputedRow[]; images?: DocImages; copyLabel: string },
  cols: Col[],
  tailH: number,
): number {
  const { model, rows, images, copyLabel } = ctx;
  const xs = colXs(cols);
  const descCol = cols.find((c) => c.key === "desc")!;
  const lineH = 3.1;
  const limit = A4.h - M - FOOT;

  let y = drawItemHead(pdf, top, cols);

  rows.forEach((r, i) => {
    /* WRAPPED IN THE FACE IT IS DRAWN IN. splitTextToSize measures with
       whatever font is currently set, and bold is wider than regular: a
       description measured in regular and printed in bold runs past the
       column rule and over the Qty figure beside it. So the face is set
       before each run of lines, not once for the row. */
    const lines: Array<{ text: string; strong: boolean }> = [];
    pdf.setFont("helvetica", "bold").setFontSize(T_TINY);
    for (const line of pdf.splitTextToSize(
      pdfSafeText(val(r.desc) || "—"),
      descCol.w - 3,
    ) as string[]) {
      lines.push({ text: line, strong: true });
    }
    pdf.setFont("helvetica", "normal").setFontSize(T_TINY);
    for (const extra of [val(r.subDesc), val(r.brand)]) {
      if (!extra.trim()) continue;
      for (const line of pdf.splitTextToSize(pdfSafeText(extra), descCol.w - 3) as string[]) {
        lines.push({ text: line, strong: false });
      }
    }
    if (val(r.hsn).trim()) lines.push({ text: pdfSafeText(`HSN/SAC ${val(r.hsn)}`), strong: false });

    const h = Math.max(lines.length * lineH + 2, 6.4);

    /* A row near the foot of the page goes over, and so does the last row
       when the tail behind it would not fit: totals and a signature
       stranded alone on a third page is a document nobody trusts. */
    const needs = h + (i === rows.length - 1 ? tailH : 0);
    if (y + needs > limit) {
      pdf.addPage();
      const headTop = drawMasthead(pdf, M, model, copyLabel, images, true);
      y = drawItemHead(pdf, headTop, cols);
    }

    pdf.rect(M, y, CW, h);

    const half = (r.tax || 0) / 2;
    const unit = val(r.unit).trim();
    const cells: Record<string, string> = {
      sr: String(i + 1),
      part: clip(val(r.sku), 18),
      qty: `${qtyText(Number(r.qty) || 0)}${unit ? ` ${clip(unit, 4)}` : ""}`,
      rate: money(Number(r.rate) || 0),
      basic: money(r.gross),
      disc: (r.discAmt || 0) > 0 ? money(r.discAmt) : "",
      taxable: money(r.taxable),
      pct: `${Number(r.gst) || 0}`,
      cgst: money(half),
      sgst: money(half),
      igst: money(r.tax),
      total: money(r.total),
    };

    cols.forEach((c, n) => {
      if (n > 0) {
        pdf.setDrawColor(...HAIR);
        pdf.line(xs[n]!, y, xs[n]!, y + h);
        pdf.setDrawColor(...RULE);
      }
      if (c.key === "desc") {
        let dy = y + 3;
        for (const line of lines) {
          pdf.setFont("helvetica", line.strong ? "bold" : "normal").setFontSize(T_TINY);
          pdf.setTextColor(...(line.strong ? INK : MUTED));
          pdf.text(line.text, xs[n]! + 1.5, dy);
          dy += lineH;
        }
        return;
      }
      const text = cells[c.key] ?? "";
      if (!text) return;
      pdf.setFont("helvetica", "normal").setFontSize(T_TINY).setTextColor(...INK);
      pdf.text(text, cellX(c, xs[n]!), y + 3, { align: c.align });
    });

    y += h;
  });

  return y;
}

/** The totals row, under the columns it totals. */
function drawTotalsStrip(
  pdf: jsPDF,
  top: number,
  rows: ComputedRow[],
  totals: DocumentTotals,
  cols: Col[],
): number {
  const h = 5.6;
  const xs = colXs(cols);

  pdf.setFillColor(...TINT);
  pdf.rect(M, top, CW, h, "F");
  pdf.rect(M, top, CW, h);
  pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
  pdf.text("Total", M + 2, top + h / 2 + 0.85);

  const sums: Record<string, string> = {
    qty: qtyText(rows.reduce((s, r) => s + (Number(r.qty) || 0), 0)),
    basic: money(totals.gross),
    disc: (totals.discount || 0) > 0 ? money(totals.discount) : "",
    taxable: money(totals.taxable),
    cgst: money((totals.taxTotal || 0) / 2),
    sgst: money((totals.taxTotal || 0) / 2),
    igst: money(totals.taxTotal),
    total: money((totals.taxable || 0) + (totals.taxTotal || 0)),
  };

  cols.forEach((c, n) => {
    const text = sums[c.key];
    if (!text) return;
    pdf.text(text, cellX(c, xs[n]!), top + h / 2 + 0.85, { align: c.align });
  });

  return top + h;
}

/* ── the HSN summary ──────────────────────────────────────────────── */

const measureHsn = (model: DocumentModel): number =>
  model.hsnSummary ? 4.4 + (model.hsnSummary.rows.length + 1) * 3.8 + 1.2 : 0;

/**
 * The HSN/SAC summary, when the model has one.
 *
 * Tax is filed by HSN code, not by line, so these are the figures a
 * customer's accountant copies into a return. Already grouped and already
 * formatted by the model, which is why nothing is computed here.
 */
function drawHsnSummary(pdf: jsPDF, top: number, model: DocumentModel): number {
  const s = model.hsnSummary;
  if (!s) return top;

  const h = measureHsn(model);
  const headH = 4.4;
  const rowH = 3.8;
  const n = s.columns.length;
  /* The code column is read; the money columns are only checked. */
  const firstW = n > 1 ? Math.max(26, CW - (n - 1) * 24) : CW;
  const restW = n > 1 ? (CW - firstW) / (n - 1) : 0;
  const xOf = (i: number): number => (i === 0 ? M : M + firstW + restW * (i - 1));
  const wOf = (i: number): number => (i === 0 ? firstW : restW);

  pdf.rect(M, top, CW, h);
  pdf.setFillColor(...TINT);
  pdf.rect(M + 0.15, top + 0.15, CW - 0.3, headH - 0.3, "F");
  pdf.setFont("helvetica", "bold").setFontSize(T_TINY).setTextColor(...INK);
  s.columns.forEach((title, i) => {
    const right = i > 0;
    pdf.text(
      pdfSafeText(val(title)),
      right ? xOf(i) + wOf(i) - 1.5 : xOf(i) + 1.5,
      top + headH - 1.3,
      { align: right ? "right" : "left" },
    );
    if (i > 0) {
      pdf.setDrawColor(...HAIR);
      pdf.line(xOf(i), top, xOf(i), top + h);
      pdf.setDrawColor(...RULE);
    }
  });

  const body = [...s.rows, s.totalRow];
  let y = top + headH + rowH - 1.1;
  body.forEach((row, ri) => {
    const last = ri === body.length - 1;
    if (last) {
      pdf.setDrawColor(...HAIR);
      pdf.line(M, y - rowH + 1.1, A4.w - M, y - rowH + 1.1);
      pdf.setDrawColor(...RULE);
    }
    pdf.setFont("helvetica", last ? "bold" : "normal").setFontSize(T_TINY);
    pdf.setTextColor(...(last ? INK : MUTED));
    row.forEach((text, i) => {
      if (!val(text).trim()) return;
      const right = i > 0;
      pdf.text(pdfSafeText(val(text)), right ? xOf(i) + wOf(i) - 1.5 : xOf(i) + 1.5, y, {
        align: right ? "right" : "left",
      });
    });
    y += rowH;
  });

  return top + h;
}

/* ── the money block ──────────────────────────────────────────────── */

const MONEY_RIGHT = 64;

function measureMoney(pdf: jsPDF, model: DocumentModel): number {
  const lines = model.money.rows.filter((r) => val(r.value).trim());
  pdf.setFont("helvetica", "normal").setFontSize(T_TINY);
  const words = val(model.money.amountInWords)
    ? (pdf.splitTextToSize(
      pdfSafeText(val(model.money.amountInWords)),
      CW - MONEY_RIGHT - 4,
    ) as string[]).length
    : 0;
  const left = 7.4 + words * 3.1 + (model.isInvoice ? 5 : 0);
  const right = lines.length * 4.3 + 7.4;
  return Math.max(left, right, 20);
}

/** The amount in words on the left, the figures that make it on the right. */
function drawMoney(pdf: jsPDF, top: number, model: DocumentModel): number {
  const h = measureMoney(pdf, model);
  const leftW = CW - MONEY_RIGHT;

  pdf.rect(M, top, leftW, h);
  pdf.rect(M + leftW, top, MONEY_RIGHT, h);

  if (val(model.money.amountInWords)) {
    pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
    pdf.text("Amount in Words", M + 2, top + 3.9);
    pdf.setFont("helvetica", "normal").setFontSize(T_TINY).setTextColor(...MUTED);
    let wy = top + 7.4;
    for (const line of pdf.splitTextToSize(
      pdfSafeText(val(model.money.amountInWords)),
      leftW - 4,
    ) as string[]) {
      pdf.text(line, M + 2, wy);
      wy += 3.1;
    }
  }

  /* The declaration an invoice carries, and only an invoice: a quotation
     certifies nothing, it offers. */
  if (model.isInvoice) {
    pdf.setFont("helvetica", "normal").setFontSize(T_TINY).setTextColor(...MUTED);
    pdf.text("Certified that the particulars given above are true and correct.", M + 2, top + h - 2.2);
  }

  let ry = top + 4.2;
  for (const row of model.money.rows) {
    if (!val(row.value).trim()) continue;
    pdf.setFont("helvetica", "normal").setFontSize(T_SMALL).setTextColor(...MUTED);
    pdf.text(pdfSafeText(val(row.label)), M + leftW + 2, ry);
    pdf.setTextColor(...INK);
    pdf.text(pdfSafeText(val(row.value)), A4.w - M - 2, ry, { align: "right" });
    ry += 4.3;
  }

  const gh = 6.4;
  const gy = top + h - gh;
  pdf.setFillColor(...TINT);
  pdf.rect(M + leftW + 0.15, gy + 0.12, MONEY_RIGHT - 0.3, gh - 0.27, "F");
  pdf.setDrawColor(...RULE);
  pdf.line(M + leftW, gy, A4.w - M, gy);
  pdf.setFont("helvetica", "bold").setFontSize(T_BODY).setTextColor(...INK);
  pdf.text(pdfSafeText(model.money.grandLabel), M + leftW + 2, gy + gh / 2 + 1.05);
  pdf.text(pdfSafeText(model.money.grandValue), A4.w - M - 2, gy + gh / 2 + 1.05, {
    align: "right",
  });

  return top + h;
}

/* ── bank, terms and the signature ───────────────────────────────── */

const FOOT_RIGHT = 64;

function footLines(pdf: jsPDF, model: DocumentModel): { bank: Pair[]; terms: string[] } {
  const bank = (model.money.bank?.rows ?? []).filter(([, v]) => val(v).trim());
  pdf.setFont("helvetica", "normal").setFontSize(T_TINY);
  const terms: string[] = [];
  for (const t of model.money.terms.slice(0, 8)) {
    if (!val(t).trim()) continue;
    for (const line of pdf.splitTextToSize(
      pdfSafeText(`• ${val(t)}`),
      CW - FOOT_RIGHT - 4,
    ) as string[]) {
      terms.push(line);
    }
  }
  return { bank, terms };
}

function measureFoot(pdf: jsPDF, model: DocumentModel): number {
  const { bank, terms } = footLines(pdf, model);
  const bankH = bank.length ? bank.length * 3.3 + 5.6 : 0;
  const termsH = terms.length ? terms.length * 3 + 5.2 : 0;
  return Math.max(bankH + termsH + 1.6, 24);
}

function drawFoot(pdf: jsPDF, top: number, model: DocumentModel): number {
  const h = measureFoot(pdf, model);
  const leftW = CW - FOOT_RIGHT;
  const { bank, terms } = footLines(pdf, model);

  pdf.rect(M, top, leftW, h);
  pdf.rect(M + leftW, top, FOOT_RIGHT, h);

  let y = top + 4;
  if (bank.length) {
    pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
    pdf.text(pdfSafeText(val(model.money.bank?.heading) || "Remittance Details"), M + 2, y);
    y += 3.5;
    pdf.setFont("helvetica", "normal").setFontSize(T_TINY).setTextColor(...MUTED);
    for (const [label, value] of bank) {
      pdf.text(pdfSafeText(`${label} : ${val(value)}`), M + 2, y);
      y += 3.3;
    }
    y += 1.6;
  }

  if (terms.length) {
    pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
    pdf.text("Terms & Conditions", M + 2, y);
    y += 3.4;
    pdf.setFont("helvetica", "normal").setFontSize(T_TINY).setTextColor(...MUTED);
    for (const line of terms) {
      pdf.text(line, M + 2, y);
      y += 3;
    }
  }

  /* The signature cell: who is signing at the top, the rule near the
     bottom, and air between them for an actual signature. */
  const cx = M + leftW + FOOT_RIGHT / 2;
  pdf.setFont("helvetica", "bold").setFontSize(T_SMALL).setTextColor(...INK);
  pdf.text(pdfSafeText(val(model.signature.forLine)), cx, top + 4.2, { align: "center" });

  pdf.setDrawColor(...HAIR);
  pdf.line(M + leftW + 7, top + h - 7.4, A4.w - M - 7, top + h - 7.4);
  pdf.setDrawColor(...RULE);

  /* WHO SIGNED, then what they are. With no name configured there is one
     line, "Authorised Signatory", and not that phrase printed twice over
     itself as a name and again as a job title. */
  const name = val(model.signature.signatoryName).trim();
  const role = val(model.signature.signatoryDesignation).trim();
  const under = [name, name ? role : "", name ? "" : "Authorised Signatory"].filter(Boolean);
  let sy = top + h - 1.6 - (under.length - 1) * 2.8;
  under.forEach((line, i) => {
    pdf.setFont("helvetica", i === 0 ? "bold" : "normal").setFontSize(T_TINY);
    pdf.setTextColor(...(i === 0 ? INK : MUTED));
    pdf.text(pdfSafeText(line), cx, sy, { align: "center" });
    sy += 2.8;
  });

  return top + h;
}

/* ── the document QR ─────────────────────────────────────────────── */

/**
 * The CRM's own document code, drawn as merged runs rather than one
 * rectangle per module: adjacent rectangles leave hairline white seams
 * where the PDF rasterises their shared edge, and a phone reads those as
 * damage. Each run of dark modules in a row becomes one rectangle,
 * overlapping its neighbours by a fiftieth of a millimetre.
 *
 * The white field around it is not decoration either: a QR needs a quiet
 * zone to be found at all.
 */
function paintScan(pdf: jsPDF, payload: string, x: number, yTop: number, box: number): void {
  const quiet = 1.6;
  const size = box - quiet * 2;
  const modules = scanMatrix(payload);
  const n = modules.length;
  if (!n || size <= 0) return;
  const cell = size / n;

  pdf.setFillColor(255, 255, 255);
  pdf.rect(x, yTop, box, box, "F");
  pdf.setFillColor(...INK);
  for (let r = 0; r < n; r += 1) {
    const row = modules[r]!;
    let c = 0;
    while (c < n) {
      if (!row[c]) {
        c += 1;
        continue;
      }
      let run = 1;
      while (c + run < n && row[c + run]) run += 1;
      pdf.rect(x + quiet + c * cell, yTop + quiet + r * cell, cell * run + 0.02, cell + 0.02, "F");
      c += run;
    }
  }
}
