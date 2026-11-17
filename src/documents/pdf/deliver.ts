import type { DocumentTotals } from "../../domain/tax/types";
import { renderBoxedPdf } from "./boxed";
import { documentFilename, renderDocumentPdf, type RenderOptions } from "./render";

/**
 * Getting a rendered document out of the browser.
 *
 * The same render, three destinations — saved to disk, attached to an email,
 * opened in a tab. They share one function so a PDF that is emailed is
 * byte-for-byte the one that was downloaded; generating "the same" document
 * twice through two code paths is how the emailed copy quietly drifts.
 */

/**
 * What a destination needs to produce the document.
 *
 * `totals` is only read by the boxed layout, which draws CGST and SGST or
 * IGST — two different tables — from the one place that has already worked
 * out which it is. It is optional so that nothing which only ever prints
 * the standard sheet has to carry it, and WITHOUT IT A BOXED MODEL PRINTS
 * THE STANDARD SHEET rather than a boxed one with guessed tax columns. A
 * document in the wrong house style is a surprise; a document with the
 * wrong tax columns is one an auditor rejects.
 */
export interface DeliverOptions extends RenderOptions {
  totals?: DocumentTotals;
}

export interface DeliverableDocument {
  filename: string;
  /** Base64 without the data: prefix, which is what every mail API wants. */
  base64: string;
  blob: Blob;
}

export function buildPdf(opts: DeliverOptions): DeliverableDocument {
  const pdf = opts.model.layout === "boxed" && opts.totals
    ? renderBoxedPdf({
      model: opts.model, rows: opts.rows, totals: opts.totals, images: opts.images,
    })
    : renderDocumentPdf(opts);
  const dataUri = pdf.output("datauristring");
  return {
    filename: documentFilename(opts.model),
    base64: dataUri.slice(dataUri.indexOf(",") + 1),
    blob: pdf.output("blob"),
  };
}

/** Save it. The browser names the file; we only choose what that name is. */
export function downloadPdf(opts: DeliverOptions): string {
  const { blob, filename } = buildPdf(opts);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  /* Revoked on the next turn of the event loop: revoking immediately can
     cancel the download in some browsers. */
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

/** Open it in a new tab, for a look before sending. */
export function previewPdf(opts: DeliverOptions): void {
  const { blob } = buildPdf(opts);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const pdfAttachment = (opts: DeliverOptions): { base64: string; filename: string } => {
  const { base64, filename } = buildPdf(opts);
  return { base64, filename };
};
