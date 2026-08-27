/**
 * Reading a PAN verification back.
 *
 * A PAN check returns far less than a GSTIN one — the name it is held in,
 * what kind of holder it is, and whether it is valid. That is the whole
 * answer, and it is enough for the question a salesperson is asking: is
 * this the right number for this company.
 *
 * CONSENT IS NOT A DETAIL. Verifying somebody's PAN against the income-tax
 * department's register requires their consent, and the provider's request
 * carries a consent flag and a stated reason. That flag is set from a box
 * the person raising the check ticks — never defaulted to yes in code. The
 * wording lives beside the box in the customer sheet.
 */

export interface PanVerification {
  pan: string;
  /** The name the PAN is registered in. */
  name: string;
  /** "Individual", "Company", "Firm/LLP", … as the register puts it. */
  category: string;
  /** Whether the register recognises it. */
  valid: boolean;
  /** What the register actually said, for when `valid` is false. */
  status: string;
  /** Whether the PAN is linked to an Aadhaar. Empty when not stated. */
  aadhaarSeeding: string;
}

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => !!v && typeof v === "object" && !Array.isArray(v);

const FIELDS = {
  pan: ["pan", "pan_number", "panNumber"],
  name: ["full_name", "fullName", "name", "name_as_per_pan", "registered_name"],
  category: ["category", "pan_type", "panType", "holder_type", "type"],
  status: ["status", "pan_status", "result", "valid"],
  aadhaarSeeding: ["aadhaar_seeding_status", "aadhaarSeedingStatus", "aadhaar_seeding"],
} as const;

function pick(bag: Bag, names: readonly string[]): string {
  for (const name of names) {
    const value = bag[name];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "boolean") return value ? "VALID" : "INVALID";
    if (typeof value === "number") return String(value);
  }
  return "";
}

function unwrap(payload: unknown, depth = 0): Bag | null {
  if (!isBag(payload) || depth > 4) return null;
  if (FIELDS.pan.some((k) => payload[k]) || FIELDS.name.some((k) => payload[k])) return payload;
  for (const key of ["data", "result", "response", "payload"]) {
    const inner = unwrap(payload[key], depth + 1);
    if (inner) return inner;
  }
  return null;
}

/** Wordings the register uses for a PAN it recognises. Anything else — an
 *  unfamiliar phrase, a blank — is NOT treated as valid: saying a bad PAN
 *  is good is the expensive direction to be wrong in. */
const VALID = /^(valid|active|existing and valid|e)$/i;

export function parsePanResponse(payload: unknown): PanVerification | null {
  const bag = unwrap(payload);
  if (!bag) return null;
  const pan = pick(bag, FIELDS.pan).toUpperCase();
  const name = pick(bag, FIELDS.name);
  if (!pan && !name) return null;
  const status = pick(bag, FIELDS.status);
  return {
    pan,
    name,
    category: pick(bag, FIELDS.category),
    valid: VALID.test(status.trim()),
    status,
    aadhaarSeeding: pick(bag, FIELDS.aadhaarSeeding),
  };
}

/** The ten-character shape, checked before spending a call on it. */
export const looksLikePan = (pan: string): boolean =>
  /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(pan ?? "").trim().toUpperCase());

/**
 * The PAN a GSTIN contains.
 *
 * Characters 3–12 of a GSTIN are the holder's PAN, so a customer with a
 * verified GSTIN already has a PAN worth checking without anybody typing
 * one — and a PAN typed by hand that disagrees with the one inside their
 * GSTIN is a data-entry error worth catching.
 */
export const panWithinGstin = (gstin: string): string => {
  const clean = String(gstin ?? "").trim().toUpperCase();
  return clean.length === 15 ? clean.slice(2, 12) : "";
};
