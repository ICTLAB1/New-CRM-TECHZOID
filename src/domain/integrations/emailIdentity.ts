import type { EmailCompany } from "./emailTemplate";

/**
 * Who an email is from, assembled once.
 *
 * WHY THIS EXISTS. Four screens built this block by hand — the quotation
 * sender, the registration-link dialog, the armed follow-ups and the company
 * profile mailer — each reading the same settings keys and each forgetting a
 * different one. The customer could tell which screen had sent a message by
 * which detail was missing from the bottom of it. There is one copy now.
 *
 * THE DESIGNED SIGNATURE STRIP. The company has a signature image with its
 * partner badges and certification marks on it. It is referenced by URL,
 * never embedded: Gmail strips a `data:` image outright, so a signature
 * built that way disappears for most readers with nothing in its place.
 * Hosted on the CRM's own site, it is one request the reader's mail client
 * either makes or does not — and when it does not, the written signature
 * above it still says everything that matters. See EmailCompany.
 */

/**
 * Where the signature strip is served from — EMPTY UNTIL THE ARTWORK IS
 * ACTUALLY THERE.
 *
 * This pointed at /brand/email-signature.png while nothing had been put at
 * that address, and the result went to customers: a broken-image icon in
 * every signature, with the alt text spilling out underneath as a
 * paragraph. The code assumed "a company that has uploaded its strip gets
 * it automatically" — but nothing anywhere checked whether one had.
 *
 * So it is off until somebody supplies the file, and
 * `emailIdentity.test.ts` refuses to let this name a file that is not in
 * `public/`. Turning it on is one line, once the artwork is committed.
 */
export const SIGNATURE_IMAGE_PATH = "/brand/email-signature.png";

/**
 * What the strip is, in words.
 *
 * SHORT ON PURPOSE. This is what a reader sees when their mail client
 * blocks images, which in Outlook is the default — and it is what shows if
 * the image ever fails to load. The first version of this was the whole
 * list of partnerships and certifications, which read as a run-on sentence
 * wedged under a broken-image icon. A signature is not the place to recite
 * them; the artwork says it to anyone whose client shows pictures.
 *
 * It also claims nothing specific, which is the safer thing for text the
 * CRM generates rather than text somebody wrote.
 */
export const SIGNATURE_IMAGE_ALT = "TechZoid Technologies — partner and certification badges";

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** An absolute URL for a path on this site. Mail clients cannot resolve a
 *  relative one — there is no page for it to be relative to. */
export function absoluteUrl(path: string, origin?: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (origin ?? (typeof window === "undefined" ? "" : window.location.origin)).replace(/\/$/, "");
  return base ? `${base}${path.startsWith("/") ? "" : "/"}${path}` : path;
}

export interface CompanyIdentityOptions {
  /** Taken from the document model, so the email and the printed document
   *  cannot disagree about the address. */
  addressLines?: string[];
  /** The certification NAMES, from the same strip the document prints. */
  certifications?: string[];
  /** For the absolute signature URL when there is no browser — the server
   *  renders these too. */
  origin?: string;
}

/**
 * The company block for an email, from the settings row.
 *
 * Reads `settings.company` and nothing else, so a company that has filled
 * in Settings once has filled it in for every email the CRM sends.
 */
export function emailCompanyFrom(
  settings: Record<string, unknown>,
  options: CompanyIdentityOptions = {},
): EmailCompany {
  const company = (settings?.["company"] ?? {}) as Record<string, unknown>;

  /* Both offices, each with the country it rings, exactly as the signature
     shows them. An empty one is dropped rather than printed as a bare
     label. */
  /* THE UAE OFFICE IS ITS OWN SETTINGS BLOCK, with its own address, phone
     and licence numbers — it is not a field on the company. This read
     `company.phoneUae`, which nothing in the product has ever written, so
     the UAE line never appeared on a single signature. */
  const uae = (settings?.["uaeOffice"] ?? {}) as Record<string, unknown>;

  const phones = [
    { label: "India", number: text(company["phone"]) },
    { label: "UAE", number: text(uae["phone"]) || text(company["phoneUae"]) },
  ].filter((p) => p.number.trim());

  /* OFF UNLESS SOMETHING REAL POINTS AT A FILE.

     Either `signatureImage` is set on the company — an address somebody
     entered — or SIGNATURE_IMAGE_PATH names artwork that is actually in
     `public/`. Absent both, no strip is rendered at all, which is the whole
     fix: an <img> whose file is missing is not a blank space, it is a
     broken-image icon and a paragraph of alt text in a customer's inbox. */
  const configured = text(company["signatureImage"]).trim();
  const fallback = SIGNATURE_IMAGE_PATH.trim();
  const chosen = configured || (company["signatureImage"] === undefined ? fallback : "");
  const src = chosen ? absoluteUrl(chosen, options.origin) : "";

  /* THE OFFICES, FROM THE SETTINGS SOMEBODY CAN EDIT. India is assembled
     from the address fields on the company tab — the same ones printed on
     a quotation — so it cannot drift from the letterhead. The UAE office
     comes from its own section, where its address already lives beside its
     licence and tax numbers. */
  const india = [
    text(company["address"]),
    [text(company["city"]), text(company["state"])].filter(Boolean).join(", "),
    text(company["pincode"]),
  ].map((part) => part.trim()).filter(Boolean).join(", ");

  const offices = [
    { label: "India", address: india },
    { label: "UAE", address: text(uae["address"]).replace(/\s*\n\s*/g, ", ").trim() },
  ].filter((o) => o.address);

  return {
    name: text(company["name"]),
    tagline: text(company["tagline"]),
    website: text(company["website"]),
    phone: text(company["phone"]),
    email: text(company["email"]),
    logo: text(company["logo"]) || undefined,
    addressLines: options.addressLines ?? [],
    gstin: text(company["gstin"]),
    pan: text(company["pan"]),
    cin: text(company["cin"]),
    certifications: options.certifications ?? [],
    phones: phones.length > 1 ? phones : undefined,
    /* Both of them, or neither: one lone labelled address reads as though
       the other office has been closed. */
    offices: offices.length ? offices : undefined,
    services: text(company["services"]).trim() || undefined,
    signatureImage: src
      ? { src, alt: text(company["signatureImageAlt"]) || SIGNATURE_IMAGE_ALT, width: 600 }
      : null,
  };
}
