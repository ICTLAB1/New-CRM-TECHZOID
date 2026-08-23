import { STATES } from "../geo/states";

/* GSTIN structural + checksum validation — entirely offline, no external
   API call. This does NOT confirm the number is actually registered with the
   government (that requires a paid GSP subscription), but it does catch the
   overwhelming majority of real-world errors: typos, transposed digits,
   wrong format.

   It also decodes two pieces of real data embedded in every valid GSTIN —
   the state code (first 2 digits) and the business's own PAN (characters
   3–12) — which is what powers the auto-fill.

   This is a full 15-character checksum, NOT a regex. A regex-only check
   passes transposed digits, which is exactly the error people make. */

const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export type GstinFailureReason = "empty" | "incomplete" | "format" | "checksum";

export type GstinResult =
  | { valid: false; reason: GstinFailureReason; clean: string }
  | {
      valid: true;
      clean: string;
      stateCode: string;
      stateName: string | null;
      /** Characters 3–12: the holder's PAN. Never overwrite a PAN the user
       *  already typed — offer it, don't impose it. */
      pan: string;
    };

export function validateGSTIN(raw: string | null | undefined): GstinResult {
  const clean = (raw || "").trim().toUpperCase();
  if (!clean) return { valid: false, reason: "empty", clean };
  if (clean.length < 15) return { valid: false, reason: "incomplete", clean };
  if (clean.length > 15) return { valid: false, reason: "format", clean };
  if (!GSTIN_SHAPE.test(clean)) return { valid: false, reason: "format", clean };

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const val = GSTIN_CHARSET.indexOf(clean[i] as string);
    const factor = i % 2 === 0 ? 1 : 2;
    const product = val * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expectedChar = GSTIN_CHARSET[(36 - (sum % 36)) % 36];
  if (expectedChar !== clean[14]) return { valid: false, reason: "checksum", clean };

  const stateCode = clean.slice(0, 2);
  const stateMatch = STATES.find(([, code]) => code === stateCode);
  return {
    valid: true,
    clean,
    stateCode,
    stateName: stateMatch ? stateMatch[0] : null,
    pan: clean.slice(2, 12),
  };
}

/** Human-facing message: say what to do, not just what failed. */
export function gstinMessage(result: GstinResult): string {
  if (result.valid) return "Valid GSTIN" + (result.stateName ? " — " + result.stateName : "");
  switch (result.reason) {
    case "empty":
      return "Enter a 15-character GSTIN, or leave blank if the customer is unregistered.";
    case "incomplete":
      return `A GSTIN is 15 characters — ${result.clean.length} entered so far.`;
    case "format":
      return "That isn't a GSTIN shape. Expected 2 digits, 5 letters, 4 digits, 1 letter, 1 character, 'Z', 1 character.";
    case "checksum":
      return "Checksum failed — usually two digits transposed. Check the number against the customer's certificate.";
  }
}
