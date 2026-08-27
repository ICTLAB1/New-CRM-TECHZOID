import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { cachedTokenLife, credentialsPresent, testConnection, verifyGstin, verifyPan } from "../lib/sandbox.mjs";

/**
 * Check a GSTIN or a PAN against the government register.
 *
 * WHY THIS IS A FUNCTION AND NOT A CALL FROM THE BROWSER. Verification is a
 * paid API with a secret key. A key in front-end code is a key on the
 * internet, and an endpoint that verifies without asking who is calling is
 * somebody else's free verification service — which is exactly the mistake
 * ai-proxy shipped with in v1 and the reason every function here checks the
 * caller's session first.
 *
 * The register is asked; nothing here decides what the answer means. Reading
 * a registration, judging whether a name matches, and deciding what a blank
 * status implies all live in src/domain/verification/, where they are
 * tested. This handler validates the input, spends the call, and returns
 * what came back.
 */

/* Checked before spending a call, so an obvious typo costs nothing. Both
   shapes are also enforced in the app; this is the server saying so too,
   because a request does not have to come from the app. */
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid JSON.");

  const kind = String(body.kind ?? "").trim();

  /* Costs nothing and spends no verification, so it is allowed through
     before the rate limit — an admin diagnosing a broken key should not be
     locked out by the limit their broken key caused them to hit. */
  if (kind === "test") {
    const result = await testConnection();
    return json(event, result.ok ? 200 : 400, result);
  }

  if (!credentialsPresent()) {
    return fail(event, 400,
      "Verification isn't connected yet. Ask an admin to add SANDBOX_API_KEY and SANDBOX_API_SECRET in Netlify.");
  }

  /* Each verification is billed, so the limit is per person and tighter
     than the messaging ones. A salesperson checks a handful a day; a loop
     checks a thousand. */
  try {
    const rl = await consume(adminClient(), "verify-tax-id", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable, allowing:", err?.message ?? err);
  }

  if (kind === "gstin") {
    const gstin = String(body.value ?? "").trim().toUpperCase();
    if (!GSTIN_SHAPE.test(gstin)) {
      return fail(event, 400, "That isn't a complete GSTIN — it should be 15 characters.");
    }
    const result = await verifyGstin(gstin);
    if (!result.ok) return fail(event, result.status >= 500 ? 502 : 400, result.error);
    return json(event, 200, { kind: "gstin", value: gstin, result: result.body });
  }

  if (kind === "pan") {
    const pan = String(body.value ?? "").trim().toUpperCase();
    if (!PAN_SHAPE.test(pan)) {
      return fail(event, 400, "That isn't a PAN — it should be ten characters, like AACCN1234M.");
    }
    /* Consent is the caller's to give and is never assumed here. Refusing
       without it is the point: the register is being asked about a real
       person or company, and the request carries a claim that they agreed. */
    if (body.consent !== true) {
      return fail(event, 400, "A PAN can only be checked with the holder's consent.");
    }
    const result = await verifyPan({
      pan,
      name: String(body.name ?? "").trim().slice(0, 120),
      consent: true,
      /* Recorded with the request at the provider, so an audit of who asked
         about whom, and why, has an answer. */
      reason: String(body.reason ?? "").trim().slice(0, 200) || "Customer onboarding and invoicing checks",
    });
    if (!result.ok) return fail(event, result.status >= 500 ? 502 : 400, result.error);
    return json(event, 200, { kind: "pan", value: pan, result: result.body });
  }

  return fail(event, 400, "Ask for a 'gstin' or a 'pan' check.");
}

/** Reported by the diagnostics endpoint, so "is verification set up" has an
 *  answer that does not involve reading the Netlify dashboard. */
export const verificationStatus = () => ({
  configured: credentialsPresent(),
  tokenLifeSeconds: cachedTokenLife(),
});
