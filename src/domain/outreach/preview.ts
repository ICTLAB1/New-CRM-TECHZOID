import { renderSignature } from "./signature";

/**
 * The body, as the recipient's mail client will draw it.
 *
 * A twin of renderHtml in netlify/lib/outreachRender.mjs — the same markers,
 * the same table, the same order of body then signature then unsubscribe —
 * so the composer shows what arrives rather than an approximation. The
 * parity test in netlify/lib/outreachSignature.test.mjs pins the signature
 * half; this half is pinned by preview.test.ts.
 *
 * WHY A SECOND COPY AT ALL. The renderer that matters lives in a Netlify
 * function, and the browser cannot import it. Every alternative was worse:
 * asking the server for a preview means a round trip on every keystroke, and
 * showing plain text means the one thing a writer wants to check — whether
 * the highlight and the bold landed — is the one thing the preview cannot
 * tell them.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The four markers a writer gets.
 *
 *   **bold**            the line that has to land
 *   _italic_            an aside
 *   ==highlight==       the one question worth answering, in yellow
 *   [text](https://…)   https only
 *
 * Escaped first, then only these shapes allowed back through — so nothing a
 * writer types, and nothing interpolated from a prospect's own details, can
 * introduce markup.
 */
export function inlineFormat(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/==([^=]+)==/g,
    '<mark style="background:#fff2a8;color:inherit;padding:1px 2px;">$1</mark>');
  out = out.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
    (_m, label: string, href: string) =>
      `<a href="${href}" style="color:#2563eb;text-decoration:underline;">${label}</a>`);
  return out.replace(/\n/g, "<br />");
}

/** The markers, removed — what the plain-text part of the email carries. */
export function stripMarkers(text: string): string {
  return String(text ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, "$1$2")
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, "$1 ($2)");
}

/** Body, signature, then the unsubscribe line — the order the email uses. */
export function previewHtml(body: string, signature = ""): string {
  const paragraphs = String(body ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;">${inlineFormat(p)}</p>`)
    .join("");

  const footer =
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">` +
    `If you would rather not hear from us, <a href="#" style="color:#6b7280;">unsubscribe</a>.</p>`;

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">` +
    `<tr><td align="left" style="padding:24px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">` +
    `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111827;">` +
    paragraphs + (signature || "") + footer +
    `</td></tr></table></td></tr></table>`
  );
}

export { renderSignature };
