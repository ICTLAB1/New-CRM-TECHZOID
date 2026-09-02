/**
 * The signature block at the foot of every outreach email.
 *
 * WHAT THIS IS ALLOWED TO CONTAIN, and what it is not. Everything here comes
 * from the company's own settings — its name, its offices, its numbers, its
 * logo, the credentials it says it holds. None of it is invented and none of
 * it is drawn: the partner badges are uploaded by the company, because
 * Microsoft's, Adobe's and Cisco's marks belong to them and are issued to
 * partners as artwork. This file will render a badge somebody supplied and
 * will never produce one.
 *
 * TABLE LAYOUT, INLINE STYLES, ABSOLUTE URLS. Outlook renders neither a
 * stylesheet nor flexbox, strips `<style>` blocks in several versions, and
 * ignores anything positioned. A signature that looks right in Gmail and
 * collapses into a stack of unstyled lines in Outlook is worse than a plain
 * one, and Outlook is what most of the people this company writes to are
 * reading their mail in.
 *
 * THIS IS THE ONE THAT RENDERS WHAT IS ACTUALLY SENT. Its twin in
 * src/domain/outreach/signature.ts renders the preview, and a parity test
 * compares the exact HTML both produce — a preview that does not match what
 * is sent is worse than no preview.
 */

const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const INK = "#1f2937";
const MUTED = "#4b5563";
const BRAND = "#0f4c81";
const LINK = "#2563eb";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** An https or data URL, or nothing. Anything else — javascript:, or a
 *  protocol-relative URL that resolves to http — is dropped rather than
 *  rendered, because a signature is on every message this company sends. */
export function safeSrc(value) {
  const v = String(value ?? "").trim();
  if (/^https:\/\//i.test(v)) return v;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(v)) return v;
  return "";
}

/** A website written "www.x.com" still has to be a link. */
export function siteHref(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

const row = (html) => `<tr><td style="padding:0;">${html}</td></tr>`;

/**
 * The signature, as one table.
 *
 * Every part is optional: a company that has not uploaded a logo, or has no
 * UAE office, gets a signature without those lines rather than an empty box
 * where one should be.
 */
export function renderSignature(input) {
  const rows = [];

  const name = String(input.name ?? "").trim();
  if (name) {
    rows.push(row(
      `<div style="font-family:${FONT};font-size:15px;font-weight:bold;color:${BRAND};` +
      `letter-spacing:.02em;padding-bottom:2px;">${escapeHtml(name.toUpperCase())}</div>`,
    ));
  }
  if (input.designation) {
    rows.push(row(
      `<div style="font-family:${FONT};font-size:13px;color:${MUTED};padding-bottom:8px;">` +
      `${escapeHtml(input.designation)}</div>`,
    ));
  }

  const logo = safeSrc(input.logo);
  if (logo) {
    /* Width only, height auto: giving both to an <img> whose stored
       dimensions have drifted from the file stretches it. 180px is a
       signature logo — large enough to read, small enough not to dominate. */
    const w = Math.min(180, Math.max(60, Number(input.logoW) || 180));
    rows.push(row(
      `<img src="${escapeHtml(logo)}" width="${w}" alt="${escapeHtml(input.companyName ?? "")}" ` +
      `style="display:block;border:0;outline:none;text-decoration:none;width:${w}px;height:auto;padding:2px 0 6px 0;" />`,
    ));
  }

  if (input.companyName) {
    rows.push(row(
      `<div style="font-family:${FONT};font-size:14px;font-weight:bold;color:${INK};">` +
      `${escapeHtml(input.companyName.toUpperCase())}</div>`,
    ));
  }
  if (input.tagline) {
    rows.push(row(
      `<div style="font-family:${FONT};font-size:12px;font-style:italic;color:${MUTED};padding-bottom:8px;">` +
      `${escapeHtml(input.tagline)}</div>`,
    ));
  }

  /* The offices. Labelled rather than flagged: an emoji flag renders as a
     pair of letters in Outlook on Windows, which reads as a typo. */
  if (input.indiaAddress) {
    rows.push(row(office("INDIA", input.indiaAddress)));
  }
  if (input.uaeAddress) {
    rows.push(row(office("UAE", input.uaeAddress)));
  }

  const contact = [];
  if (input.mobile) contact.push(`Mobile: ${escapeHtml(input.mobile)}`);
  if (input.uaeMobile) contact.push(`M: ${escapeHtml(input.uaeMobile)}`);
  if (contact.length) {
    rows.push(row(
      `<div style="font-family:${FONT};font-size:13px;color:${INK};padding-top:6px;">` +
      contact.join("&nbsp;&nbsp;|&nbsp;&nbsp;") + `</div>`,
    ));
  }

  if (input.email) {
    rows.push(row(
      `<div style="font-family:${FONT};font-size:13px;color:${INK};">Email: ` +
      `<a href="mailto:${escapeHtml(input.email)}" style="color:${LINK};text-decoration:underline;">` +
      `${escapeHtml(input.email)}</a></div>`,
    ));
  }
  if (input.website) {
    rows.push(row(
      `<div style="font-family:${FONT};font-size:13px;color:${INK};padding-bottom:8px;">Website: ` +
      `<a href="${escapeHtml(siteHref(input.website))}" style="color:${LINK};text-decoration:underline;">` +
      `${escapeHtml(input.website)}</a></div>`,
    ));
  }

  if (input.credentials) {
    rows.push(row(
      `<div style="font-family:${FONT};font-size:12px;font-weight:bold;color:${BRAND};padding-top:6px;">` +
      `${escapeHtml(input.credentials)}</div>`,
    ));
  }

  /* Badges the company uploaded. Laid out as table cells rather than
     inline-block, which Outlook drops. */
  const badges = (input.badges ?? []).filter((b) => safeSrc(b.src));
  if (badges.length) {
    const cells = badges.map((b) => {
      const w = Math.min(120, Math.max(40, Number(b.width) || 90));
      return `<td style="padding:6px 10px 0 0;vertical-align:middle;">` +
        `<img src="${escapeHtml(safeSrc(b.src))}" width="${w}" alt="${escapeHtml(b.label)}" ` +
        `style="display:block;border:0;width:${w}px;height:auto;" /></td>`;
    }).join("");
    rows.push(row(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
    ));
  }

  if (input.disclaimer) {
    rows.push(row(
      `<div style="font-family:${FONT};font-size:11px;font-style:italic;color:#b91c1c;padding-top:8px;">` +
      `${escapeHtml(input.disclaimer)}</div>`,
    ));
  }

  if (!rows.length) return "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse;margin:24px 0 0 0;">${rows.join("")}</table>`;
}

function office(label, address) {
  return `<div style="font-family:${FONT};font-size:12px;color:${INK};padding-top:3px;">` +
    `<strong style="color:${BRAND};">${escapeHtml(label)}</strong>&nbsp;: ${escapeHtml(address)}</div>`;
}

/** Build the input from the workspace settings and the person sending. */
export function signatureFrom(settings, user) {
  const company = settings["company"] ?? {};
  const uae = settings["uaeOffice"] ?? {};
  const sig = settings["emailSignature"] ?? {};

  const indiaParts = [company.address, company.city, company.state, company.pincode, company.country]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);

  return {
    name: user?.name ?? "",
    designation: user?.designation ?? String(settings["signatoryDesignation"] ?? ""),
    email: user?.email ?? String(company.email ?? ""),
    mobile: String(company.phone ?? ""),

    companyName: String(company.name ?? ""),
    tagline: String(company.tagline ?? ""),
    logo: String(company.logo ?? ""),
    logoW: Number(company.logoW ?? 0),
    logoH: Number(company.logoH ?? 0),

    indiaAddress: indiaParts.join(", "),
    uaeAddress: String(uae.address ?? ""),
    uaeMobile: String(uae.phone ?? ""),

    website: String(company.website ?? ""),
    credentials: String(sig.credentials ?? ""),
    badges: Array.isArray(sig.badges) ? sig.badges : [],
    disclaimer: String(sig.disclaimer ?? ""),
  };
}
