/**
 * The HTML a customer actually receives.
 *
 * Pure and tested: no DOM, no network, no clock. What goes out to a customer
 * is the one thing in this product that cannot be taken back, so the markup
 * is built here where it can be asserted rather than assembled inline at the
 * point of sending.
 *
 * WRITTEN FOR EMAIL CLIENTS, NOT BROWSERS. Outlook renders through Word,
 * Gmail strips <style> blocks and anything it does not recognise. So:
 * tables for layout, inline styles only, no flexbox, no grid, no external
 * stylesheet, web-safe fonts with a stack behind them. It looks plainer than
 * the app deliberately — a design that degrades badly in Outlook reaches the
 * customer looking broken, which is worse than plain.
 *
 * A PLAIN-TEXT VERSION GOES ALONGSIDE IT. Some clients show it, spam filters
 * score messages without one worse, and it is what a screen reader reads
 * first. Both come from the same inputs, so they cannot say different things.
 */

export interface EmailSender {
  name?: string;
  designation?: string;
  email?: string;
  phone?: string;
}

export interface EmailCompany {
  name?: string;
  tagline?: string;
  website?: string;
  phone?: string;
  email?: string;
  logo?: string;
  addressLines?: string[];
  gstin?: string;
  cin?: string;
}

export interface EmailContent {
  /** The greeting and body, as typed by the sender. Plain text; blank lines
   *  separate paragraphs. */
  body: string;
  sender: EmailSender;
  company: EmailCompany;
  /** Named in the closing line so the customer sees what is attached. */
  attachmentName?: string | null;
}

const NAVY = "#0D2B55";
const INK = "#18202A";
const MUTED = "#64748B";
const RULE = "#D7DCE2";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Escape text for HTML.
 *
 * Everything variable goes through this. A customer's own company name is
 * not hostile input, but it is not ours either — an ampersand in "Smith &
 * Sons" breaks the markup, and a quotation body is typed by hand into a
 * field that has never been constrained.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Blank-line-separated text into paragraphs, single newlines into breaks. */
function paragraphs(body: string): string {
  return String(body ?? "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const withBreaks = escapeHtml(block).replace(/\n/g, "<br />");
      return `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${INK};">${withBreaks}</p>`;
    })
    .join("");
}

/** A website address as a link, whether or not it was typed with a scheme. */
function websiteLink(website: string): { href: string; label: string } {
  const label = website.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return { href: /^https?:\/\//i.test(website) ? website : "https://" + website, label };
}

/**
 * The signature block.
 *
 * Kept separate so it can be asserted on its own: this is what carries the
 * sender's name to the customer, and an empty one is worse than none — a
 * signature reading "Best regards," over a blank line looks like a mistake
 * by the person who sent it.
 */
export function signatureHtml(sender: EmailSender, company: EmailCompany): string {
  const rows: string[] = [];

  if (sender.name) {
    rows.push(
      `<div style="font-size:14px;font-weight:700;color:${NAVY};">${escapeHtml(sender.name)}</div>`,
    );
  }
  if (sender.designation) {
    rows.push(`<div style="font-size:12px;color:${MUTED};">${escapeHtml(sender.designation)}</div>`);
  }
  if (company.name) {
    rows.push(
      `<div style="font-size:12px;font-weight:600;color:${INK};margin-top:6px;">${escapeHtml(company.name)}</div>`,
    );
  }

  const contact: string[] = [];
  if (sender.phone) contact.push(`<a href="tel:${escapeHtml(sender.phone.replace(/[^0-9+]/g, ""))}" style="color:${MUTED};text-decoration:none;">${escapeHtml(sender.phone)}</a>`);
  if (sender.email) contact.push(`<a href="mailto:${escapeHtml(sender.email)}" style="color:${MUTED};text-decoration:none;">${escapeHtml(sender.email)}</a>`);
  if (company.website) {
    const { href, label } = websiteLink(company.website);
    contact.push(`<a href="${escapeHtml(href)}" style="color:${MUTED};text-decoration:none;">${escapeHtml(label)}</a>`);
  }
  if (contact.length) {
    rows.push(`<div style="font-size:12px;color:${MUTED};margin-top:4px;">${contact.join(" &nbsp;·&nbsp; ")}</div>`);
  }

  if (!rows.length) return "";

  /* The logo sits beside the text in a two-cell table rather than a float:
     Outlook ignores float entirely and would stack them. */
  const logoCell = company.logo
    ? `<td style="vertical-align:top;padding-right:14px;" width="1">
         <img src="${escapeHtml(company.logo)}" alt="${escapeHtml(company.name ?? "")}" width="120"
              style="display:block;max-width:120px;height:auto;border:0;" />
       </td>`
    : "";

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;border-top:1px solid ${RULE};padding-top:16px;width:100%;">
    <tr>
      ${logoCell}
      <td style="vertical-align:top;">${rows.join("")}</td>
    </tr>
  </table>`;
}

/** The whole message. */
export function buildEmailHtml(content: EmailContent): string {
  const { company, sender } = content;

  const addressLine = (company.addressLines ?? []).filter(Boolean).join(", ");
  const registration = [
    company.gstin ? "GSTIN " + company.gstin : "",
    company.cin ? "CIN " + company.cin : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  const attachmentNote = content.attachmentName
    ? `<p style="margin:0 0 14px;font-size:12px;color:${MUTED};">
         Attached: <span style="color:${INK};">${escapeHtml(content.attachmentName)}</span>
       </p>`
    : "";

  /* The outer table is what centres the message in Outlook, which does not
     honour margin:auto on a block element. */
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#F1F4F8;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F1F4F8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
               style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${RULE};border-radius:8px;font-family:${FONT};">
          <tr>
            <td style="height:4px;background:${NAVY};border-radius:8px 8px 0 0;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:26px 30px 30px;">
              ${paragraphs(content.body)}
              ${attachmentNote}
              ${signatureHtml(sender, company)}
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;font-family:${FONT};">
          <tr>
            <td style="padding:14px 30px 0;text-align:center;font-size:11px;line-height:1.6;color:${MUTED};">
              ${company.name ? `<div style="font-weight:600;color:${INK};">${escapeHtml(company.name)}</div>` : ""}
              ${addressLine ? `<div>${escapeHtml(addressLine)}</div>` : ""}
              ${registration ? `<div>${registration}</div>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** The same message as plain text, for clients that prefer it. */
export function buildEmailText(content: EmailContent): string {
  const { sender, company } = content;
  const lines: string[] = [String(content.body ?? "").trim()];

  if (content.attachmentName) lines.push("", "Attached: " + content.attachmentName);

  const sig = [
    sender.name,
    sender.designation,
    company.name,
    [sender.phone, sender.email].filter(Boolean).join("  |  "),
    company.website ? websiteLink(company.website).label : "",
  ].filter((line): line is string => !!line);

  if (sig.length) lines.push("", "--", ...sig);

  return lines.join("\n");
}
