import { documentFilename, renderDocumentPdf, type RenderOptions } from "./render";

/**
 * Getting a rendered document out of the browser.
 *
 * The same render, three destinations — saved to disk, attached to an email,
 * opened in a tab. They share one function so a PDF that is emailed is
 * byte-for-byte the one that was downloaded; generating "the same" document
 * twice through two code paths is how the emailed copy quietly drifts.
 */

export interface DeliverableDocument {
  filename: string;
  /** Base64 without the data: prefix, which is what every mail API wants. */
  base64: string;
  blob: Blob;
}

export function buildPdf(opts: RenderOptions): DeliverableDocument {
  const pdf = renderDocumentPdf(opts);
  const dataUri = pdf.output("datauristring");
  return {
    filename: documentFilename(opts.model),
    base64: dataUri.slice(dataUri.indexOf(",") + 1),
    blob: pdf.output("blob"),
  };
}

/** Save it. The browser names the file; we only choose what that name is. */
export function downloadPdf(opts: RenderOptions): string {
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
export function previewPdf(opts: RenderOptions): void {
  const { blob } = buildPdf(opts);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const pdfAttachment = (opts: RenderOptions): { base64: string; filename: string } => {
  const { base64, filename } = buildPdf(opts);
  return { base64, filename };
};
