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

/** Where the signature strip is served from, on whichever site this is. */
export const SIGNATURE_IMAGE_PATH = "/brand/email-signature.png";

/**
 * What the strip claims, in words.
 *
 * This is what a reader sees when their mail client blocks the image, which
 * in Outlook is the default. It is deliberately a plain list of what the
 * artwork already says — nothing here asserts a partnership or a
 * certification the company has not been granted, and nothing should be
 * added to it that the strip does not show.
 */
export const SIGNATURE_IMAGE_ALT =
  "TechZoid Technologies Private Limited — authorised partner and reseller: Microsoft Solutions Partner, "
  + "Adobe Certified Reseller, Autodesk Reseller, Zoho, HP, Dell, Lenovo, Cisco. "
  + "Certified and registered: ISO 9001:2015, ISO 27001:2022, ISO 20000, MSME, DPIIT Startup India, "
  + "GeM registered seller.";

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
  const phones = [
    { label: "India", number: text(company["phone"]) },
    { label: "UAE", number: text(company["phoneUae"] ?? company["uaePhone"]) },
  ].filter((p) => p.number.trim());

  /* CONFIGURED, WITH A SENSIBLE DEFAULT. A company that has uploaded its
     strip to the site gets it on every email without anybody setting a
     field; one that sets `signatureImage` to an empty string has turned it
     off deliberately. */
  const configured = company["signatureImage"];
  const src = configured === undefined
    ? absoluteUrl(SIGNATURE_IMAGE_PATH, options.origin)
    : text(configured) && absoluteUrl(text(configured), options.origin);

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
    signatureImage: src
      ? { src, alt: text(company["signatureImageAlt"]) || SIGNATURE_IMAGE_ALT, width: 600 }
      : null,
  };
}
