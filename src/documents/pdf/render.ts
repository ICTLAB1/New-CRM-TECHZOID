import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
import type { DocumentModel, LogoSlot, Pair } from "../../domain/documents/model";
import { fitBox } from "../../domain/documents/model";
import type { ComputedRow } from "../../domain/tax/types";
import { BASE_FONT_PT, PADDING_MM } from "../../domain/documents/columns";
import { hexToRgb, pdfSafeText } from "./text";

/**
 * The quotation / proforma PDF, per the approved TechZoid design.
 *
 * It owns GEOMETRY ONLY — millimetres, fonts, rules, page breaks. Every
 * decision about what the document SAYS comes from the DocumentModel, which
 * the on-screen preview reads too. That split is what stops the two drifting
 * apart; putting a label or a figure in here instead of the model re-opens
 * the bug that took a byte-level comparison to find.
 *
 * Verify changes by rendering to an image (pdftoppm) and LOOKING at it, at
 * 1, 5, 10, 20 and 50+ line items. Measuring coordinates programmatically
 * gave false results repeatedly — both false failures and missed real
 * problems.
 */

/* jspdf-autotable ships as CJS and its default export is not reliably a
   callable across bundler/node interop. applyPlugin() patches jsPDF's
   prototype; it is idempotent, but guard anyway. */
let pluginApplied = false;
function ensureAutoTable(): void {
  if (pluginApplied) return;
  applyPlugin(jsPDF);
  pluginApplied = true;
}

type PdfWithAutoTable = jsPDF & {
  autoTable: (options: Record<string, unknown>) => void;
  lastAutoTable: { finalY: number };
};

export interface ImageAsset { src: string; w: number; h: number }

export interface DocImages {
  logo?: ImageAsset | null;
  qr?: ImageAsset | null;
  /** Keyed by the brand name as it appears on a line item, lower-cased. */
  brands?: Record<string, ImageAsset>;
}

export interface RenderOptions {
  model: DocumentModel;
  rows: ComputedRow[];
  images?: DocImages;
}

const A4 = { w: 210, h: 297 };
const M = 13;
const CW = A4.w - M * 2;
/* The footer band's type. Its HEIGHT is not fixed — it is measured per
   document from the closing line, which wraps (see the render function).
   Reserving a fixed 20mm for a 12mm band cost a whole page on short
   quotations; reserving too little collided with the rule. */
const FOOT_SIZE = 6.6;
const FOOT_LINE = 2.6;
const FOOT_GAP = 4;

/* Palette, from the design tokens. */
const NAVY = hexToRgb("#0D2B55");
const INK = hexToRgb("#18202A");
const MUTED = hexToRgb("#64748B");
const BORDER = hexToRgb("#D7DCE2");
const HEAD_BG = hexToRgb("#F1F4F8");

export function renderDocumentPdf(opts: RenderOptions): jsPDF {
  const { model: m, rows } = opts;
  const images = opts.images ?? {};

  ensureAutoTable();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });

  /* Sanitise at the API boundary, once, rather than at every call site. */
  const origText = pdf.text.bind(pdf);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf.text = ((t: any, x: number, y2: number, o?: any) => origText(pdfSafeText(t), x, y2, o)) as typeof pdf.text;
  const origSplit = pdf.splitTextToSize.bind(pdf);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf.splitTextToSize = ((t: any, w: number, o?: any) => origSplit(pdfSafeText(t), w, o)) as typeof pdf.splitTextToSize;

  /* ── the footer band, measured before anything is laid out ──────────
     The closing line is a legal disclaimer of no fixed length, and the page
     number shares its baseline at the right edge. Both were drawn full-width
     — the closing centred on the page, the page number right-aligned — so a
     long closing ran straight through "Page 1 of 1".
     The page number's width is reserved, the closing wraps into what is
     left, and the band's height comes from the number of lines it actually
     takes. A FIXED reserve cannot be right for both: too small and a long
     closing overlaps or spills off the page, too large and every short
     document pays for space it never uses. */
  pdf.setFont("helvetica", "normal").setFontSize(FOOT_SIZE);
  /* Measured against a two-digit sample, because the real page count is not
     known until every page has been laid out. */
  const pageNoW = pdf.getTextWidth("Page 99 of 99");
  const closingW = Math.max(40, CW - pageNoW - FOOT_GAP * 2);
  const footLines: string[] = m.footer.closing
    ? (pdf.splitTextToSize(m.footer.closing, closingW) as string[])
    : [];
  /* Baseline of the LAST line, then up. 8mm from the foot of the page for
     one line, exactly as before, so a one-line closing is unchanged. */
  const footBase = A4.h - 8;
  const footTop = footBase - Math.max(0, footLines.length - 1) * FOOT_LINE;
  const footRule = footTop - 4;
  /* What content must stay clear of. */
  const footReserve = A4.h - footRule + 2;

  let y = M;

  const need = (mm: number): void => {
    if (y + mm > A4.h - footReserve) { pdf.addPage(); y = M; }
  };

  const rule = (yy: number, x1 = M, x2 = M + CW, colour = BORDER, width = 0.2): void => {
    pdf.setDrawColor(...colour).setLineWidth(width).line(x1, yy, x2, yy);
  };

  /** Label : value rows, as the details and party blocks use. */
  const colonRows = (list: readonly Pair[], x: number, w: number, top: number, labelW: number, fs = 7): number => {
    let ry = top;
    for (const [k, v] of list) {
      if (v === undefined || v === null || v === "") continue;
      pdf.setFont("helvetica", "normal").setFontSize(fs).setTextColor(...MUTED);
      pdf.text(k, x, ry);
      pdf.text(":", x + labelW, ry);
      pdf.setFont("helvetica", "bold").setFontSize(fs).setTextColor(...INK);
      const lines = pdf.splitTextToSize(String(v), w - labelW - 3) as string[];
      pdf.text(lines, x + labelW + 3, ry);
      ry += lines.length * (fs * 0.42) + 1.6;
    }
    return ry;
  };

  /* ─────────────────────────── header ─────────────────────────── */
  function drawHeader(): void {
    const top = y;
    const rightW = 74;
    const rightX = M + CW - rightW;

    /* From the model, not from `images` — the preview reads the same field,
       so the two cannot show different company logos. */
    const logo = m.header.logo;
    if (logo) {
      const box = fitBox(logo, 46, 12);
      pdf.addImage(logo.src, "PNG", M, y, box.w, box.h, undefined, "FAST");
      y += box.h + 3;
    }

    /* With no logo uploaded, the legal name IS the mark — set larger to
       carry the top of the page on its own. There used to be a fixed
       "TECHZOID" wordmark here above it, which printed the company's name
       twice and printed the WRONG name for anyone who changes it in
       Settings. */
    pdf.setFont("helvetica", "bold").setFontSize(logo ? 11 : 14).setTextColor(...NAVY);
    pdf.text(m.header.companyName.toUpperCase(), M, y + (logo ? 1 : 2));
    pdf.setFont("helvetica", "normal").setFontSize(7.4).setTextColor(...MUTED);
    pdf.text(m.header.tagline, M, y + (logo ? 6 : 7.5));
    let ly = y + (logo ? 11 : 12.5);

    pdf.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...MUTED);
    for (const line of m.header.addressLines) {
      pdf.text(line, M, ly);
      ly += 3.1;
    }
    if (m.header.contactLine) {
      pdf.text(m.header.contactLine, M, ly);
      ly += 3.4;
    }
    if (m.header.registration.length) {
      pdf.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...INK);
      pdf.text(m.header.registration.join("     "), M, ly);
      ly += 3.4;
    }
    const leftBottom = ly;

    /* Title, number plaque, then the date/validity/revision/currency rows. */
    pdf.setFont("helvetica", "bold").setFontSize(19).setTextColor(...NAVY);
    pdf.text(m.title, M + CW, top + 6, { align: "right" });

    pdf.setFillColor(...NAVY);
    pdf.rect(rightX, top + 9, rightW, 8, "F");
    pdf.setFont("helvetica", "bold").setFontSize(10).setTextColor(255, 255, 255);
    pdf.text(m.number, rightX + rightW / 2, top + 14.6, { align: "center" });

    const metaTop = top + 20;
    const metaEnd = colonRows(m.header.meta, rightX, rightW, metaTop, 24, 7.4);

    y = Math.max(leftBottom, metaEnd) + 3;
    rule(y, M, M + CW, NAVY, 0.7);
    y += 4;

    /* UAE office banner — a highlighted strip spanning the full width,
       directly under the navy rule, exactly as the reference shows it. */
    if (m.header.uaeOffice) {
      const hasReg = m.header.uaeOffice.regParts.length > 0;
      const bandH = hasReg ? 11 : 7;
      const textY = y + (hasReg ? 4.6 : 4.4);
      pdf.setFillColor(...HEAD_BG);
      pdf.rect(M, y, CW, bandH, "F");
      pdf.setDrawColor(...BORDER).setLineWidth(0.2).rect(M, y, CW, bandH, "S");
      pdf.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...NAVY);
      pdf.text("UAE OFFICE", M + 3, textY);
      pdf.setFont("helvetica", "normal").setFontSize(7).setTextColor(...INK);
      pdf.text(m.header.uaeOffice.addressLine, M + 26, textY);
      if (hasReg) {
        pdf.setFont("helvetica", "normal").setFontSize(6.6).setTextColor(...MUTED);
        pdf.text(m.header.uaeOffice.regParts.join("     "), M + 26, y + 8.6);
      }
      y += bandH + 4;
    }
  }

  /* ──────────────── details + bill to + ship to ──────────────── */
  function drawParties(): void {
    /* One column for the details, then one per party — two on a quotation
       (Bill To, Ship To), three on a purchase order (Supplier, Bill To,
       Ship To). Sized from the count rather than fixed at three, so adding
       a box narrows the grid instead of running off the page.

       The details column is the widest: at four columns of equal width its
       longest value, the document number, wrapped mid-token as
       "TZ/PO/2026-27/0 007". Parties wrap gracefully at a line ending; a
       reference number does not. The gap tightens too, which buys back
       another 3mm across the row. */
    const wide = m.parties.length > 2;
    const gap = wide ? 4 : 5;
    const detailsShare = wide ? 1.15 : 1;
    const unit = (CW - gap * m.parties.length) / (detailsShare + m.parties.length);
    const detailsW = unit * detailsShare;
    const colW = unit;
    const top = y;

    const detailsHeading = m.docType === "purchase_order"
      ? "PURCHASE ORDER DETAILS"
      : m.isProforma ? "INVOICE DETAILS" : "QUOTATION DETAILS";
    pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
    pdf.text(detailsHeading, M, top + 4);
    const detailsEnd = colonRows(m.details, M, detailsW, top + 10, detailsW * 0.4, 7.2);

    /* Each party: navy header bar over a bordered box. */
    const boxEnds: number[] = [];
    m.parties.forEach((party, i) => {
      const x = M + detailsW + gap + i * (colW + gap);
      pdf.setFillColor(...NAVY);
      pdf.rect(x, top, colW, 6.4, "F");
      pdf.setFont("helvetica", "bold").setFontSize(7.4).setTextColor(255, 255, 255);
      pdf.text(party.heading, x + 3, top + 4.4);

      let py = top + 11;
      pdf.setFont("helvetica", "bold").setFontSize(8.4).setTextColor(...INK);
      const nameLines = pdf.splitTextToSize(party.name, colW - 6) as string[];
      pdf.text(nameLines, x + 3, py);
      py += nameLines.length * 3.5 + 0.5;

      pdf.setFont("helvetica", "normal").setFontSize(7.2).setTextColor(...MUTED);
      for (const line of party.lines) {
        const wrapped = pdf.splitTextToSize(line, colW - 6) as string[];
        pdf.text(wrapped, x + 3, py);
        py += wrapped.length * 3.1;
      }
      py += 1.5;
      py = colonRows(party.rows, x + 3, colW - 6, py, colW * 0.3, 7);
      boxEnds.push(py);
    });

    const boxBottom = Math.max(...boxEnds, top + 24) + 2;
    pdf.setDrawColor(...BORDER).setLineWidth(0.2);
    m.parties.forEach((_, i) => {
      const x = M + detailsW + gap + i * (colW + gap);
      pdf.rect(x, top, colW, boxBottom - top, "S");
    });

    y = Math.max(detailsEnd, boxBottom) + 5;
  }

  /* ─────────────────── reference strip ─────────────────── */
  function drawReferences(): void {
    const cells = m.references;
    if (!cells.length) return;
    const colW = CW / cells.length;
    need(16);
    const top = y;

    pdf.setFillColor(...HEAD_BG);
    pdf.rect(M, top, CW, 6.2, "F");
    pdf.setDrawColor(...BORDER).setLineWidth(0.2);
    pdf.rect(M, top, CW, 13.4, "S");
    rule(top + 6.2);

    cells.forEach((cell, i) => {
      const x = M + i * colW;
      if (i > 0) pdf.line(x, top, x, top + 13.4);
      pdf.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...NAVY);
      pdf.text(cell.label.toUpperCase(), x + colW / 2, top + 4.2, { align: "center" });
      pdf.setFont("helvetica", "normal").setFontSize(7.4).setTextColor(...INK);
      const value = (pdf.splitTextToSize(cell.value, colW - 6) as string[])[0] ?? "";
      pdf.text(value, x + colW / 2, top + 10.6, { align: "center" });
    });

    y = top + 13.4 + 5;
  }

  /* ───────────────────────── items ───────────────────────── */
  function drawItems(): void {
    const cols = m.items.columns;

    const columnStyles: Record<number, Record<string, unknown>> = {};
    cols.forEach((cd, i) => {
      const style: Record<string, unknown> = {
        cellWidth: cd.w,
        halign: cd.align,
        fontSize: cd.fontSize,
        cellPadding: PADDING_MM[cd.pad],
      };
      if (cd.mono) style["font"] = "courier";
      /* The description is drawn plain and its first line redrawn bold in
         didDrawCell; bolding the whole cell would bold the specification. */
      if (cd.bold && cd.key !== "desc") style["fontStyle"] = "bold";
      if (cd.key === "desc") style["textColor"] = MUTED;
      if (cd.muted) style["textColor"] = MUTED;
      columnStyles[i] = style;
    });

    const brandIndex = cols.findIndex((c) => c.key === "brand");
    const descIndex = cols.findIndex((c) => c.key === "desc");
    const brands = images.brands ?? {};

    (pdf as PdfWithAutoTable).autoTable({
      startY: y,
      head: [cols.map((cd) => cd.head)],
      body: rows.map((row, i) => cols.map((cd) => pdfSafeText(cd.get(row, i)))),
      margin: { left: M, right: M, bottom: footReserve },
      /* The header repeats on every page — a continuation page of bare
         numbers is unreadable. */
      showHead: "everyPage",
      /* Keep a line item whole. Splitting one leaves a page opening with an
         orphaned "For 10 Users" against empty price columns, which reads as
         a broken row rather than a continued one. */
      rowPageBreak: "avoid",
      theme: "grid",
      styles: {
        font: "helvetica", fontSize: BASE_FONT_PT, cellPadding: PADDING_MM.default.left,
        lineColor: BORDER, lineWidth: 0.15, textColor: INK,
        valign: "middle", overflow: "linebreak",
      },
      headStyles: {
        fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.2,
        halign: "center", valign: "middle", lineWidth: 0.15, lineColor: NAVY,
      },
      columnStyles,
      /* A brand with an approved logo asset draws it, fitted inside the cell
         with its aspect ratio preserved. A brand without one keeps its name
         as text — never a fabricated badge. */
      didDrawCell: (data: Record<string, unknown>) => {
        const section = data["section"] as string;
        const column = data["column"] as { index: number };
        const cell = data["cell"] as {
          x: number; y: number; width: number; height: number; text: string[];
          styles: { fontSize: number; cellPadding: { top: number; left: number } };
        };
        if (section !== "body") return;

        /* The description cell: product name bold, specification beneath it
           lighter, as the design shows. autoTable styles a whole cell at
           once, so the text is drawn plain and the first line redrawn bold
           over a white patch.
           
           This runs for a one-line description too. It used to require a
           second line, so a product with no specification printed its NAME in
           the grey meant for specifications — while the preview showed it
           bold. */
        if (column.index === descIndex && cell.text.length > 0) {
          const fs = cell.styles.fontSize;
          const lead = fs * 0.3528 * 1.15;
          const px = cell.styles.cellPadding.left;
          const py = cell.styles.cellPadding.top;
          const first = cell.text[0] ?? "";
          const top = cell.y + py + (cell.height - py * 2 - cell.text.length * lead) / 2;
          pdf.setFillColor(255, 255, 255);
          pdf.rect(cell.x + px - 0.3, top - 0.2, cell.width - px * 2 + 0.6, lead + 0.4, "F");
          pdf.setFont("helvetica", "bold").setFontSize(fs).setTextColor(...INK);
          pdf.text(first, cell.x + px, top + lead * 0.72);
          return;
        }

        if (column.index !== brandIndex) return;
        const name = (cell.text.join(" ") || "").trim().toLowerCase();
        const asset = brands[name];
        if (!asset) return;
        const box = fitBox(asset, cell.width - 4, cell.height - 3);
        pdf.setFillColor(255, 255, 255);
        pdf.rect(cell.x + 0.4, cell.y + 0.4, cell.width - 0.8, cell.height - 0.8, "F");
        pdf.addImage(
          asset.src, "PNG",
          cell.x + (cell.width - box.w) / 2,
          cell.y + (cell.height - box.h) / 2,
          box.w, box.h, undefined, "FAST",
        );
      },
    });
    y = (pdf as PdfWithAutoTable).lastAutoTable.finalY + 5;
  }

  /* ──────────────── terms (left) + summary (right) ──────────────── */
  function drawMoneyBlock(): void {
    const sumW = 78;
    const sumX = M + CW - sumW;
    const leftW = CW - sumW - 7;
    const rowH = 5.6;
    const TERM_LEAD = 2.75;
    const TERM_GAP = 0.6;

    /* Measure BOTH columns before deciding where the block goes. Sizing the
       break from the summary alone let a fourteen-clause terms column run
       straight off the bottom of the page — 306mm on a 297mm sheet. */
    pdf.setFont("helvetica", "normal").setFontSize(6.2);
    const wrappedTerms = m.money.terms.map((t) => pdf.splitTextToSize(t, leftW - 6) as string[]);
    const termsH = wrappedTerms.length
      ? 9 + wrappedTerms.reduce((a, lines) => a + lines.length * TERM_LEAD + TERM_GAP, 0)
      : 0;

    const summaryRows = m.money.rows.length + (m.money.advance ? 1 : 0);
    const wordsH = m.money.amountInWords ? 14 : 0;
    const summaryH = 6.4 + summaryRows * rowH + 9 + wordsH + 3;

    const usable = A4.h - M - footReserve;
    /* Keep the block whole when it can be: a grand total stranded alone on
       the next page is the one part of this document nobody may have to hunt
       for. When the terms alone are taller than a page they flow instead —
       clipping is never the answer. */
    if (Math.max(summaryH, termsH) <= usable) need(Math.max(summaryH, termsH));
    else need(summaryH);

    const top = y;

    /* ── summary ── */
    pdf.setFillColor(...HEAD_BG);
    pdf.rect(sumX, top, sumW, 6.4, "F");
    pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
    pdf.text("SUMMARY", sumX + 3, top + 4.4);

    let sy = top + 6.4;
    const line = (label: string, value: string, bold = false): void => {
      const tone = bold ? INK : MUTED;
      pdf.setFont("helvetica", bold ? "bold" : "normal").setFontSize(7.4).setTextColor(...tone);
      pdf.text(label, sumX + 3, sy + 3.9);
      pdf.setFont("courier", bold ? "bold" : "normal").setFontSize(7.4).setTextColor(...INK);
      pdf.text(value, sumX + sumW - 3, sy + 3.9, { align: "right" });
      sy += rowH;
      rule(sy, sumX, sumX + sumW);
    };

    for (const r of m.money.rows) line(r.label, r.value);
    if (m.money.advance) line(m.money.advance.label, m.money.advance.value, true);

    pdf.setFillColor(...NAVY);
    pdf.rect(sumX, sy, sumW, 9, "F");
    pdf.setFont("helvetica", "bold").setFontSize(8.4).setTextColor(255, 255, 255);
    pdf.text(m.money.grandLabel.toUpperCase(), sumX + 3, sy + 5.9);
    pdf.setFont("courier", "bold").setFontSize(9);
    pdf.text(m.money.grandValue, sumX + sumW - 3, sy + 5.9, { align: "right" });
    sy += 9;

    if (m.money.amountInWords) {
      pdf.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...NAVY);
      pdf.text("Amount in Words:", sumX + 3, sy + 4.5);
      pdf.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...INK);
      const words = pdf.splitTextToSize(m.money.amountInWords, sumW - 6) as string[];
      pdf.text(words, sumX + 3, sy + 8);
      sy += 8 + words.length * 2.9 + 2;
    }
    pdf.setDrawColor(...BORDER).setLineWidth(0.2).rect(sumX, top, sumW, sy - top, "S");

    /* ── terms / bank details, flowing if they outgrow the page ── */
    let ly = top;
    if (wrappedTerms.length) {
      pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
      pdf.text("TERMS & CONDITIONS", M, ly + 4.4);
      ly += 9;
      wrappedTerms.forEach((lines, i) => {
        const h = lines.length * TERM_LEAD + TERM_GAP;
        if (ly + h > A4.h - footReserve) {
          pdf.addPage();
          ly = M;
          sy = M;
          pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
          pdf.text("TERMS & CONDITIONS (continued)", M, ly + 4.4);
          ly += 9;
        }
        pdf.setFont("helvetica", "normal").setFontSize(6.2).setTextColor(...INK);
        pdf.text(`${i + 1}.`, M, ly);
        pdf.text(lines, M + 5.5, ly);
        ly += h;
      });
    } else if (m.money.bank) {
      pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
      pdf.text(m.money.bank.heading, M, ly + 4.4);
      ly = colonRows(m.money.bank.rows, M, leftW, ly + 10, 26, 7);
      if (images.qr) {
        const box = fitBox(images.qr, 20, 20);
        pdf.addImage(images.qr.src, "PNG", M + leftW - box.w, top + 9, box.w, box.h, undefined, "FAST");
      }
    }

    y = Math.max(sy, ly) + 4;
  }

  /* ─────────────────── HSN / SAC summary ─────────────────── */
  function drawHsnSummary(): void {
    if (!m.hsnSummary) return;
    const { columns, rows, totalRow } = m.hsnSummary;

    need(10 + (rows.length + 1) * 6);
    pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
    pdf.text("HSN / SAC SUMMARY", M, y + 4.4);
    y += 8;

    const columnStyles: Record<number, Record<string, unknown>> = {};
    columns.forEach((_, i) => {
      columnStyles[i] = { halign: i === 0 ? "left" : i === 2 ? "center" : "right" };
    });

    (pdf as PdfWithAutoTable).autoTable({
      startY: y,
      head: [columns],
      body: rows,
      foot: [totalRow],
      margin: { left: M, right: M, bottom: footReserve },
      showHead: "everyPage",
      theme: "grid",
      styles: {
        font: "helvetica", fontSize: 7, cellPadding: 1.6,
        lineColor: BORDER, lineWidth: 0.15, textColor: INK, valign: "middle",
      },
      headStyles: { fillColor: HEAD_BG, textColor: NAVY, fontStyle: "bold", fontSize: 6.6 },
      footStyles: { fillColor: HEAD_BG, textColor: INK, fontStyle: "bold", fontSize: 7 },
      columnStyles,
    });
    y = (pdf as PdfWithAutoTable).lastAutoTable.finalY + 5;
  }

  /* ─────────────────── bank details (quotation only) ─────────────────── *
   * A proforma already carries these beside its terms column, inside
   * drawMoneyBlock — this is only for a quotation, which has no terms
   * column to share the space with. */
  function drawBankDetails(): void {
    if (m.isProforma || !m.money.bank) return;
    const bank = m.money.bank;
    need(10 + bank.rows.length * 5);
    pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
    pdf.text(bank.heading, M, y + 4.4);
    y = colonRows(bank.rows, M, CW * 0.5, y + 10, 30, 7) + 4;
  }

  /* ─────────────────────── signature block ─────────────────────── */
  function drawSignature(): void {
    /* Sized from the number of fields, not fixed: a purchase order's
       acknowledgement asks for four (it wants the signatory's designation
       too), and at a fixed height the last field's rule ran through the
       "Company Seal" label. */
    const fieldCount = m.signature.acceptance?.fields.length ?? 0;
    const boxH = m.signature.acceptance ? 8 + fieldCount * 7 + 5 : 26;
    need(boxH);
    const top = y;

    if (m.signature.acceptance) {
      const accW = CW * 0.55;
      pdf.setDrawColor(...BORDER).setLineWidth(0.2).rect(M, top, accW, boxH, "S");
      pdf.setFont("helvetica", "bold").setFontSize(7.2).setTextColor(...NAVY);
      pdf.text(m.signature.acceptance.heading.toUpperCase(), M + 3, top + 5);
      let fy = top + 11;
      pdf.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...MUTED);
      for (const field of m.signature.acceptance.fields) {
        pdf.text(field + ":", M + 3, fy);
        rule(fy + 1, M + 20, M + accW - 3);
        fy += 7;
      }
      pdf.setFont("helvetica", "italic").setFontSize(6.2).setTextColor(...MUTED);
      pdf.text(m.signature.acceptance.sealLabel, M + accW - 3, top + boxH - 3, { align: "right" });
    }

    /* "For {company}", a blank band for a physical signature and seal, then
       the signatory's line — drawn unconditionally, since a document leaves
       the building without ever having had this printed at all. */
    pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
    pdf.text(m.signature.forLine, M + CW, top + 5, { align: "right" });

    const lineY = top + boxH - 8;
    rule(lineY, M + CW - 62, M + CW);
    pdf.setFont("helvetica", "bold").setFontSize(7).setTextColor(...INK);
    pdf.text(m.signature.signatoryName || "Authorised Signatory", M + CW, lineY + 4, { align: "right" });
    if (m.signature.signatoryName && m.signature.signatoryDesignation) {
      pdf.setFont("helvetica", "normal").setFontSize(6.4).setTextColor(...MUTED);
      pdf.text(m.signature.signatoryDesignation, M + CW, lineY + 7.4, { align: "right" });
    }

    y = top + boxH + 4;
  }

  /* ─────────────────── partner / ISO strips ─────────────────── */
  /**
   * Shrink a string until it fits.
   *
   * `mode` matters: text drawn on ONE line must be measured whole, and text
   * allowed to wrap need only fit its longest word. Measuring the longest
   * word for a single-line label let "ISO/IEC 27001:2022" — two words that
   * each fit — run straight into the next certification's ring.
   */
  function fitFont(text: string, maxW: number, start: number, mode: "line" | "wrap", floor = 3.4): number {
    let size = start;
    while (size > floor) {
      pdf.setFontSize(size);
      const measured = mode === "line"
        ? pdf.getTextWidth(text)
        : Math.max(...text.split(/\s+/).map((w) => pdf.getTextWidth(w)));
      if (measured <= maxW) break;
      size -= 0.15;
    }
    return size;
  }

  function drawStrips(): void {
    const groups = [
      { title: "TECHNOLOGY PARTNER DESIGNATIONS", slots: m.strips.designations, flex: 1.05 },
      { title: "OUR TECHNOLOGY PARTNERS", slots: m.strips.partners, flex: 1.15 },
      { title: "CERTIFIED MANAGEMENT SYSTEMS", slots: m.strips.certifications, flex: 1.5 },
    ].filter((g) => g.slots.length);
    if (!groups.length) return;

    const stripH = 20;
    need(stripH + 3);
    const top = y;
    const totalFlex = groups.reduce((a, g) => a + g.flex, 0);

    pdf.setDrawColor(...BORDER).setLineWidth(0.2).rect(M, top, CW, stripH, "S");

    let x = M;
    groups.forEach((group, gi) => {
      const w = (CW * group.flex) / totalFlex;
      if (gi > 0) pdf.line(x, top, x, top + stripH);

      pdf.setFont("helvetica", "bold").setFontSize(5.8).setTextColor(...NAVY);
      pdf.text(group.title, x + w / 2, top + 4, { align: "center" });

      const slotW = w / group.slots.length;
      const bandTop = top + 6;
      const bandH = stripH - 7;
      const isCertGroup = group.title === "CERTIFIED MANAGEMENT SYSTEMS";

      group.slots.forEach((slot: LogoSlot, si) => {
        const sx = x + si * slotW;
        const cx = sx + slotW / 2;

        if (slot.src) {
          /* Approved artwork, fitted with its aspect ratio preserved. */
          /* Without a natural size the aspect ratio is unknown, so fall back
             to filling the box rather than guessing and distorting. */
          const natural = slot.w && slot.h ? { w: slot.w, h: slot.h } : null;
          /* Cap the height well below the band. Fitting to the full band let
             a square mark (HP) render at twice the optical weight of a wide
             one (Acer) beside it, which reads as favouritism rather than as
             aspect ratio being preserved. */
          const box = fitBox(natural, slotW - 5, Math.min(bandH - 2, 8.5));
          pdf.addImage(slot.src, "PNG", cx - box.w / 2, bandTop + (bandH - box.h) / 2, box.w, box.h, undefined, "FAST");
          return;
        }

        if (isCertGroup) {
          /* Plain, text-only presentation — the standard's name, and its
             licence/certificate number beneath, centred. No ring: the
             approved reference shows certifications this way, not as a
             medallion. */
          pdf.setFont("helvetica", "bold").setTextColor(...NAVY);
          pdf.setFontSize(fitFont(slot.text, slotW - 3, 6.2, "wrap", 4.2));
          const titleLines = (pdf.splitTextToSize(slot.text, slotW - 3) as string[]).slice(0, 2);
          const titleY = bandTop + bandH / 2 + (slot.certNo ? -1.4 : 0.8) - (titleLines.length > 1 ? 1 : 0);
          pdf.text(titleLines, cx, titleY, { align: "center" });
          if (slot.certNo) {
            pdf.setFont("helvetica", "normal").setFontSize(5.6).setTextColor(...MUTED);
            pdf.text(slot.certNo, cx, titleY + titleLines.length * 2.6 + 1.8, { align: "center" });
          }
          return;
        }

        /* No asset and not a certification: the name, shrunk to fit rather
           than broken mid-word. */
        pdf.setFont("helvetica", "bold").setTextColor(...INK);
        pdf.setFontSize(fitFont(slot.text, slotW - 3, 6.4, "wrap", 4.2));
        const lines = pdf.splitTextToSize(slot.text, slotW - 3) as string[];
        pdf.text(lines.slice(0, 2), cx, bandTop + bandH / 2 + (lines.length > 1 ? -0.8 : 0.8), { align: "center" });
      });
      x += w;
    });

    y = top + stripH + 3;
  }

  /* ───────────────────────── compose ───────────────────────── */
  drawHeader();
  drawParties();
  drawReferences();
  drawItems();
  drawMoneyBlock();
  drawHsnSummary();
  drawBankDetails();
  drawStrips();
  drawSignature();

  /* Closing line and page numbers, stamped on every page inside the band
     measured above — so they cannot collide with content, or with each
     other. The closing is centred within ITS OWN column, which stops short
     of the page number rather than spanning the full page. */
  const pages = pdf.getNumberOfPages();
  const closingCx = M + closingW / 2;
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    rule(footRule);
    pdf.setFont("helvetica", "normal").setFontSize(FOOT_SIZE).setTextColor(...MUTED);
    footLines.forEach((line, li) => {
      pdf.text(line, closingCx, footTop + li * FOOT_LINE, { align: "center" });
    });
    /* On the last line, so a wrapped closing does not leave it floating
       alone at the top of the band. */
    pdf.text(`Page ${i} of ${pages}`, A4.w - M, footBase, { align: "right" });
  }

  return pdf;
}

/** Filename v1 produced, kept identical so saved documents match. */
export function documentFilename(m: DocumentModel): string {
  /* The kind first, then the customer-facing number — "Quotation-TZ-QT-...".
     Sorting a folder of these groups them by kind, which is how anyone
     receiving several of them wants them grouped. It carries the number the
     customer can quote back, never an internal id.

     Slashes and the rest are replaced because a document number contains
     them and a filename cannot. */
  const kind = m.isPurchaseOrder ? "Purchase-Order"
    : m.isInvoice ? "Tax-Invoice"
    : m.isProforma ? "Proforma-Invoice"
    : "Quotation";
  return `${kind}-${m.number.replace(/[\\/:*?"<>|\s]/g, "-")}.pdf`;
}
