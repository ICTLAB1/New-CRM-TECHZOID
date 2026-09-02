import { fill } from "./outreachAudience.mjs";

/**
 * One recipient's copy of a campaign, rendered once at launch.
 *
 * The campaign holds the template; this produces the words that actually go
 * into somebody's inbox, with their name and company already in them. The
 * sender never sees a template — see the note at the top of
 * netlify/functions/outreach-launch.mjs for why that matters.
 *
 * THE UNSUBSCRIBE LINE IS NOT OPTIONAL and is added here rather than left to
 * whoever writes the template. A cold email with no way out is the thing that
 * turns a complaint into a blocklisting, and this company's cold outreach
 * shares a sending domain with the mailbox its quotations go out from. One
 * missing footer would put both at risk, so it cannot be a matter of somebody
 * remembering.
 */

export const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Where an unsubscribe click lands. Public, unauthenticated, and keyed by a
 *  token rather than the address, so the link cannot be edited into somebody
 *  else's unsubscribe. */
export const unsubscribeUrl = (siteUrl, sendId) =>
  `${String(siteUrl || "").replace(/\/+$/, "")}/.netlify/functions/outreach-unsubscribe?s=${encodeURIComponent(sendId)}`;

/**
 * The small amount of formatting a writer gets, as literal markers.
 *
 * Markers rather than a rich-text editor, for the reason
 * src/domain/outreach/emailHtml.ts gives at greater length: a contenteditable
 * produces whatever the browser feels like, and accepting that as email HTML
 * means accepting Chrome's opinion of markup as the thing Outlook has to
 * render. Markers are boring, predictable, and cannot smuggle a script in —
 * everything is escaped first and only these four shapes are then allowed
 * back through.
 *
 *   **bold**            the line that has to land
 *   _italic_            an aside
 *   ==highlight==       the one question worth answering, in yellow
 *   [text](https://…)   https only
 */
export function inlineFormat(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/==([^=]+)==/g,
    '<mark style="background:#fff2a8;color:inherit;padding:1px 2px;">$1</mark>');
  out = out.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, "$1<em>$2</em>");
  /* https only. A mailto: or javascript: link built from a template variable
     is how a composer becomes an attack surface. */
  out = out.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
    (_m, label, href) => `<a href="${href}" style="color:#2563eb;text-decoration:underline;">${label}</a>`);
  return out.replace(/\n/g, "<br />");
}

/**
 * Turn the body into the HTML that is actually sent.
 *
 * Table layout and inline CSS, matching src/domain/outreach/emailHtml.ts:
 * Outlook renders neither a stylesheet nor flexbox, and a cold email that
 * arrives broken is worse than one that arrives plain.
 */
export function renderHtml({ body, unsubscribe, signature }) {
  const paragraphs = String(body ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;">${inlineFormat(p)}</p>`)
    .join("");

  const footer = unsubscribe
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">` +
      `If you would rather not hear from us, <a href="${escapeHtml(unsubscribe)}" style="color:#6b7280;">unsubscribe</a>.` +
      `</p>`
    : "";

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">` +
    `<tr><td align="left" style="padding:24px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">` +
    `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111827;">` +
    paragraphs + (signature || "") + footer +
    `</td></tr></table></td></tr></table>`
  );
}

/**
 * Render a campaign for one recipient.
 *
 * The unsubscribe link needs the send row's id, which does not exist until
 * the row is inserted — so the HTML stored at launch carries a placeholder
 * and the sender substitutes the real link just before sending. That keeps
 * the words fixed at launch while letting the one part that genuinely cannot
 * be known then be filled in later.
 */
export const UNSUBSCRIBE_PLACEHOLDER = "{{__unsubscribe_url__}}";

export function renderCampaignFor(campaign, values, signature = "") {
  const subject = fill(String(campaign.subject ?? ""), values).text;
  const body = fill(String(campaign.body ?? ""), values).text;
  return {
    subject,
    body,
    html: renderHtml({ body, unsubscribe: UNSUBSCRIBE_PLACEHOLDER, signature }),
  };
}

/** The markers, removed. A plain-text part reading "**The reason I'm
 *  writing:**" is what a mail merge looks like when nobody checked. */
export function stripMarkers(text) {
  return String(text ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, "$1$2")
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, "$1 ($2)");
}

/** Put the real unsubscribe link in, at send time. */
export function withUnsubscribe(row, siteUrl) {
  const url = unsubscribeUrl(siteUrl, row.id);
  return {
    subject: row.subject,
    message: `${stripMarkers(row.body)}\n\n---\nIf you would rather not hear from us: ${url}`,
    html: String(row.html ?? "").split(UNSUBSCRIBE_PLACEHOLDER).join(escapeHtml(url)),
  };
}
