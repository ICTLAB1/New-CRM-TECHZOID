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
}

export interface DuplicateMatch<T extends DuplicateCandidate> {
  match: T;
  /** GSTIN matches are near-certain; name matches are a suggestion. */
  byGstin: boolean;
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
    if (byGstin) return { match: byGstin, byGstin: true };
  }

  const name = normalizeCompanyName(candidate.company);
  if (name) {
    const byName = others.find((c) => normalizeCompanyName(c.company) === name);
    if (byName) return { match: byName, byGstin: false };
  }

  return null;
}
