import { getSupabase, isSupabaseConfigured } from "./supabase";
import { parseGstinResponse, type GstinVerification } from "../domain/verification/gstin";
import { parsePanResponse, type PanVerification } from "../domain/verification/pan";

/**
 * Checking a GSTIN or a PAN against the government register.
 *
 * The provider's key is a secret and stays on the server: the browser calls
 * our own Netlify function, which holds the credentials and asks Sandbox.
 * See netlify/functions/verify-tax-id.mjs. Nothing about the provider is
 * visible from here, which is also what makes changing provider a one-file
 * job on the server rather than a change to this screen.
 */

export type VerifyOutcome<T> =
  | { state: "ok"; result: T }
  /** The register answered, and its answer was not a registration — no such
   *  number, or one it would not accept. Not the same as a failure, and the
   *  UI says so differently. */
  | { state: "not-found"; message: string }
  /** We could not ask: not configured, no session, offline, provider down. */
  | { state: "unavailable"; message: string };

/** Whether the feature can be offered at all. The preview has no server. */
export const verificationAvailable = (): boolean => isSupabaseConfigured();

/** The failure arm never carries a result, so it is spelled without one —
 *  which lets every caller read `outcome.message` without a cast. */
type AskFailure = Exclude<VerifyOutcome<never>, { state: "ok" }>;

async function ask(body: Record<string, unknown>): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; outcome: AskFailure }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, outcome: { state: "unavailable", message: "Verification needs a signed-in workspace." } };
  }

  let token: string | undefined;
  try {
    const { data } = await getSupabase().auth.getSession();
    token = data.session?.access_token;
  } catch { /* handled below, same as no session */ }
  if (!token) {
    return { ok: false, outcome: { state: "unavailable", message: "Your session has ended. Sign in again." } };
  }

  let resp: Response;
  try {
    resp = await fetch("/.netlify/functions/verify-tax-id", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, outcome: { state: "unavailable", message: "Couldn't reach the server. Check your connection." } };
  }

  const payload = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    const message = typeof payload["error"] === "string" ? (payload["error"] as string) : "That check didn't work.";
    /* 400 from our function means the register gave a real answer about the
       number; 429, 502 and the rest mean we could not ask properly. Telling
       a salesperson their customer's GSTIN is bad when in fact the service
       was down is the mistake worth avoiding. */
    return { ok: false, outcome: { state: resp.status === 400 ? "not-found" : "unavailable", message } };
  }
  return { ok: true, payload };
}

export async function verifyGstin(gstin: string): Promise<VerifyOutcome<GstinVerification>> {
  const answer = await ask({ kind: "gstin", value: gstin });
  if (!answer.ok) return answer.outcome;
  const parsed = parseGstinResponse(answer.payload["result"]);
  if (!parsed) {
    return { state: "unavailable", message: "The register answered, but not in a way this CRM could read. An admin can check the function log." };
  }
  return { state: "ok", result: parsed };
}

export async function verifyPan(args: {
  pan: string;
  name?: string;
  /** Ticked by the person raising the check. Never defaulted. */
  consent: boolean;
  reason?: string;
}): Promise<VerifyOutcome<PanVerification>> {
  const answer = await ask({ kind: "pan", value: args.pan, name: args.name ?? "", consent: args.consent, reason: args.reason ?? "" });
  if (!answer.ok) return answer.outcome;
  const parsed = parsePanResponse(answer.payload["result"]);
  if (!parsed) {
    return { state: "unavailable", message: "The register answered, but not in a way this CRM could read. An admin can check the function log." };
  }
  return { state: "ok", result: parsed };
}

/** Prove the credentials work. Spends no verification. */
export async function testVerificationConnection(): Promise<{ ok: boolean; message: string }> {
  const answer = await ask({ kind: "test" });
  if (!answer.ok) return { ok: false, message: answer.outcome.message };
  return { ok: true, message: "Connected. Sandbox issued a token." };
}
