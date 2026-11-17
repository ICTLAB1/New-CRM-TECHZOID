import { automatedNotice, type AutomatedKind } from "./automated";
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
  email?: string;
  phone?: string;
}
/**
 * NO JOB TITLE HERE, ON PURPOSE.
 *
 * The signature used to print the sender's designation under their name.
 * It is off at the company's request, and the field is REMOVED rather than
 * accepted and ignored — a property that still type-checks and silently
 * does nothing is how somebody later sets it, sees no change, and goes
 * looking for a bug that is really a decision.
 *
 * The designation itself is not gone from the product: it is still a team
 * member's own field, shown on the Team screen, and still printed by the
 * campaign signature (src/domain/outreach/signature.ts), which is a
 * separate block with its own preview in Settings. Putting the line back
 * here means adding the field and one row in signatureHtml, plus one entry
 * in the plain-text signature.
 */

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
  /** Certification names, as TEXT — printed in the footer, and what a
   *  reader with pictures off has instead of the marks. The words always
   *  render, which is why they are not optional on the badges below. */
  certifications?: string[];
  /** More than one number, each with the place it rings — "INDIA", "UAE".
   *  `phone` above is still the company's main line; this is for a business
   *  that answers in two countries and says so on its signature. */
  phones?: Array<{ label: string; number: string }>;
  /** Each office's postal address, labelled by the place it is in. A
   *  reseller bidding for government work is asked for its registered
   *  address often enough that having it on every email saves a round
   *  trip. Empty ones are dropped rather than printed as a bare label. */
  offices?: Array<{ label: string; address: string }>;
  /** The one line that says what the company actually sells — "Enterprise
   *  Software Licensing | Microsoft | Adobe | …". Written out as text, not
   *  baked into the strip, so it is searchable in a mail client and still
   *  there when images are blocked. */
  services?: string;
  /**
   * The designed signature strip, as an image.
   *
   * ADDED BENEATH THE WRITTEN SIGNATURE, NEVER INSTEAD OF IT. A designed
   * strip carries partner badges and certification marks that cannot be set
   * in type, and it is what the company wants on its mail. But most clients
   * block a remote image until the reader asks for it, and Outlook on
   * Windows blocks it by default — so an email whose whole signature is one
   * image arrives, for a great many readers, as an empty box where the
   * sender's name and number should be. The text block above it is what
   * always renders; this is the part that makes it look like the company.
   *
   * `src` must be an absolute https URL. A relative path resolves against
   * nothing inside a mail client, and a `data:` URI is stripped outright by
   * Gmail — the two ways this silently turns into a broken image.
   *
   * `alt` is not decoration: it is what a reader sees when the image is
   * blocked, so it should say in words what the strip claims in pictures.
   */
  signatureImage?: { src: string; alt: string; width?: number } | null;
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

/**
 * One vendor's line in the "what we supply" block.
 *
 * THE WORDS COME FIRST AND THE LOGO IS THE ADORNMENT, not the other way
 * round. Outlook blocks remote images by default and a great many company
 * mailboxes never turn them on, so a block that said what we sell only in
 * pictures would say nothing at all to the reader who most needs to know.
 * `name` is printed as text beside the logo and is also the image's alt, so
 * the block reads the same either way.
 */
export interface EmailProductGroup {
  /** "Microsoft", "Autodesk", "Adobe" — the vendor, as a reader knows it. */
  name: string;
  /** The heading over the list: "Microsoft 365 & perpetual licensing". */
  heading: string;
  /** What the group is for, in one line above the list. */
  detail: string;
  /**
   * The products themselves, one per line.
   *
   * A LIST, NOT A SENTENCE, because of how this is read: a purchase
   * manager is scanning for the one product they are about to buy, and a
   * run-on line makes them read all of it to find out we do not carry it.
   */
  bullets?: readonly string[];
  /** A commercial fact about the whole group, under its list. */
  note?: string;
  /**
   * The vendor's own brand colour, for the rule down the side.
   *
   * A COLOUR IS NOT AN IMAGE: it is a table cell with a background, so it
   * renders in every client whether or not the reader allows pictures.
   * That is what keeps each panel identifiable when the logo does not
   * load, which is the ordinary case in Outlook.
   */
  accent?: string;
  /**
   * The vendor's own mark, when the company has the artwork on its site.
   *
   * An absolute https URL — a relative path in an email resolves against
   * nothing. Absent is a perfectly good block: the heading and the detail
   * carry it. NOTHING HERE IS EVER DRAWN OR APPROXIMATED; a logo appears
   * only when a real file has been put in `public/brand/`.
   */
  logo?: { src: string; alt: string; width: number } | null;
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
  /** What we supply, by vendor. Printed under the body — see productsHtml.
   *  Empty or absent prints nothing, which is every email but the profile. */
  products?: readonly EmailProductGroup[] | null;
  /**
   * A band across the top of the card, for a message that INTRODUCES the
   * company rather than continuing a conversation.
   *
   * Absent on everything else, deliberately. A quotation email opens with
   * "Your quotation is ready" because that is why it was sent; a marketing
   * headline above that would be the company talking over its own
   * customer. This belongs on the profile mail, which is an introduction.
   *
   * NO IMAGE IN IT. A coloured table cell with text renders identically
   * whether or not the reader allows pictures, which a headline set as
   * artwork would not.
   */
  hero?: { eyebrow?: string; headline: string; line?: string } | null;
  /**
   * The one thing the reader is being asked to do.
   *
   * `href` is normally a `mailto:` back to the sender, because replying IS
   * the action: this is a personal message from a named person, and a
   * button that opens a reply is the shortest path to what we want. The
   * same ask is in the body in words, because a styled table cell is a
   * button in most clients and a plain link in the rest.
   */
  callToAction?: { heading: string; lines: readonly string[]; label: string; href: string } | null;
  /** Set on a message a MACHINE sends — an armed follow-up, a payment
   *  reminder. It prints the line that says so. A message somebody typed
   *  and sent just now leaves it out, because it would be a lie: see
   *  domain/integrations/automated.ts. */
  automated?: AutomatedKind;
  /** A festival greeting to open with — see domain/greetings/festive.ts for
   *  when one applies. Absent is the ordinary case, and the sender can
   *  always drop it on the send dialog. */
  greeting?: {
    headline: string;
    line: string;
    /** The artwork, when there is some. An absolute https URL: a relative
     *  path in an email resolves against nothing. `alt` carries the same
     *  words, because Outlook blocks images until the reader asks for
     *  them. */
    banner?: { src: string; width: number; height: number; alt: string } | null;
  } | null;
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

  /* Two countries, each labelled. Written out rather than run together, so
     a customer in Dubai can see which number rings where. */
  const places = (company.phones ?? []).filter((p) => p?.number?.trim());
  if (places.length) {
    const line = places
      .map((p) => {
        const dial = escapeHtml(p.number.replace(/[^0-9+]/g, ""));
        const label = p.label?.trim()
          ? `<span style="color:${ACCENT};font-weight:700;">${escapeHtml(p.label.trim().toUpperCase())}</span> `
          : "";
        return `${label}<a href="tel:${dial}" style="color:${MUTED};text-decoration:none;">${escapeHtml(p.number)}</a>`;
      })
      .join(" &nbsp;·&nbsp; ");
    rows.push(`<div style="font-size:12px;color:${MUTED};margin-top:4px;">${line}</div>`);
  }

  /* THE OFFICES, under the numbers that ring in them. Each on its own
     line: an address run together with another address is read as one
     wrong address. */
  for (const office of company.offices ?? []) {
    const address = office?.address?.trim();
    if (!address) continue;
    const label = office.label?.trim()
      ? `<span style="color:${ACCENT};font-weight:700;">${escapeHtml(office.label.trim().toUpperCase())}</span> &nbsp;`
      : "";
    rows.push(
      `<div style="font-size:11px;color:${MUTED};margin-top:3px;line-height:1.5;">${label}${escapeHtml(address)}</div>`,
    );
  }

  /* THE CERTIFICATIONS, AS A SENTENCE.
     They were a row of three badge images here. The marks are genuine and
     they rendered correctly, but three seals of different internal
     proportions sitting under a 600px partner strip never looked like part
     of the signature — and a certification is a claim, which reads better
     stated than drawn. One line of text is also what survives a client
     with pictures off, searchable and selectable, with no file to keep in
     step with anything. */
  const certs = (company.certifications ?? []).filter((c) => String(c ?? "").trim());
  if (certs.length) {
    const list = certs.length > 1
      ? `${certs.slice(0, -1).join(", ")} and ${certs[certs.length - 1]}`
      : certs[0]!;
    rows.push(
      /* Bigger and bold, and in the body ink rather than the muted grey:
         at 11px muted it sat below the addresses and read as one more
         small print line. It is a claim worth making, so it is set like
         one — but still under the name and the company, which are who the
         mail is from. */
      `<div style="font-size:12.5px;font-weight:700;color:${INK};margin-top:9px;line-height:1.5;">`
      + `An ${escapeHtml(list)} certified company</div>`,
    );
  }

  /* What the company sells, in words. Above the strip, because the strip
     says who it partners with and this says what it does with them. */
  if (company.services?.trim()) {
    rows.push(
      `<div style="font-size:11px;color:${MUTED};margin-top:7px;line-height:1.5;">`
      + `${escapeHtml(company.services.trim())}</div>`,
    );
  }

  if (!rows.length && !company.signatureImage?.src) return "";

  /* NO LOGO HERE — IT IS ON THE MASTHEAD. This cell used to repeat the
     company's mark beside the signature, and the only reason it never
     looked like clutter is that it never rendered: it was fed the data URI
     from Settings, which Gmail strips. Now that the mark is served as a
     hosted file and does appear, once at the top of the message is right
     and twice in the same email is a letterhead arguing with itself. The
     strip below carries the partner badges, which is a different job. */

  /* THE STRIP GOES UNDER THE WORDS. Its own row, full width, with the
     alt text carrying the same claims in case the reader's client never
     fetches it. `max-width:100%` is what stops it forcing a phone's mail
     app into a sideways scroll. */
  const strip = company.signatureImage?.src
    ? `<tr>
         <td style="padding-top:14px;">
           <img src="${escapeHtml(company.signatureImage.src)}"
                alt="${escapeHtml(company.signatureImage.alt ?? company.name ?? "")}"
                ${company.signatureImage.width ? `width="${Math.round(company.signatureImage.width)}"` : ""}
                style="display:block;width:100%;max-width:${Math.round(company.signatureImage.width ?? 600)}px;height:auto;border:0;" />
         </td>
       </tr>`
    : "";


  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;border-top:1px solid ${RULE};padding-top:16px;width:100%;">
    <tr>
      <td style="vertical-align:top;">${rows.join("")}</td>
    </tr>
    ${strip}
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
 *
 * SO THE LOGO IS BESIDE THE NAME, NOT INSTEAD OF IT — and it is the
 * wordmark alone, not the full lockup. The company's artwork carries the
 * strapline under the mark; printed whole it would say "Connect,
 * Communicate & Collaborate" twice to a reader with pictures on, and say it
 * zero times to the far larger number who have them off. Cropped to the
 * mark, the picture and the words each do one job. See
 * `public/brand/README.md`.
 *
 * ITS ALT TEXT IS EMPTY, DELIBERATELY. The company's name is set in bold
 * directly beneath it, so alt="TechZoid Technologies Private Limited"
 * printed that name twice in a row to every reader with pictures off —
 * once wrapped over three lines inside the logo's narrow box, then again
 * underneath, which reads as a fault in the email. An image whose content
 * is already in the adjacent text is decorative: an empty alt is what makes
 * a screen reader skip it instead of saying the name twice, and what makes
 * a blocked image collapse to nothing rather than to a stutter. The header
 * then looks exactly as it did before the logo existed, which is the
 * fallback we want.
 */
function headerHtml(company: EmailCompany): string {
  const name = company.name ? escapeHtml(company.name) : "";
  const strapline = company.tagline?.trim()
    ? escapeHtml(company.tagline.trim())
    : "Connect, Communicate &amp; Collaborate";

  const words = `${name ? `<div style="font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${HEAD};">${name}</div>` : ""}
      <div style="margin-top:4px;font-size:13px;color:${MUTED};">${strapline}</div>`;

  const mark = company.logo
    ? `<img src="${escapeHtml(company.logo)}" alt="" width="150"
            style="display:block;width:150px;max-width:150px;height:auto;border:0;margin:0 0 12px;" />`
    : "";

  return `<tr>
    <td style="padding:22px 18px 16px;border-bottom:2px solid ${HEAD};">
      ${mark}
      ${words}
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

/**
 * What we supply, by vendor.
 *
 * BUILT TO SURVIVE BLOCKED IMAGES, because that is the ordinary case: a
 * corporate Outlook shows no remote picture until the reader clicks
 * "download pictures", and many never do. So the panel is made of things
 * that always render — the vendor's name, a coloured rule down its side,
 * the heading, and the product list — and the logo sits inside that rather
 * than standing in for it. With pictures off the reader loses the marks and
 * nothing else; with them on, they are the fastest way for a purchase
 * manager to see we deal in what they buy.
 *
 * ONE PANEL PER VENDOR, each its own table. A single table with three rows
 * would be fewer tags and would collapse in Outlook the moment one cell
 * grew taller than its neighbour; separate tables cannot disagree about
 * their own height.
 *
 * WIDTH ON THE TAG, HEIGHT NEVER — the rule the festival banner learned the
 * hard way. Outlook renders through Word and sizes from the width
 * attribute; a height attribute makes a blocked image reserve its whole
 * box, so the reader gets a word of alt text floating in an empty
 * rectangle. Without it the cell collapses to its text.
 *
 * THE LOGOS ARE THE VENDORS' OWN ARTWORK, supplied by the company that
 * holds those relationships, and nothing here is drawn or approximated. A
 * group with no logo configured simply prints its words.
 */
function productsHtml(groups: readonly EmailProductGroup[]): string {
  if (!groups.length) return "";

  const panel = (g: EmailProductGroup, first: boolean): string => {
    const accent = g.accent && /^#[0-9a-f]{3,8}$/i.test(g.accent) ? g.accent : HEAD;

    const mark = g.logo
      ? `<img src="${escapeHtml(g.logo.src)}" alt="${escapeHtml(g.logo.alt)}"
              width="${Math.round(g.logo.width)}"
              style="display:block;width:${Math.round(g.logo.width)}px;max-width:100%;height:auto;border:0;font-size:13px;font-weight:700;color:${accent};" />`
      /* No artwork: the vendor's name in its own colour does the job the
         mark would have done. */
      : `<div style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${accent};">${escapeHtml(g.name)}</div>`;

    const bullets = (g.bullets ?? []).filter((b) => String(b ?? "").trim());
    /* A table of rows rather than <ul>: Outlook indents and bullets a list
       to its own taste, and the taste is a large hanging indent that eats
       the panel's width. A coloured marker cell is the same shape in every
       client. */
    const list = bullets.length
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 0;">
           ${bullets.map((b) => `<tr>
             <td valign="top" width="12" style="width:12px;padding:2px 0 0;font-size:12px;line-height:1.5;color:${accent};">&bull;</td>
             <td style="padding:2px 0 0;font-size:12.5px;line-height:1.5;color:${INK};">${escapeHtml(b)}</td>
           </tr>`).join("")}
         </table>`
      : "";

    const note = g.note?.trim()
      ? `<div style="margin-top:9px;font-size:11.5px;font-weight:600;color:${accent};">${escapeHtml(g.note.trim())}</div>`
      : "";

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="margin:${first ? "0" : "12px"} 0 0;background:${ZEBRA};border:1px solid ${RULE};border-left:4px solid ${accent};">
      <tr>
        <td style="padding:13px 15px 15px;">
          ${mark}
          <div style="margin-top:9px;font-size:14px;font-weight:700;color:${HEAD};">${escapeHtml(g.heading)}</div>
          ${g.detail?.trim() ? `<div style="margin-top:3px;font-size:12.5px;line-height:1.5;color:${MUTED};">${escapeHtml(g.detail.trim())}</div>` : ""}
          ${list}
          ${note}
        </td>
      </tr>
    </table>`;
  };

  return `<div style="margin:4px 0 20px;">
    <div style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${ACCENT};">
      What we supply
    </div>
    ${groups.map((g, i) => panel(g, i === 0)).join("")}
  </div>`;
}

/**
 * The band across the top, for a message that introduces the company.
 *
 * TEXT ON A COLOUR, never a picture of text. A headline set as artwork is a
 * headline most readers never see, and one that no reader can select, search
 * or have read aloud.
 *
 * The eyebrow is a light warm tone rather than the page's gold accent,
 * which is nearly invisible on this near-black ground. Checked by rendering
 * it and looking, not by trusting the palette.
 */
function heroHtml(hero: NonNullable<EmailContent["hero"]>): string {
  if (!hero.headline?.trim()) return "";
  return `<tr>
    <td style="padding:22px 18px 24px;background:${HEAD};">
      ${hero.eyebrow?.trim()
        ? `<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D8B45F;">${escapeHtml(hero.eyebrow.trim())}</div>`
        : ""}
      <div style="margin-top:8px;font-size:22px;font-weight:700;line-height:1.3;color:#ffffff;">${escapeHtml(hero.headline.trim())}</div>
      ${hero.line?.trim()
        ? `<div style="margin-top:10px;font-size:13px;line-height:1.65;color:#D6D0C6;">${escapeHtml(hero.line.trim())}</div>`
        : ""}
    </td>
  </tr>`;
}

/**
 * The one thing the reader is being asked to do.
 *
 * THE BUTTON IS A TABLE CELL WITH A LINK IN IT, not an <a> with padding:
 * Outlook ignores padding on an inline element, so the "button" arrives as
 * underlined text with no shape. A cell with a background and a link filling
 * it is a button everywhere, and still a link where it is not.
 *
 * THE SAME ASK IS IN THE WORDS ABOVE IT. A reader whose client strips the
 * styling, or who is reading the plain-text part, still knows what to do.
 */
function ctaHtml(cta: NonNullable<EmailContent["callToAction"]>): string {
  if (!cta.heading?.trim() && !cta.label?.trim()) return "";
  const href = /^(mailto:|https?:\/\/)/i.test(cta.href ?? "") ? cta.href : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="margin:0 0 20px;background:#FBF3E6;border:1px solid #EADCC2;border-radius:6px;">
    <tr>
      <td style="padding:16px 18px 18px;">
        ${cta.heading?.trim()
          ? `<div style="font-size:15px;font-weight:700;line-height:1.35;color:${HEAD};">${escapeHtml(cta.heading.trim())}</div>`
          : ""}
        ${cta.lines.filter((l) => String(l ?? "").trim()).map((l) =>
          `<div style="margin-top:7px;font-size:13px;line-height:1.6;color:${INK};">${escapeHtml(String(l).trim())}</div>`).join("")}
        ${href && cta.label?.trim()
          ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
               <tr>
                 <td style="background:${ACCENT};border-radius:4px;">
                   <a href="${escapeHtml(href)}"
                      style="display:inline-block;padding:10px 18px;font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(cta.label.trim())}</a>
                 </td>
               </tr>
             </table>`
          : ""}
      </td>
    </tr>
  </table>`;
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

  /* ABOVE THE HEADING. A festival greeting belongs at the top of the message
     or it reads as an afterthought.

     ARTWORK WHEN THERE IS ARTWORK, words otherwise. A hosted https image is
     shown by Gmail and Apple Mail and blocked by Outlook until the reader
     asks for it — so the alt text carries the same greeting in full, and
     the plain-text part carries it too. That is the difference between this
     and a base64 image, which Gmail strips outright leaving nothing, and
     it is why the banner is linked rather than embedded.

     WIDTH ON THE TAG, HEIGHT DELIBERATELY NOT. Outlook renders through Word
     and sizes from the width attribute, keeping the drawn proportions. The
     height was there too at first, and a blocked image then reserved its
     full 188px — a reader with images off got one line of alt text floating
     in a white hole the size of the strip, which reads as a broken email.
     Without it the block collapses to the sentence, which is exactly what
     this greeting used to be. */
  const banner = content.greeting?.banner ?? null;
  const greetingHtml = !content.greeting
    ? ""
    : banner
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
           <tr>
             <td>
               <img src="${escapeHtml(banner.src)}" alt="${escapeHtml(banner.alt)}"
                    width="564"
                    style="display:block;width:100%;max-width:564px;height:auto;border:0;border-radius:6px;" />
             </td>
           </tr>
         </table>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                style="margin:0 0 18px;background:${ZEBRA};border:1px solid ${RULE};border-radius:6px;">
           <tr>
             <td style="padding:12px 14px;">
               <div style="font-size:14px;font-weight:700;color:${ACCENT};">${escapeHtml(content.greeting.headline)}</div>
               <div style="margin-top:3px;font-size:13px;line-height:1.6;color:${INK};">${escapeHtml(content.greeting.line)}</div>
             </td>
           </tr>
         </table>`;

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
          ${content.hero ? heroHtml(content.hero) : ""}
          <tr>
            <td style="padding:22px 18px 26px;">
              ${greetingHtml}
              ${heading}
              ${paragraphs(content.body)}
              ${q ? summaryHtml(q) : ""}
              ${q ? itemsHtml(q) : ""}
              ${q ? nextStepsHtml(q) : ""}
              ${productsHtml(content.products ?? [])}
              ${content.callToAction ? ctaHtml(content.callToAction) : ""}
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
              ${/* NOT REPEATED HERE. The signature above states the
                    certifications in one line; saying it again six lines
                    lower is the same claim twice in one message. */ ""}
              ${content.automated
                ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid ${RULE};font-size:11px;line-height:1.6;">`
                  + escapeHtml(automatedNotice(content.automated, company.name ?? ""))
                  + "</div>"
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
  void content.hero;
  const q = content.quotation ?? null;
  const out: string[] = [];
  /* Widest label is "Date of issue" at 13; 16 leaves room for a longer
     document name without the column jumping. */
  const PAD = 16;

  if (company.name) out.push(company.name.toUpperCase(), "Connect, Communicate & Collaborate", "");

  /* Same place as in the HTML, so the two versions of one email do not
     greet the reader in a different order. */
  if (content.greeting) {
    out.push(content.greeting.headline.toUpperCase(), content.greeting.line, "");
  }

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

  /* The same block as the HTML, in words. The logos and the colour rules
     are the only things this part cannot carry, and neither was ever what
     the block was for — the products were. */
  const products = content.products ?? [];
  if (products.length) {
    out.push("", "WHAT WE SUPPLY");
    for (const g of products) {
      out.push("", `  ${g.heading.toUpperCase()}`);
      if (g.detail?.trim()) out.push(`  ${g.detail.trim()}`);
      for (const b of g.bullets ?? []) if (String(b).trim()) out.push(`    - ${String(b).trim()}`);
      if (g.note?.trim()) out.push(`  ${g.note.trim()}`);
    }
  }

  const cta = content.callToAction;
  if (cta) {
    out.push("");
    if (cta.heading?.trim()) out.push(cta.heading.trim().toUpperCase());
    for (const l of cta.lines) if (String(l).trim()) out.push("", String(l).trim());
    /* The link in full, because a plain-text reader has no button to press
       and a bare label would be an instruction with nothing behind it. */
    if (cta.href?.trim()) out.push("", `  ${cta.label}: ${cta.href}`);
  }

  if (content.attachmentName) out.push("", "Attached: " + content.attachmentName);

  const sig = [
    sender.name,
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

  /* Last, and after the rule that separates the signature: a reader who
     stops at "Regards" has still read the message, and one who checks why
     they got it finds the answer where a footer belongs. */
  if (content.automated) {
    out.push("", automatedNotice(content.automated, company.name ?? ""));
  }

  return out.join("\n");
}
