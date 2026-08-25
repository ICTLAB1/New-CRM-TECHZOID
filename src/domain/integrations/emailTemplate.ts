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
  pan?: string;
  cin?: string;
  /** Certification names, as TEXT. Deliberately not the badge artwork:
   *  every mainstream client blocks remote images by default and Gmail
   *  strips base64 ones, so a row of certification badges in an email is a
   *  row of broken boxes for most readers — and a broken certification mark
   *  is worse than none. The words always render. */
  certifications?: string[];
}

/** One line on the summary table. Everything is PRE-FORMATTED: the template
 *  never sees a raw number, so it cannot round or localise differently from
 *  the PDF the same figures were printed on. */
export interface EmailLine {
  desc: string;
  qty: string;
  rate: string;
  total: string;
}

/**
 * The document's own facts.
 *
 * Deliberately narrow, and deliberately strings. NOTHING ABOUT COST, MARGIN
 * OR COMMISSION APPEARS HERE, and nothing may be added: this object is what
 * reaches a customer's inbox. As it happens no such field exists on a line
 * item in this product (see LineItem in domain/tax/types.ts), so there is
 * nothing to strip at the call site — but the shape is the guard if one is
 * ever added.
 */
export interface EmailQuotation {
  /** "Quotation", "Proforma invoice", "Purchase order", "Tax invoice". */
  label: string;
  number: string;
  /** Already formatted for a reader — "24 Aug 2026". */
  date: string;
  /** What the meta row is called: "Valid until" on a quote, "Payment due"
   *  on an invoice. */
  validLabel: string;
  validUntil: string | null;
  items: EmailLine[];
  /** Only the ones that apply; each is [label, formatted amount]. */
  moneyRows: Array<[string, string]>;
  grand: string;
  grandWords: string;
  /** True only for a real quotation. Drives the "this is not an invoice"
   *  line, which would be a lie on a tax invoice. */
  isOffer: boolean;
  /** Where a purchase order should be sent. Grounded in the terms: order
   *  confirmation is subject to receipt of a valid PO. */
  confirmTo?: string;
}

export interface EmailContent {
  /** The greeting and body, as typed by the sender. Plain text; blank lines
   *  separate paragraphs. */
  body: string;
  sender: EmailSender;
  company: EmailCompany;
  /** Named in the closing line so the customer sees what is attached. */
  attachmentName?: string | null;
  /** Absent for a plain covering note; present turns this into the full
   *  document email with a summary, the lines and the next steps. */
  quotation?: EmailQuotation | null;
}

/* The website's transactional palette, so the two systems read as one
   company. NOT the quotation PDF's navy — that is a printed document with
   its own conventions, and copying it here made the email look like a
   screenshot of the attachment. */
const PAGE = "#f6f4f0";   /* page background */
const CARD = "#ffffff";   /* card background */
const INK = "#3f3a33";    /* body text */
const MUTED = "#6b6259";  /* muted text */
const RULE = "#e3ded6";   /* rules and borders */
const HEAD = "#201c18";   /* headings, header rule */
const ACCENT = "#76550a"; /* step markers, emphasis */
const ZEBRA = "#faf9f7";  /* zebra row tint */
/* Kept as an alias so the signature block below reads unchanged; it is the
   heading colour now, not a navy. */
const NAVY = HEAD;
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

/* ── the document sections ──────────────────────────────────────────── */

/**
 * The header band.
 *
 * TEXT, not an image. Most clients block remote images by default, and a
 * header that is only a logo arrives as an empty box with the company's
 * name nowhere on the message. A logo may sit beside it, but the words are
 * what always render.
 */
function headerHtml(company: EmailCompany): string {
  const name = company.name ? escapeHtml(company.name) : "";
  const strapline = "Connect, Communicate &amp; Collaborate";
  return `<tr>
    <td style="padding:22px 18px 16px;border-bottom:2px solid ${HEAD};">
      ${name ? `<div style="font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${HEAD};">${name}</div>` : ""}
      <div style="margin-top:4px;font-size:13px;color:${MUTED};">${strapline}</div>
    </td>
  </tr>`;
}

/**
 * The summary block: the four facts a reader opens this to find.
 *
 * The total is the largest thing on the page because it is what they are
 * looking for. The validity date is stated as a date and nothing more —
 * a fact, not a countdown.
 */
function summaryHtml(q: EmailQuotation): string {
  const meta = (label: string, value: string) => `<tr>
    <td style="padding:3px 0;font-size:14px;color:${MUTED};">${escapeHtml(label)}</td>
    <td style="padding:3px 0;font-size:14px;color:${INK};text-align:right;font-weight:600;">${escapeHtml(value)}</td>
  </tr>`;

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="width:100%;background:${ZEBRA};border:1px solid ${RULE};border-radius:6px;margin:0 0 20px;">
    <tr><td style="padding:16px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
        ${meta(q.label + " no.", q.number)}
        ${meta("Date of issue", q.date)}
        ${q.validUntil ? meta(q.validLabel, q.validUntil) : ""}
      </table>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid ${RULE};">
        <div style="font-size:14px;color:${MUTED};">Total</div>
        <div style="margin-top:2px;font-size:26px;font-weight:700;color:${HEAD};font-variant-numeric:tabular-nums;">${escapeHtml(q.grand)}</div>
        ${q.grandWords ? `<div style="margin-top:4px;font-size:12px;color:${MUTED};">${escapeHtml(q.grandWords)}</div>` : ""}
      </div>
      ${q.isOffer ? `<div style="margin-top:12px;font-size:12px;line-height:1.5;color:${MUTED};">
        This is a quotation, not an invoice. No payment is due on it and no tax is payable until an invoice is raised.
      </div>` : ""}
    </td></tr>
  </table>`;
}

/**
 * The line items.
 *
 * A summary, not a reproduction — the PDF is the document and says it
 * better. All four facts are here: description, quantity, unit price and
 * line total.
 *
 * TWO COLUMNS, NOT FOUR, with quantity and unit price on a sub-line under
 * the description. Four columns of lakh-formatted rupees have a min-content
 * width of about 380px — three figures like "23,59,365.75" cannot wrap
 * except mid-digit — so a four-column table overflowed a 320px screen and
 * gave every phone a sideways scrollbar. Media queries cannot rescue it:
 * Gmail and Outlook strip the <style> block they would have to live in.
 * This shape is what commerce email settled on for the same reason, and it
 * loses nothing.
 */
function itemsHtml(q: EmailQuotation): string {
  if (!q.items.length) return "";
  const num = `text-align:right;font-variant-numeric:tabular-nums;`;

  const head = `<tr>
    <th align="left"  style="padding:8px 6px;font-size:12px;font-weight:600;color:${MUTED};border-bottom:1px solid ${RULE};">Item</th>
    <th align="right" style="padding:8px 6px;font-size:12px;font-weight:600;color:${MUTED};border-bottom:1px solid ${RULE};${num}">Amount</th>
  </tr>`;

  const rows = q.items.map((it, i) => {
    const tint = i % 2 ? ` background:${ZEBRA};` : "";
    /* Quantity and unit price sit under the description, spelled out as
       "25 User x Rs. 18,900.00" — the same two numbers a fourth and third
       column would have carried, in a form that fits a phone. */
    const sub = [it.qty, it.rate].filter(Boolean).map(escapeHtml).join(" &times; ");
    return `<tr>
      <td style="padding:9px 6px;font-size:14px;color:${INK};border-bottom:1px solid ${RULE};${tint}">
        ${escapeHtml(it.desc)}
        ${sub ? `<div style="margin-top:2px;font-size:12px;color:${MUTED};">${sub}</div>` : ""}
      </td>
      <td valign="top" style="padding:9px 6px;font-size:14px;color:${INK};border-bottom:1px solid ${RULE};${num}${tint}">${escapeHtml(it.total)}</td>
    </tr>`;
  }).join("");

  /* Tax is always shown as its own line or lines. A single tax-inclusive
     figure with no split tells a finance team nothing and invites a call. */
  const money = q.moneyRows.map(([label, value]) => `<tr>
    <td style="padding:5px 6px;font-size:14px;color:${MUTED};text-align:right;">${escapeHtml(label)}</td>
    <td style="padding:5px 6px;font-size:14px;color:${INK};${num}">${escapeHtml(value)}</td>
  </tr>`).join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="width:100%;border-collapse:collapse;margin:0 0 20px;">
    ${head}${rows}${money}
    <tr>
      <td style="padding:10px 6px 0;font-size:14px;font-weight:700;color:${HEAD};text-align:right;border-top:2px solid ${HEAD};">Total</td>
      <td style="padding:10px 6px 0;font-size:14px;font-weight:700;color:${HEAD};border-top:2px solid ${HEAD};${num}">${escapeHtml(q.grand)}</td>
    </tr>
  </table>`;
}

/**
 * What happens next.
 *
 * Every step is something this business actually does — step three is the
 * standard term "order confirmation is subject to receipt and acceptance of
 * a valid Purchase Order" (see DOMESTIC_TERMS), not an invention. No
 * response-time promise and no delivery estimate appear here, because
 * neither is a fact this system holds.
 *
 * Numbered in text as well as by position: a step marker carried only by
 * colour or a bullet glyph is lost to a screen reader and to Outlook.
 */
function nextStepsHtml(q: EmailQuotation): string {
  const steps = [
    "Review the attached document in full — it carries the complete specification and terms.",
    "Reply to this email with any change you need, and a revised version will be issued.",
    q.confirmTo
      /* An address at a long domain is one unbreakable 280px word. Without
         a break rule it sets the width of the whole message and pushes a
         320px screen into sideways scrolling. */
      ? `To confirm, send your purchase order to <a href="mailto:${escapeHtml(q.confirmTo)}" style="color:${ACCENT};text-decoration:underline;word-break:break-word;">${escapeHtml(q.confirmTo)}</a>.`
      : "To confirm, reply with your purchase order.",
  ];

  const rows = steps.map((text, i) => `<tr>
    <td valign="top" style="padding:0 10px 10px 0;width:24px;font-size:14px;font-weight:700;color:${ACCENT};">${i + 1}.</td>
    <td valign="top" style="padding:0 0 10px;font-size:14px;line-height:1.55;color:${INK};word-break:break-word;">${text}</td>
  </tr>`).join("");

  return `<div style="margin:0 0 20px;">
    <div style="font-size:15px;font-weight:700;color:${HEAD};margin:0 0 10px;">What happens next</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${rows}</table>
  </div>`;
}

export function buildEmailHtml(content: EmailContent): string {
  const { company, sender } = content;
  const q = content.quotation ?? null;

  const addressLine = (company.addressLines ?? []).filter(Boolean).join(", ");

  /* Every registration the company has configured, and nothing invented. */
  const footerFacts = [
    company.phone ? escapeHtml(company.phone) : "",
    company.email ? `<a href="mailto:${escapeHtml(company.email)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(company.email)}</a>` : "",
    company.website ? (() => { const w = websiteLink(company.website); return `<a href="${escapeHtml(w.href)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(w.label)}</a>`; })() : "",
  ].filter(Boolean).join(" · ");

  const certifications = (company.certifications ?? []).filter(Boolean);

  const registration = [
    company.gstin ? "GSTIN " + escapeHtml(company.gstin) : "",
    company.pan ? "PAN " + escapeHtml(company.pan) : "",
    company.cin ? "CIN " + escapeHtml(company.cin) : "",
  ].filter(Boolean).join(" · ");

  const attachmentNote = content.attachmentName
    ? `<p style="margin:0 0 20px;font-size:12px;color:${MUTED};">
         Attached: <span style="color:${INK};">${escapeHtml(content.attachmentName)}</span>
       </p>`
    : "";

  const heading = q
    ? `<h1 style="margin:0 0 14px;font-size:20px;font-weight:700;line-height:1.3;color:${HEAD};">Your ${escapeHtml(q.label.toLowerCase())} is ready</h1>`
    : "";

  /* The outer table is what centres the message in Outlook, which does not
     honour margin:auto on a block element. */
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${PAGE};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE};padding:24px 8px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
               style="width:100%;max-width:600px;background:${CARD};border:1px solid ${RULE};border-radius:8px;font-family:${FONT};">
          ${headerHtml(company)}
          <tr>
            <td style="padding:22px 18px 26px;">
              ${heading}
              ${paragraphs(content.body)}
              ${q ? summaryHtml(q) : ""}
              ${q ? itemsHtml(q) : ""}
              ${q ? nextStepsHtml(q) : ""}
              ${attachmentNote}
              ${signatureHtml(sender, company)}
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;font-family:${FONT};">
          <tr>
            <td style="padding:16px 18px 0;text-align:center;font-size:12px;line-height:1.7;color:${MUTED};">
              ${company.name ? `<div style="font-weight:600;color:${INK};">${escapeHtml(company.name)}</div>` : ""}
              ${addressLine ? `<div>${escapeHtml(addressLine)}</div>` : ""}
              ${footerFacts ? `<div>${footerFacts}</div>` : ""}
              ${registration ? `<div>${registration}</div>` : ""}
              ${certifications.length
                ? `<div style="margin-top:6px;">Certified to ${certifications.map(escapeHtml).join(" &middot; ")}</div>`
                : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * The same message as plain text.
 *
 * A REAL ALTERNATIVE, not a stripped copy. This is what a customer sees
 * when their client refuses HTML, what a screen reader reaches first, and
 * what appears in the log when mail is misconfigured — so it carries every
 * fact the HTML does: number, dates, the lines, the tax split, the total in
 * figures and words, the next steps and who to reply to.
 */
export function buildEmailText(content: EmailContent): string {
  const { sender, company } = content;
  const q = content.quotation ?? null;
  const out: string[] = [];
  /* Widest label is "Date of issue" at 13; 16 leaves room for a longer
     document name without the column jumping. */
  const PAD = 16;

  if (company.name) out.push(company.name.toUpperCase(), "Connect, Communicate & Collaborate", "");

  if (q) out.push(`YOUR ${q.label.toUpperCase()} IS READY`, "");

  out.push(String(content.body ?? "").trim());

  if (q) {
    out.push(
      "",
      "-".repeat(56),
      /* One pad width for every label, so the column lines up whatever the
         document is called. */
      `${(q.label + " no.").padEnd(PAD)} ${q.number}`,
      `${"Date of issue".padEnd(PAD)} ${q.date}`,
      ...(q.validUntil ? [`${q.validLabel.padEnd(PAD)} ${q.validUntil}`] : []),
      `${"Total".padEnd(PAD)} ${q.grand}`,
      ...(q.grandWords ? [`${" ".repeat(PAD)} ${q.grandWords}`] : []),
      "-".repeat(56),
    );

    if (q.isOffer) {
      out.push(
        "",
        "This is a quotation, not an invoice. No payment is due on it and",
        "no tax is payable until an invoice is raised.",
      );
    }

    if (q.items.length) {
      out.push("", "ITEMS", "");
      /* One block per line rather than aligned columns: a column layout that
         depends on a monospaced font falls apart in every client that does
         not use one, which is most of them. */
      for (const it of q.items) {
        out.push(`  ${it.desc}`, `    ${it.qty} x ${it.rate}  =  ${it.total}`);
      }
    }

    if (q.moneyRows.length) {
      out.push("", ...q.moneyRows.map(([label, value]) => `  ${label}: ${value}`));
    }
    out.push("", `  TOTAL: ${q.grand}`);

    out.push(
      "",
      "WHAT HAPPENS NEXT",
      "",
      "  1. Review the attached document in full - it carries the complete",
      "     specification and terms.",
      "  2. Reply to this email with any change you need, and a revised",
      "     version will be issued.",
      q.confirmTo
        ? `  3. To confirm, send your purchase order to ${q.confirmTo}.`
        : "  3. To confirm, reply with your purchase order.",
    );
  }

  if (content.attachmentName) out.push("", "Attached: " + content.attachmentName);

  const sig = [
    sender.name,
    sender.designation,
    company.name,
    [sender.phone, sender.email].filter(Boolean).join("  |  "),
    company.website ? websiteLink(company.website).label : "",
  ].filter((line): line is string => !!line);

  if (sig.length) out.push("", "--", ...sig);

  const footer = [
    (company.addressLines ?? []).filter(Boolean).join(", "),
    (company.certifications ?? []).filter(Boolean).length
      ? "Certified to " + (company.certifications ?? []).filter(Boolean).join(" | ")
      : "",
    [
      company.gstin ? "GSTIN " + company.gstin : "",
      company.pan ? "PAN " + company.pan : "",
      company.cin ? "CIN " + company.cin : "",
    ].filter(Boolean).join(" | "),
  ].filter(Boolean);
  if (footer.length) out.push("", ...footer);

  return out.join("\n");
}
