import qrcode from "qrcode-generator";

/**
 * THE CODE PRINTED ON EVERY DOCUMENT, AND WHAT THE CRM DOES WITH IT.
 *
 * WHAT IS ENCODED: the document's own number, exactly as it is printed on
 * the face of the page — "TZ/QT/2026-27/0042" — and nothing else.
 *
 * It is worth saying why, because a URL was the obvious alternative and is
 * the wrong answer here:
 *
 *  - LENGTH IS PRINT QUALITY. A document number fits a 25-module QR; the
 *    same number inside a URL, with its slashes percent-encoded, needs 37
 *    or 41. At the 18mm square this page can spare, that is the difference
 *    between 0.7mm modules and 0.45mm ones — and these documents are
 *    printed, signed, photocopied and scanned back before anyone points a
 *    camera at them.
 *
 *  - A URL DATES. Encode crm.ttpldelhi.com today and every document in the
 *    customer's filing cabinet depends on that hostname answering for as
 *    long as the paper exists. The number is the company's own identifier
 *    and does not expire.
 *
 *  - NOTHING IS LEAKED. The number is already printed in 10pt beside it.
 *    A link that opens a document is a credential; a number is not.
 *
 * What it costs: a phone's built-in camera shows the number as text rather
 * than offering to open anything. Scanning it IN THE CRM — which is what
 * was asked for — opens the document.
 *
 * The parser is deliberately generous about what it accepts, because it
 * serves the manual-entry box in the scanner as well as the camera: a
 * number typed with spaces, a whole URL from some future version, or a
 * code read off a document printed by a different system.
 */

/** What goes into the square. */
export function scanPayload(number: string | null | undefined): string {
  return String(number ?? "").trim();
}

/**
 * A document number out of whatever was scanned or typed.
 *
 * Accepts the payload above, a URL carrying ?doc= or /d/<number> (so a
 * code from a later version still resolves), and a number typed by hand.
 * Returns null for anything that cannot be a document number, so the
 * scanner can say "that is not one of ours" rather than searching for it.
 */
export function parseScan(text: string | null | undefined): string | null {
  let raw = String(text ?? "").trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const fromQuery = url.searchParams.get("doc") || url.searchParams.get("no");
      const fromPath = /\/d\/([^/?#]+)/.exec(url.pathname)?.[1];
      raw = decodeURIComponent(fromQuery || fromPath || "").trim();
    } catch {
      return null;
    }
    if (!raw) return null;
  }

  /* Collapse the spaces a person types around the slashes, and drop a
     trailing full stop pasted in from a sentence. Nothing else is
     changed: the number is matched against what is stored. */
  const cleaned = raw.replace(/\s+/g, "").replace(/[.,;]+$/, "");
  if (cleaned.length < 3 || cleaned.length > 64) return null;
  /* A document number is letters, digits and the separators this CRM
     builds them from. Anything else — a vCard, a UPI string, a URL that
     carried no document — is not one. */
  if (!/^[A-Za-z0-9/\-_]+$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * The QR as a square grid of booleans, true where a module is dark.
 *
 * Built here rather than in each renderer so the PDF and the on-screen
 * preview draw the same square — the preview is what people check before
 * sending, and a preview that shows a code the file does not carry is
 * worse than no preview.
 *
 * Error correction M: 15% of the square can be lost and it still reads.
 * That is the level chosen for printed documents that get stamped, and it
 * is what leaves room for the signature to stray over a corner.
 */
export function scanMatrix(payload: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/** The caption under the square, so the code is readable by a person too. */
export const SCAN_CAPTION = "Scan in the CRM";
