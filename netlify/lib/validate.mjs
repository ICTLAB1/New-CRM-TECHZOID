/** Input validation shared by the public and authenticated endpoints. */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const isEmail = (v) => EMAIL_RE.test(String(v ?? "").trim());
export const isPan = (v) => PAN_RE.test(String(v ?? "").trim().toUpperCase());

/**
 * Full GSTIN validation, shape and checksum.
 *
 * The client validates too, but a client check is a convenience: anyone can
 * call this endpoint directly, so the server verifies independently rather
 * than trusting a format regex alone.
 */
export function isGstin(value) {
  const clean = String(value ?? "").trim().toUpperCase();
  if (!GSTIN_SHAPE.test(clean)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const val = GSTIN_CHARSET.indexOf(clean[i]);
    const factor = i % 2 === 0 ? 1 : 2;
    const product = val * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36] === clean[14];
}

/** Trim, cap and coerce. Everything stored from a public form goes through
 *  this so an unbounded field cannot be used to fill the database. */
export function str(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

/** Addresses given as a string or a list, cleaned and validated together. */
export function emailList(value) {
  const list = (Array.isArray(value) ? value : value ? String(value).split(",") : [])
    .map((a) => String(a).trim())
    .filter(Boolean);
  const invalid = list.find((a) => !isEmail(a));
  return { list, invalid: invalid ?? null };
}

/** Attachment guard: a base64 PDF, size-capped before it reaches a provider. */
export function checkAttachment(base64, name, maxBytes = 8 * 1024 * 1024) {
  if (!base64 && !name) return { ok: true, attachment: null };
  if (!base64 || !name) return { ok: false, error: "An attachment needs both a name and its contents." };
  const clean = String(base64).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return { ok: false, error: "The attachment is not valid base64." };
  const bytes = Math.floor((clean.length * 3) / 4);
  if (bytes > maxBytes) {
    return { ok: false, error: `That attachment is ${(bytes / 1048576).toFixed(1)} MB. The limit is ${maxBytes / 1048576} MB.` };
  }
  return { ok: true, attachment: { base64: clean, name: str(name, 120), bytes } };
}

/**
 * A phone number as WhatsApp wants it: digits only, with a country code.
 *
 * India is assumed for a bare ten-digit number, because that is how every
 * number in this CRM is typed. A leading 0 is a domestic trunk prefix and is
 * dropped — "09810012345" is the same number as "9810012345".
 *
 * Mirrored, with the same cases under test, in src/domain/integrations/phone.ts.
 */
export function normalisePhone(value, defaultCountryCode = "91") {
  let digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = defaultCountryCode + digits;
  return digits;
}
