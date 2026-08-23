import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";

/* jspdf-autotable ships as CJS and its default export is not reliably a
   callable across bundler/node interop — v1 hit this too and resolved it the
   same way. applyPlugin() patches jsPDF's prototype, giving every document a
   .autoTable() method; it is idempotent, but guard anyway. */
let pluginApplied = false;
function ensureAutoTable(): void {
  if (pluginApplied) return;
  applyPlugin(jsPDF);
  pluginApplied = true;
}

/** jsPDF with the autoTable plugin attached. */
type PdfWithAutoTable = jsPDF & {
  autoTable: (options: Record<string, unknown>) => void;
  lastAutoTable: { finalY: number };
};
import type { DocumentModel, LogoCell, Pair } from "../../domain/documents/model";
import type { ComputedRow } from "../../domain/tax/types";
import { fitBox, packLogoRows, rowWidth } from "../../domain/documents/model";
import { BASE_FONT_PT, PADDING_MM } from "../../domain/documents/columns";
import type { SectionKey } from "../../domain/documents/template";
import { hexToRgb, pdfSafeText } from "./text";

/**
 * The native PDF renderer.
 *
 * It owns GEOMETRY ONLY — millimetres, fonts, line weights, page breaks.
 * Every decision about what the document SAYS comes from the DocumentModel,
 * which the on-screen preview reads too. That split is what stops the two
 * drifting apart; putting a label or a figure in here instead of the model
 * re-opens the bug.
 *
 * Verify changes by rendering the PDF to an image (pdftoppm) and LOOKING at
 * it. Measuring coordinates programmatically gave false results repeatedly —
 * both false failures and missed real problems.
 */

/** Images the renderer draws, resolved by the caller (they need a DOM to
 *  measure, which this module deliberately does not require). */
export interface DocImages {
  logo?: { src: string; w: number; h: number } | null;
  signature?: { src: string; w: number; h: number } | null;
  stamp?: { src: string; w: number; h: number } | null;
  upiQr?: { src: string; w: number; h: number } | null;
  partnerLogos?: { src: string; w: number; h: number }[];
  certLogos?: { src: string; w: number; h: number }[];
}

export interface RenderOptions {
  model: DocumentModel;
  /** The computed line items. Cells are produced by the model's own column
   *  getters, so the PDF and the preview format every figure identically. */
  rows: ComputedRow[];
  images?: DocImages;
  yearsOfExcellence?: string;
}

const A4 = { w: 210, h: 297 };
const MARGIN = 13;
const BOTTOM_RESERVE = 16; // room for the page-number line

const DARK: [number, number, number] = [26, 26, 26];
const GREY: [number, number, number] = [85, 85, 85];
const LGREY: [number, number, number] = [119, 119, 119];
const LINE: [number, number, number] = [200, 200, 200];
const LIGHT: [number, number, number] = [242, 242, 242];

export function renderDocumentPdf(opts: RenderOptions): jsPDF {
  const { model: m } = opts;
  const images = opts.images ?? {};
  const ACCENT = hexToRgb(m.accentColor);

  ensureAutoTable();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });

  /* Sanitise at the API boundary, once, rather than at every call site. */
  const origText = pdf.text.bind(pdf);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf.text = ((text: any, x: number, y2: number, o?: any) => origText(pdfSafeText(text), x, y2, o)) as typeof pdf.text;
  const origSplit = pdf.splitTextToSize.bind(pdf);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf.splitTextToSize = ((text: any, w: number, o?: any) => origSplit(pdfSafeText(text), w, o)) as typeof pdf.splitTextToSize;

  const M = MARGIN;
  const CW = A4.w - M * 2;
  let y = M;

  const newPageIfNeeded = (need: number): void => {
    if (y + need > A4.h - BOTTOM_RESERVE) {
      pdf.addPage();
      y = M;
    }
  };

  /** Label : value rows, the pattern used by the party grid and bank box. */
  const colonRows = (rows: readonly Pair[], x: number, w: number, startY: number, labelW: number, fs: number): number => {
    let ry = startY;
    rows.forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      pdf.setFont("helvetica", "normal").setFontSize(fs).setTextColor(...GREY);
      pdf.text(String(k), x, ry);
      pdf.text(":", x + labelW, ry);
      pdf.setFont("helvetica", "bold").setFontSize(fs).setTextColor(...DARK);
      const vw = pdf.splitTextToSize(String(v), w - labelW - 3) as string[];
      pdf.text(vw, x + labelW + 3, ry);
      ry += vw.length * (fs * 0.42) + 1.1;
    });
    return ry;
  };

  /* ───────────────────────────── header ───────────────────────────── */
  function drawHeader(): void {
    const headTop = y;
    const logoMaxW = Math.max(20, CW * 0.25);
    const gutter = Math.max(3, CW * 0.022);
    const infoX = M + logoMaxW + gutter;
    const metaW = Math.max(38, CW * 0.38);
    const metaX = M + CW - metaW;
    const infoW = Math.max(24, metaX - infoX - gutter);

    const logo = images.logo;
    const logoBox = logo ? fitBox(logo, logoMaxW, 15) : { w: logoMaxW, h: 15 };
    if (logo) {
      pdf.addImage(logo.src, "PNG", M, y, logoBox.w, logoBox.h, undefined, "FAST");
    } else {
      pdf.setFont("helvetica", "bold").setFontSize(15).setTextColor(...DARK);
      pdf.text("TECHZOID", M, y + 6);
      pdf.setFont("helvetica", "normal").setFontSize(5.5).setTextColor(...LGREY);
      pdf.text("TECHNOLOGIES PVT. LTD.", M, y + 9.5);
    }

    let iy = y + 3;
    pdf.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...DARK);
    pdf.text(m.header.companyName, infoX, iy);
    iy += 4;
    pdf.setFont("helvetica", "normal").setFontSize(7).setTextColor(...GREY);
    if (m.header.addressLine) {
      const w = pdf.splitTextToSize(m.header.addressLine, infoW) as string[];
      pdf.text(w, infoX, iy);
      iy += w.length * 3;
    }
    m.header.contactLines.forEach((v) => {
      pdf.text(v, infoX, iy);
      iy += 3.2;
    });

    if (m.header.uaeOffice) {
      iy += 1.5;
      pdf.setDrawColor(...LINE).setLineWidth(0.15).line(infoX, iy, infoX + infoW, iy);
      iy += 4;
      pdf.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...DARK);
      pdf.text(m.header.uaeOffice.name, infoX, iy);
      iy += 4;
      pdf.setFont("helvetica", "normal").setFontSize(7).setTextColor(...GREY);
      const uw = pdf.splitTextToSize(m.header.uaeOffice.lines, infoW) as string[];
      pdf.text(uw, infoX, iy);
      iy += uw.length * 3 + 1;
    }

    const certLogos = images.certLogos ?? [];
    const isoLines = certLogos.length ? [] : m.header.isoLines;
    if (certLogos.length || isoLines.length) {
      iy += 1.5;
      pdf.setDrawColor(...LINE).setLineWidth(0.15).line(infoX, iy, infoX + infoW, iy);
      iy += 4;
      if (certLogos.length) {
        let cx = infoX;
        certLogos.forEach((cl) => {
          const box = fitBox(cl, 14, 6.5);
          if (cx + box.w > infoX + infoW) {
            cx = infoX;
            iy += 8;
          }
          pdf.addImage(cl.src, "PNG", cx, iy - 5, box.w, box.h, undefined, "FAST");
          cx += box.w + 5;
        });
        if (isoLines.length) iy += 3;
      }
      isoLines.forEach((l) => {
        pdf.setFont("helvetica", "normal").setFontSize(6).setTextColor(...LGREY);
        const w = pdf.splitTextToSize("• " + l, infoW) as string[];
        pdf.text(w, infoX, iy);
        iy += w.length * 2.8;
      });
      iy += 2;
    }

    pdf.setFont("helvetica", "bold").setFontSize(17).setTextColor(...ACCENT);
    pdf.text(m.title, M + CW, y + 5, { align: "right" });

    let my = y + 10;
    m.header.meta.forEach(([k, v]) => {
      pdf.setFont("helvetica", "normal").setFontSize(7).setTextColor(...GREY);
      pdf.text(String(k), metaX, my, { align: "left" });
      pdf.setFont("helvetica", "bold").setFontSize(7).setTextColor(...DARK);
      pdf.text(String(v), metaX + metaW, my, { align: "right" });
      my += 3.9;
    });

    y = Math.max(headTop + logoBox.h, iy, my) + 6;

    if (m.header.registrationParts.length) {
      pdf.setDrawColor(...LINE).setLineWidth(0.25).line(M, y, M + CW, y);
      y += 4.5;
      pdf.setFont("courier", "bold").setFontSize(7.5).setTextColor(...DARK);
      let rx = M;
      m.header.registrationParts.forEach((p, i) => {
        if (i > 0) {
          pdf.setTextColor(...LINE);
          pdf.text("|", rx, y);
          rx += 4;
          pdf.setTextColor(...DARK);
        }
        pdf.text(p, rx, y);
        rx += pdf.getTextWidth(p) + 4;
      });
      y += 3;
      pdf.setDrawColor(...LINE).setLineWidth(0.25).line(M, y, M + CW, y);
      y += 7;
    } else {
      y += 3;
    }
  }

  /* ───────────────────────────── parties ──────────────────────────── */
  function drawParties(): void {
    const colW = (CW - 24) / 3;
    const partyBoxTop = y;
    let maxPartyY = y + 6;

    m.parties.forEach((col, i) => {
      const x = M + i * (colW + 12) + 3;
      const startY = y + 5;
      pdf.setFont("helvetica", "bold").setFontSize(6.6).setTextColor(...DARK);
      pdf.text(col.heading.toUpperCase(), x, startY);
      let py = startY + 5;
      pdf.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...DARK);
      const nameW = pdf.splitTextToSize(col.name, colW) as string[];
      pdf.text(nameW, x, py);
      py += nameW.length * 3.3 + 1;
      pdf.setFont("helvetica", "normal").setFontSize(7).setTextColor(...GREY);
      col.lines.forEach((l) => {
        const w = pdf.splitTextToSize(l, colW) as string[];
        pdf.text(w, x, py);
        py += w.length * 3;
      });
      py += 1;
      py = colonRows(col.rows, x, colW, py, colW * 0.36, 6.6);
      maxPartyY = Math.max(maxPartyY, py);
    });

    const boxH = maxPartyY - partyBoxTop + 4;
    pdf.setDrawColor(...LINE).setLineWidth(0.25);
    pdf.rect(M, partyBoxTop, CW, boxH, "S");
    pdf.line(M + colW + 6, partyBoxTop, M + colW + 6, partyBoxTop + boxH);
    pdf.line(M + 2 * colW + 18, partyBoxTop, M + 2 * colW + 18, partyBoxTop + boxH);
    y = partyBoxTop + boxH + 6;
  }

  /* ────────────────────────────── intro ───────────────────────────── */
  function drawIntro(): void {
    if (m.intro.salutation) {
      pdf.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...GREY);
      pdf.text(m.intro.salutation, M, y);
      y += 3.6;
      const iw = pdf.splitTextToSize(m.intro.body ?? "", CW) as string[];
      pdf.text(iw, M, y);
      y += iw.length * 3.3 + 4;
    }
    if (m.intro.subject) {
      pdf.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...GREY);
      pdf.text("Subject:", M, y);
      pdf.setFont("helvetica", "bold").setFontSize(8).setTextColor(...DARK);
      const sw = pdf.splitTextToSize(m.intro.subject, CW - 16) as string[];
      pdf.text(sw, M + 14, y);
      y += sw.length * 3.6 + 4;
    }
  }

  /* ────────────────────────────── items ───────────────────────────── */
  function drawItems(): void {
    const cols = m.items.columns;

    /* Every metric here comes from the shared column definition — width,
       type size, padding, alignment. Deriving any of them locally is how the
       PDF and the preview drift; it also cost a mid-number wrap in the
       narrow Disc. and Tax % columns, caught only by rendering and looking. */
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
      if (cd.muted) style["textColor"] = GREY;
      columnStyles[i] = style;
    });

    (pdf as PdfWithAutoTable).autoTable({
      startY: y,
      head: [cols.map((cd) => cd.head)],
      body: opts.rows.map((row, i) => cols.map((cd) => pdfSafeText(cd.get(row, i)))),
      margin: { left: M, right: M, bottom: BOTTOM_RESERVE + 4 },
      theme: "grid",
      styles: {
        font: "helvetica", fontSize: BASE_FONT_PT, cellPadding: PADDING_MM.default.left,
        lineColor: LINE, lineWidth: 0.15, textColor: [40, 40, 40],
        valign: "middle", overflow: "linebreak",
      },
      headStyles: {
        fillColor: LIGHT, textColor: DARK, fontStyle: "bold", fontSize: 6,
        halign: "center", lineWidth: 0.2, lineColor: [190, 190, 190], valign: "middle",
      },
      columnStyles,
    });

    (pdf as PdfWithAutoTable).autoTable({
      startY: y,
      head: [cols.map((cd) => cd.head)],
      body: opts.rows.map((row, i) => cols.map((cd) => pdfSafeText(cd.get(row, i)))),
      margin: { left: M, right: M, bottom: BOTTOM_RESERVE + 4 },
      theme: "grid",
      styles: {
        font: "helvetica", fontSize: 6.6, cellPadding: 1.6,
        lineColor: LINE, lineWidth: 0.15, textColor: [40, 40, 40],
        valign: "middle", overflow: "linebreak",
      },
      headStyles: {
        fillColor: LIGHT, textColor: DARK, fontStyle: "bold", fontSize: 6,
        halign: "center", lineWidth: 0.2, lineColor: [190, 190, 190], valign: "middle",
      },
      columnStyles,
    });
    y = (pdf as PdfWithAutoTable).lastAutoTable.finalY + 6;
  }

  /* ──────────────────────── terms + totals ────────────────────────── */
  function drawMoneyBlock(): void {
    const totW = 62;
    const totX = M + CW - totW;
    const rowH = 5.4;
    const leftW = CW - totW - 10;

    const bankRowsCount = m.money.bank?.rows.length ?? 0;
    const bankBoxEstH = bankRowsCount ? 6 + bankRowsCount * 4 + 3 : 0;
    const totalsBlockH = Math.max(
      m.money.rows.length * rowH + 7 + (m.money.advance ? 8 : 0) + 10,
      bankBoxEstH,
    );
    newPageIfNeeded(totalsBlockH);
    const blockTop = y;

    let ty = blockTop;
    m.money.rows.forEach((r) => {
      pdf.setDrawColor(...LINE).setLineWidth(0.15);
      pdf.rect(totX, ty, totW, rowH, "S");
      pdf.setFont("helvetica", "normal").setFontSize(7).setTextColor(...GREY);
      pdf.text(r.label, totX + 2.5, ty + 3.7);
      pdf.setFont("courier", "normal").setFontSize(7).setTextColor(...DARK);
      pdf.text(r.value, totX + totW - 2.5, ty + 3.7, { align: "right" });
      ty += rowH;
    });

    pdf.setFillColor(239, 239, 239).setDrawColor(...ACCENT).setLineWidth(0.3);
    pdf.rect(totX, ty, totW, 7.5, "FD");
    pdf.setFont("helvetica", "bold").setFontSize(8).setTextColor(...ACCENT);
    pdf.text(m.money.grandLabel, totX + 2.5, ty + 5);
    pdf.setFont("courier", "bold").setFontSize(8.5);
    pdf.text(m.money.grandValue, totX + totW - 2.5, ty + 5, { align: "right" });
    ty += 7.5;

    if (m.money.advance) {
      pdf.setFillColor(247, 247, 247).setDrawColor(200, 200, 200).setLineWidth(0.2);
      pdf.rect(totX, ty + 1, totW, 7, "FD");
      pdf.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...DARK);
      pdf.text(m.money.advance.label, totX + 2.5, ty + 5.3);
      pdf.setFont("courier", "bold").setFontSize(7.3);
      pdf.text(m.money.advance.value, totX + totW - 2.5, ty + 5.3, { align: "right" });
      ty += 9;
    }

    let wordLines: string[] = [""];
    if (m.money.amountInWords) {
      pdf.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...DARK);
      pdf.text("Amount in Words:", totX, ty + 4);
      pdf.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...GREY);
      wordLines = pdf.splitTextToSize(m.money.amountInWords, totW) as string[];
      pdf.text(wordLines, totX, ty + 7.5);
    }

    let ly = blockTop;
    if (m.money.terms.length) {
      pdf.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...DARK);
      pdf.text("TERMS & CONDITIONS", M, ly);
      ly += 4.2;
      pdf.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(50, 50, 50);
      m.money.terms.forEach((tm, i) => {
        pdf.text(i + 1 + ".", M, ly);
        const w = pdf.splitTextToSize(tm, leftW - 6) as string[];
        pdf.text(w, M + 5, ly);
        ly += w.length * 3 + 0.8;
      });
    } else if (m.money.bank) {
      const qrSize = images.upiQr ? 20 : 0;
      const bankBoxH = 6 + m.money.bank.rows.length * 4 + 3;
      const bTop = ly;
      pdf.setDrawColor(...LINE).setLineWidth(0.2).rect(M, bTop, leftW, bankBoxH, "S");
      pdf.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...DARK);
      pdf.text(m.money.bank.heading, M + 3, bTop + 5);
      colonRows(m.money.bank.rows, M + 3, leftW - (qrSize ? qrSize + 8 : 6), bTop + 9.5, 26, 6.8);
      if (qrSize && images.upiQr) {
        pdf.addImage(images.upiQr.src, "PNG", M + leftW - qrSize - 4, bTop + 6, qrSize, qrSize, undefined, "FAST");
      }
      ly = bTop + bankBoxH;
    }

    y = Math.max(ty + wordLines.length * 3 + 6, ly) + 4;
  }

  /* ────────────────────────────── notes ───────────────────────────── */
  function drawNotes(): void {
    if (!m.notes.length) return;
    newPageIfNeeded(4 + m.notes.length * 3.2);
    pdf.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...DARK);
    pdf.text("NOTES", M, y);
    y += 4.2;
    pdf.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(50, 50, 50);
    m.notes.forEach((n) => {
      pdf.text("•", M, y);
      const w = pdf.splitTextToSize(n, CW - 5) as string[];
      pdf.text(w, M + 4, y);
      y += w.length * 3 + 0.6;
    });
    y += 3;
  }

  /* ──────────────────────────── signature ─────────────────────────── */
  function drawSignature(): void {
    newPageIfNeeded(38);
    const sigTop = y;
    pdf.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(...DARK);
    pdf.text(m.signature.forLine, M, sigTop);
    let sy = sigTop + 3;
    if (images.signature) {
      const box = fitBox(images.signature, 32, 12);
      pdf.addImage(images.signature.src, "PNG", M, sy, box.w, box.h, undefined, "FAST");
      sy += box.h + 2;
    } else {
      sy += 12;
    }
    pdf.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(...DARK);
    pdf.text(m.signature.signatoryName || " ", M, sy);
    pdf.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...LGREY);
    pdf.text(m.signature.signatoryDesignation, M, sy + 3.3);
    if (images.stamp) {
      const box = fitBox(images.stamp, 22, 22);
      pdf.addImage(images.stamp.src, "PNG", M + 40, sigTop + 2, box.w, box.h, undefined, "FAST");
    }

    if (m.signature.acceptance) {
      const accX = M + CW - 90;
      pdf.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(...DARK);
      pdf.text(m.signature.acceptance.heading, accX, sigTop);
      let ay = sigTop + 6;
      m.signature.acceptance.fields.forEach((l) => {
        pdf.setFont("helvetica", "normal").setFontSize(7).setTextColor(...GREY);
        pdf.text(l, accX, ay);
        pdf.text(":", accX + 18, ay);
        pdf.setDrawColor(150, 150, 150).setLineWidth(0.2).line(accX + 21, ay + 0.5, accX + 62, ay + 0.5);
        ay += 6.5;
      });
      pdf.setDrawColor(...LINE).setLineWidth(0.2).rect(M + CW - 20, sigTop + 4, 20, 15, "S");
      pdf.setFont("helvetica", "normal").setFontSize(5.8).setTextColor(...LGREY);
      pdf.text(m.signature.acceptance.sealLabel, M + CW - 10, sigTop + 22, { align: "center" });
    } else if (m.signature.weAccept) {
      const wax = M + CW;
      pdf.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...DARK);
      pdf.text(m.signature.weAccept.label, wax, sigTop + 2, { align: "right" });
      let mx = wax;
      pdf.setFont("helvetica", "normal").setFontSize(6.5);
      m.signature.weAccept.methods.forEach((method) => {
        const w = pdf.getTextWidth(method) + 6;
        pdf.setDrawColor(...LINE).setLineWidth(0.2).roundedRect(mx - w, sigTop + 5, w, 6.5, 1, 1, "S");
        pdf.setTextColor(70, 70, 70);
        pdf.text(method, mx - w / 2, sigTop + 9.2, { align: "center" });
        mx -= w + 3;
      });
    }
    y = Math.max(sy + 5, sigTop + 26) + 4;
  }

  /* ─────────────────────────── logo strip ─────────────────────────── */
  function drawLogos(): void {
    const GAP = 5.5;
    const cells: LogoCell[] = (images.partnerLogos ?? []).map((l) => {
      const box = fitBox(l, 26, 13);
      return { type: "image", src: l.src, w: box.w, h: box.h };
    });
    if (opts.yearsOfExcellence) cells.push({ type: "years", w: 26, h: 13, years: opts.yearsOfExcellence });
    if (!cells.length) return;

    const rows = packLogoRows(cells, CW, GAP);
    const rowH = 18;
    newPageIfNeeded(8 + rows.length * rowH);
    pdf.setDrawColor(...LINE).setLineWidth(0.25).line(M, y, M + CW, y);
    y += 8;

    rows.forEach((row) => {
      let lx = M + (CW - rowWidth(row, GAP)) / 2;
      row.forEach((cell, i) => {
        if (i > 0) {
          pdf.setDrawColor(220, 220, 220).setLineWidth(0.2);
          pdf.line(lx, y - 3, lx, y + 11);
          lx += GAP;
        }
        if (cell.type === "image" && cell.src) {
          pdf.addImage(cell.src, "PNG", lx, y, cell.w, cell.h, undefined, "FAST");
        } else if (cell.type === "years") {
          const cx = lx + cell.w / 2;
          pdf.setFont("helvetica", "bold").setFontSize(9).setTextColor(...DARK);
          pdf.text(String(cell.years), cx, y + 4, { align: "center" });
          pdf.setFont("helvetica", "normal").setFontSize(4.8).setTextColor(...LGREY);
          pdf.text("Years of", cx, y + 7, { align: "center" });
          pdf.text("Excellence", cx, y + 9.5, { align: "center" });
        }
        lx += cell.w;
      });
      y += rowH;
    });
  }

  /* ────────────────────────────── footer ──────────────────────────── */
  function drawFooter(): void {
    newPageIfNeeded(14);
    pdf.setDrawColor(...LINE).setLineWidth(0.25).line(M, y, M + CW, y);
    y += 5;
    pdf.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...GREY);
    pdf.text(m.footer.contactBits.join("     |     "), M + CW / 2, y, { align: "center" });
    y += 5;
    pdf.setFont("helvetica", "bold").setFontSize(7.3).setTextColor(...GREY);
    pdf.text(m.footer.closing, M + CW / 2, y, { align: "center" });
  }

  /* ──────────────────────── section dispatch ──────────────────────── */
  const sectionFns: Record<SectionKey, () => void> = {
    header: drawHeader,
    parties: drawParties,
    intro: drawIntro,
    items: drawItems,
    moneyBlock: drawMoneyBlock,
    notes: drawNotes,
    signature: drawSignature,
    logos: drawLogos,
    footer: drawFooter,
  };
  m.sectionOrder.forEach((key) => sectionFns[key]?.());

  /* ─────────────────────────── page numbers ───────────────────────── */
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal").setFontSize(6.3).setTextColor(160, 160, 160);
    pdf.text(m.number + "   ·   Page " + i + " of " + pages, A4.w - M, A4.h - 7, { align: "right" });
    pdf.text(m.header.companyName, M, A4.h - 7);
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
