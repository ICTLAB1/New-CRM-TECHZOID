/**
 * Turning a written email into HTML that survives Outlook.
 *
 * WHY THIS IS NOT JUST innerHTML. Outlook on Windows renders with Microsoft
 * Word's engine. It ignores most of what a browser does happily: no flexbox,
 * no grid, no `max-width` on a div, no `<style>` block it respects reliably,
 * no web fonts, no background images. A composer that produces
 * browser-shaped HTML produces email that looks correct to whoever wrote it
 * and broken to the customer — which is the worst possible failure, because
 * nobody in the company ever sees it.
 *
 * So: TABLES for layout, INLINE styles on every element, a system font
 * stack, and a fixed pixel width. It is 2005 HTML on purpose.
 *
 * There is no JavaScript, no `<form>`, no external stylesheet and no remote
 * font. Those are stripped by every serious client and their presence is a
 * spam signal in itself.
 */

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#1f2933";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const WIDTH = 600;   /* The width every client and every phone handles. */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type BlockKind = "paragraph" | "bullets" | "numbers" | "button" | "divider" | "signature";

export interface Block {
  kind: BlockKind;
  text?: string;
  items?: string[];
  /** Button only. */
  label?: string;
  href?: string;
}

export interface Branding {
  companyName: string;
  logoUrl?: string | null;
  accentColor?: string;
  addressLines?: string[];
  website?: string;
}

export interface EmailDoc {
  subject: string;
  preheader?: string;
  blocks: Block[];
  branding: Branding;
  /** §12. Every outreach email carries one; a campaign refuses to send
   *  without it. */
  unsubscribeUrl?: string;
  unsubscribeNote?: string;
}

const p = (text: string): string =>
  `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:23px;color:${INK};">${inline(text)}</p>`;

/**
 * The small amount of formatting a writer gets, as literal markers rather
 * than a rich-text editor's HTML.
 *
 * A contenteditable produces whatever the browser feels like — `<b>` here,
 * `<span style="font-weight:700">` there, and a `<div>` for every line in
 * Chrome. Accepting that as email HTML means accepting Chrome's opinion of
 * markup as the thing Outlook has to render. Markers are boring, predictable
 * and cannot smuggle a script in.
 */
export function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, "$1<em>$2</em>");
  /* [text](https://…) — https only. A mailto: or javascript: link built from
     a template variable is how a composer becomes an attack surface. */
  out = out.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
    (_m, label: string, href: string) =>
      `<a href="${href}" style="color:#2563eb;text-decoration:underline;">${label}</a>`);
  return out.replace(/\n/g, "<br />");
}

function list(items: readonly string[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const rows = items.map((i) =>
    `<li style="margin:0 0 8px 0;font-family:${FONT};font-size:15px;line-height:23px;color:${INK};">${inline(i)}</li>`
  ).join("");
  return `<${tag} style="margin:0 0 16px 0;padding-left:22px;">${rows}</${tag}>`;
}

/**
 * A button, as a table.
 *
 * A styled <a> collapses to plain underlined text in Outlook — the padding
 * and background are simply dropped. Wrapping it in a one-cell table is the
 * only construction that keeps its shape everywhere, which is why every
 * serious email template does this and it looks like overkill.
 */
function button(label: string, href: string, accent: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
<tr><td align="center" bgcolor="${escapeHtml(accent)}" style="border-radius:4px;">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 22px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

const divider = () =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;"><tr><td style="border-top:1px solid ${RULE};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;

function renderBlock(b: Block, accent: string): string {
  switch (b.kind) {
    case "paragraph":  return p(b.text ?? "");
    case "bullets":    return list(b.items ?? [], false);
    case "numbers":    return list(b.items ?? [], true);
    case "button":     return b.href && b.label ? button(b.label, b.href, accent) : "";
    case "divider":    return divider();
    case "signature":  return `<div style="margin:22px 0 0 0;font-family:${FONT};font-size:14px;line-height:21px;color:${INK};">${inline(b.text ?? "")}</div>`;
    default:           return "";
  }
}

/** The full document. */
export function renderEmailHtml(doc: EmailDoc): string {
  const accent = doc.branding.accentColor || "#2563eb";
  const body = doc.blocks.map((b) => renderBlock(b, accent)).join("\n");

  const logo = doc.branding.logoUrl
    ? `<img src="${escapeHtml(doc.branding.logoUrl)}" alt="${escapeHtml(doc.branding.companyName)}" width="150" style="display:block;border:0;max-width:150px;height:auto;" />`
    : `<div style="font-family:${FONT};font-size:17px;font-weight:bold;color:${INK};">${escapeHtml(doc.branding.companyName)}</div>`;

  const footerLines = [
    ...(doc.branding.addressLines ?? []),
    doc.branding.website ?? "",
  ].filter(Boolean).map((l) => escapeHtml(l)).join("<br />");

  const unsubscribe = doc.unsubscribeUrl
    ? `<p style="margin:12px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
${escapeHtml(doc.unsubscribeNote || "If you would rather not hear from us, you can")}
<a href="${escapeHtml(doc.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline;">unsubscribe</a>.</p>`
    : "";

  /* The preheader is the grey line a client shows after the subject. Hidden
     in the body itself, then padded — without the padding, whatever text
     follows leaks into that preview line. */
  const preheader = doc.preheader
    ? `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(doc.preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`
    : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(doc.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f5f7;">
<tr><td align="center" style="padding:24px 12px;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}" style="width:${WIDTH}px;max-width:100%;background-color:#ffffff;border:1px solid ${RULE};border-radius:6px;">
<tr><td style="padding:26px 30px 0 30px;">${logo}</td></tr>
<tr><td style="padding:22px 30px 4px 30px;">
${body}
</td></tr>
<tr><td style="padding:0 30px 26px 30px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top:1px solid ${RULE};padding-top:14px;">
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">${footerLines}</p>
${unsubscribe}
</td></tr></table>
</td></tr>
</table>

</td></tr></table>
</body>
</html>`;
}

/**
 * The plain-text alternative.
 *
 * Not an afterthought: a multipart message without one is a mild spam
 * signal, and some corporate gateways strip HTML entirely and deliver
 * whatever text part exists. If that part is empty the customer receives a
 * blank email from you.
 */
export function renderPlainText(doc: EmailDoc): string {
  const lines: string[] = [];
  const strip = (t: string) => String(t ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, "$1$2")
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, "$1 ($2)");

  for (const b of doc.blocks) {
    switch (b.kind) {
      case "paragraph":  lines.push(strip(b.text ?? ""), ""); break;
      case "bullets":    lines.push(...(b.items ?? []).map((i) => `  - ${strip(i)}`), ""); break;
      case "numbers":    lines.push(...(b.items ?? []).map((i, n) => `  ${n + 1}. ${strip(i)}`), ""); break;
      case "button":     if (b.label && b.href) lines.push(`${strip(b.label)}: ${b.href}`, ""); break;
      case "divider":    lines.push("--", ""); break;
      case "signature":  lines.push(strip(b.text ?? ""), ""); break;
    }
  }

  const footer = [...(doc.branding.addressLines ?? []), doc.branding.website ?? ""].filter(Boolean);
  if (footer.length) lines.push("--", ...footer);
  if (doc.unsubscribeUrl) {
    lines.push("", `${doc.unsubscribeNote || "To stop receiving these emails"}: ${doc.unsubscribeUrl}`);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
