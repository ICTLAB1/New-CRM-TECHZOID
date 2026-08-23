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
/* The closing line sits at A4.h-8 above a rule at A4.h-12, so content may
   run to A4.h-14 and no further. Reserving 20mm for a 12mm band cost a whole
   page on short quotations; reserving too little collided with the rule. */
const FOOT_RESERVE = 14;

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

  let y = M;

  const need = (mm: number): void => {
    if (y + mm > A4.h - FOOT_RESERVE) { pdf.addPage(); y = M; }
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

    if (images.logo) {
      const box = fitBox(images.logo, 46, 12);
      pdf.addImage(images.logo.src, "PNG", M, y, box.w, box.h, undefined, "FAST");
      y += box.h + 3;
    } else {
      pdf.setFont("helvetica", "bold").setFontSize(20).setTextColor(...NAVY);
      pdf.text("TECHZOID", M, y + 7);
      y += 11;
    }

    pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(...NAVY);
    pdf.text(m.header.companyName.toUpperCase(), M, y + 1);
    pdf.setFont("helvetica", "normal").setFontSize(7.4).setTextColor(...MUTED);
    pdf.text(m.header.tagline, M, y + 6);
    const leftBottom = y + 8;

    /* Title, number plaque, then the date/validity/currency rows. */
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
    y += 5;
  }

  /* ──────────────── details + bill to + ship to ──────────────── */
  function drawParties(): void {
    const gap = 5;
    const colW = (CW - gap * 2) / 3;
    const top = y;

    pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
    pdf.text(m.isProforma ? "INVOICE DETAILS" : "QUOTATION DETAILS", M, top + 4);
    const detailsEnd = colonRows(m.details, M, colW, top + 10, colW * 0.45, 7.2);

    /* Bill To / Ship To: navy header bar over a bordered box. */
    const boxEnds: number[] = [];
    m.parties.slice(0, 2).forEach((party, i) => {
      const x = M + (i + 1) * (colW + gap);
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
    m.parties.slice(0, 2).forEach((_, i) => {
      const x = M + (i + 1) * (colW + gap);
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
      if (cd.bold) style["fontStyle"] = "bold";
      if (cd.muted) style["textColor"] = MUTED;
      columnStyles[i] = style;
    });

    const brandIndex = cols.findIndex((c) => c.key === "brand");
    const brands = images.brands ?? {};

    (pdf as PdfWithAutoTable).autoTable({
      startY: y,
      head: [cols.map((cd) => cd.head)],
      body: rows.map((row, i) => cols.map((cd) => pdfSafeText(cd.get(row, i)))),
      margin: { left: M, right: M, bottom: FOOT_RESERVE },
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
        const cell = data["cell"] as { x: number; y: number; width: number; height: number; text: string[] };
        if (section !== "body" || column.index !== brandIndex) return;
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

    const usable = A4.h - M - FOOT_RESERVE;
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
        if (ly + h > A4.h - FOOT_RESERVE) {
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

  /* ─────────────────── partner / ISO strips ─────────────────── */
  /** The ISO ring, drawn rather than pasted: the supplied badge PNGs had the
   *  number overflowing its circle and colliding with the caption. */
  function drawMedallion(cx: number, cy: number, r: number, number: string): void {
    pdf.setDrawColor(...NAVY).setLineWidth(0.45);
    pdf.circle(cx, cy, r, "S");
    pdf.setLineWidth(0.18);
    pdf.circle(cx, cy, r - 0.7, "S");
    pdf.setFont("helvetica", "bold").setFontSize(r * 1.5).setTextColor(...NAVY);
    pdf.text("ISO", cx, cy - r * 0.05, { align: "center" });
    /* The number has to live inside the ring — shrink until it does. */
    let size = r * 0.78;
    while (size > 2) {
      pdf.setFontSize(size);
      /* The chord available at the number's height, not the full diameter —
         measuring against the diameter let the widest standard touch the
         inner ring. */
      if (pdf.getTextWidth(number) <= (r - 0.7) * 1.35) break;
      size -= 0.15;
    }
    pdf.text(number, cx, cy + r * 0.55, { align: "center" });
  }

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
    /* The design pack asks for the partner, certification and footer blocks
       to stay together. Reserving only the strip's own height left a page
       carrying nothing but the company footer. */
    need(stripH + 3 + measureFooter().height);
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

        if (slot.medallion) {
          /* Ring on the left, standard and scope to its right. */
          const r = 3.1;
          const textX = sx + 2 + r * 2 + 1.5;
          const textW = slotW - (textX - sx) - 2;
          drawMedallion(sx + 2 + r, bandTop + bandH / 2, r, slot.medallion);

          pdf.setFont("helvetica", "bold").setTextColor(...NAVY);
          pdf.setFontSize(fitFont(slot.text, textW, 5.6, "line"));
          pdf.text(slot.text, textX, bandTop + 4.6);

          if (slot.caption) {
            /* The scope must print in full. Truncating it turns "Quality
               Management System" into "Quality Management", which names a
               different thing from the certificate. Shrink and use the whole
               band rather than dropping the last word. */
            pdf.setFont("helvetica", "normal").setTextColor(...MUTED);
            let capSize = 4.4;
            let lines: string[] = [];
            const maxLines = 3;
            while (capSize > 3) {
              pdf.setFontSize(capSize);
              lines = pdf.splitTextToSize(slot.caption, textW) as string[];
              if (lines.length <= maxLines) break;
              capSize -= 0.15;
            }
            pdf.text(lines.slice(0, maxLines), textX, bandTop + 8);
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

  /* ─────────────────────────── footer ─────────────────────────── */
  /** Column geometry and measured height of the footer, computed before
   *  anything is placed so the strips can reserve room for both. */
  function measureFooter() {
    const nameW = CW * 0.44;
    const contactX = M + nameW + 4;
    const contactW = CW * 0.26;
    const regX = contactX + contactW + 4;
    const regW = M + CW - regX - (images.qr ? 20 : 0);

    pdf.setFont("helvetica", "bold").setFontSize(7.6);
    const nameLines = pdf.splitTextToSize(m.footer.companyName.toUpperCase(), nameW) as string[];
    pdf.setFont("helvetica", "normal").setFontSize(6.6);
    const addressWrapped = m.footer.addressLines.map((l) => pdf.splitTextToSize(l, nameW) as string[]);
    const contactWrapped = m.footer.contactBits.map((b) => pdf.splitTextToSize(b, contactW) as string[]);

    const leftH = nameLines.length * 3.4 + 1 + addressWrapped.reduce((a, w) => a + w.length * 2.9, 0);
    const contactH = contactWrapped.reduce((a, w) => a + w.length * 3.2, 0);
    const regH = m.footer.registration.length * 3.9;
    const height = 5 + Math.max(leftH, contactH, regH, images.qr ? 17 : 0) + 2;

    return { nameW, contactX, contactW, regX, regW, nameLines, addressWrapped, contactWrapped, height };
  }

  function drawFooter(): void {
    /* Explicit column widths. Drawing the legal name from the left margin
       with no bound ran it straight through the phone number in the next
       column — the company name is long and the columns were even thirds. */
    const { contactX, regX, regW, nameLines, addressWrapped, contactWrapped, height } = measureFooter();

    need(height);
    rule(y, M, M + CW, NAVY, 0.5);
    y += 5;
    const top = y;

    pdf.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(...NAVY);
    pdf.text(nameLines, M, top);
    let ay = top + nameLines.length * 3.4 + 1;

    pdf.setFont("helvetica", "normal").setFontSize(6.6).setTextColor(...MUTED);
    for (const wrapped of addressWrapped) {
      pdf.text(wrapped, M, ay);
      ay += wrapped.length * 2.9;
    }

    let cy = top;
    for (const wrapped of contactWrapped) {
      pdf.text(wrapped, contactX, cy);
      cy += wrapped.length * 3.2;
    }

    /* A CIN is 21 characters and must not wrap: give the value the room it
       needs and keep the label narrow. */
    const regEnd = colonRows(m.footer.registration, regX, regW, top, 10, 6.6);

    if (images.qr) {
      const box = fitBox(images.qr, 17, 17);
      pdf.addImage(images.qr.src, "PNG", M + CW - box.w, top - 3, box.w, box.h, undefined, "FAST");
    }

    y = Math.max(ay, cy, regEnd) + 2;
  }

  /* ───────────────────────── compose ───────────────────────── */
  drawHeader();
  drawParties();
  drawReferences();
  drawItems();
  drawMoneyBlock();
  drawStrips();
  drawFooter();

  /* Closing line and page numbers, stamped on every page at a fixed height
     so they cannot collide with content. */
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    rule(A4.h - 12);
    pdf.setFont("helvetica", "normal").setFontSize(6.6).setTextColor(...MUTED);
    pdf.text(m.footer.closing, A4.w / 2, A4.h - 8, { align: "center" });
    pdf.text(`Page ${i} of ${pages}`, A4.w - M, A4.h - 8, { align: "right" });
  }

  return pdf;
}

/** Filename v1 produced, kept identical so saved documents match. */
export function documentFilename(m: DocumentModel): string {
  return (
    m.number.replace(/[\\/:*?"<>|]/g, "-") +
    (m.isProforma ? " - Proforma Invoice" : " - Quotation") +
    ".pdf"
  );
}
