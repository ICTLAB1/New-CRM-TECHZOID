/**
 * Duplicate detection on customer save.
 *
 * Two rules, and one that matters more than the rest: this WARNS, it never
 * blocks. A salesperson entering a genuinely different company with a similar
 * name must be able to continue, and a hard block would simply teach them to
 * mangle the name until it saved.
 *
 * GSTIN is the stronger signal — it is a registered identifier, so a match is
 * near-certainly the same legal entity. A name match is a suggestion.
 */

/** Strip the legal-form suffix so "Acme Pvt Ltd" and "Acme Limited" collide. */
const SUFFIX = /\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|corp\.?)\.?$/gi;

export function normalizeCompanyName(s: string | null | undefined): string {
  let out = (s || "").trim().toLowerCase();
  /* Repeat: "Acme Pvt Ltd" carries two suffixes, and one pass leaves "acme pvt". */
  let previous = "";
  while (out !== previous) {
    previous = out;
    out = out.replace(SUFFIX, "").trim();
  }
  return out;
}

export interface DuplicateCandidate {
  id: string;
  company?: string;
  gstin?: string;
  phone?: string;
}

/** How sure the match is, which decides how firmly it is put to the user. */
export type DuplicateReason = "gstin" | "phone" | "name";

export interface DuplicateMatch<T extends DuplicateCandidate> {
  match: T;
  reason: DuplicateReason;
  /** GSTIN matches are near-certain; name matches are a suggestion. */
  byGstin: boolean;
}

/** Digits only, and only the last ten compared: the same number reaches the
 *  CRM as "+91 98100 12345", "09810012345" and "9810012345" depending on who
 *  typed it, and all three are the same person. */
export function normalizePhone(s: string | null | undefined): string {
  const digits = (s || "").replace(/[^0-9]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/**
 * Look for an existing customer that this one may duplicate.
 *
 * Only ever called for genuinely NEW records — editing an existing customer
 * must not raise a "duplicate of itself" false alarm. The `excludeId` guard
 * makes that explicit rather than relying on the caller.
 */
export function findDuplicate<T extends DuplicateCandidate>(
  candidate: DuplicateCandidate,
  existing: readonly T[],
  excludeId?: string,
): DuplicateMatch<T> | null {
  const others = excludeId ? existing.filter((c) => c.id !== excludeId) : existing;

  const gstin = (candidate.gstin || "").trim().toUpperCase();
  if (gstin) {
    const byGstin = others.find((c) => (c.gstin || "").trim().toUpperCase() === gstin);
    if (byGstin) return { match: byGstin, reason: "gstin", byGstin: true };
  }

  /* A phone number is nearly as strong as a GSTIN and far more often
     present: an unregistered customer has no GSTIN, but everybody has a
     number, and two records sharing one are almost always the same buyer. */
  const phone = normalizePhone(candidate.phone);
  if (phone) {
    const byPhone = others.find((c) => normalizePhone(c.phone) === phone);
    if (byPhone) return { match: byPhone, reason: "phone", byGstin: false };
  }

  const name = normalizeCompanyName(candidate.company);
  if (name) {
    const byName = others.find((c) => normalizeCompanyName(c.company) === name);
    if (byName) return { match: byName, reason: "name", byGstin: false };
  }

  return null;
}
