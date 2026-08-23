/**
 * Phone numbers for WhatsApp.
 *
 * The same rule runs on the server (netlify/lib/validate.mjs) so a message
 * sent through the provider and one opened in WhatsApp by hand reach the
 * same person. The cases are pinned by test on this side.
 */

/**
 * Digits only, with a country code.
 *
 * India is assumed for a bare ten-digit number, because that is how every
 * number in this CRM is typed. A leading 0 is a domestic trunk prefix and is
 * dropped — "09810012345" is the same number as "9810012345".
 */
export function normalisePhone(value: string | null | undefined, defaultCountryCode = "91"): string {
  let digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = defaultCountryCode + digits;
  return digits;
}

/** Roughly right, deliberately loose: country codes vary from 8 to 15 digits
 *  and refusing a valid number is worse than letting WhatsApp refuse it. */
export const looksLikePhone = (value: string | null | undefined): boolean =>
  /^\d{10,15}$/.test(normalisePhone(value));

/**
 * The wa.me link behind "Open in WhatsApp instead".
 *
 * This is the fallback that always works — no provider, no token, no setup —
 * so it must never be the thing that breaks. v1 passed the raw digits, which
 * sent a ten-digit Indian number to wa.me without a country code and opened
 * a chat with nobody.
 */
export function whatsappLink(phone: string | null | undefined, message: string): string {
  const digits = normalisePhone(phone);
  const text = encodeURIComponent(message ?? "");
  return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
}
