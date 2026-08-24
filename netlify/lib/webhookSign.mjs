import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Webhook signing, both directions.
 *
 * Pulled out of the handlers so the signature format is unit-testable
 * without a running function or a network call — the same split `state.mjs`
 * uses for the OAuth `state` parameter.
 *
 * THE FORMAT IS THE WEBSITE'S, NOT OURS. The company's website documents
 * its deliveries as:
 *
 *     x-techzoid-signature: t=<unix>,v1=<hex>
 *
 * where the hex is an HMAC-SHA256 over the string "<t>.<body>". Signing the
 * timestamp ALONGSIDE the body is what stops a captured delivery being
 * replayed later: the signature only holds for the moment it was issued, so
 * an attacker cannot re-send yesterday's "deal.won" by editing the header.
 * Both directions use it, so one implementation and one set of tests cover
 * what the CRM sends and what it accepts.
 */

export const WEBHOOK_EVENT_KINDS = [
  "deal.created",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "activity.logged",
];

export function isValidEventKind(kind) {
  return WEBHOOK_EVENT_KINDS.includes(kind);
}

/** The envelope that goes over the wire: a stable id, the kind, when it
 *  happened, and the caller's payload untouched. */
export function buildEnvelope(eventKind, payload, now = Date.now()) {
  return {
    version: 1,
    id: randomUUID(),
    kind: eventKind,
    occurredAt: new Date(now).toISOString(),
    data: payload,
  };
}

/** The exact string both ends run through HMAC: the timestamp, a dot, then
 *  the body verbatim. Never a re-serialised copy of the body — key order
 *  could differ and the signatures would not match. */
export function signedMaterial(timestampSeconds, bodyString) {
  return `${timestampSeconds}.${bodyString}`;
}

/** Build the `x-techzoid-signature` header value for a body. */
export function signBody(bodyString, secret, now = Date.now()) {
  const t = Math.floor(now / 1000);
  const v1 = createHmac("sha256", secret).update(signedMaterial(t, bodyString), "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Pull `t` and `v1` out of a header. Returns null on anything unexpected —
 *  a malformed header is a rejection, never a partial match. */
export function parseSignatureHeader(header) {
  if (!header || typeof header !== "string") return null;
  let t = null;
  let v1 = null;
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=");
    if (key === "t") t = Number(value);
    if (key === "v1") v1 = value;
  }
  if (!Number.isFinite(t) || !v1 || !/^[0-9a-f]+$/i.test(v1)) return null;
  return { t, v1 };
}

/** How far out of date a delivery's timestamp may be. Five minutes each way
 *  covers clock drift and a slow retry without leaving a captured delivery
 *  replayable indefinitely. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verify an inbound delivery.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }`. Never throws on bad
 * input: every failure is the caller's, and the endpoint answers the same
 * way for all of them so nothing is learned from which one failed.
 */
export function verifySignature(bodyString, header, secret, now = Date.now()) {
  if (!secret) return { ok: false, reason: "unconfigured" };

  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed" };

  /* Age is checked BEFORE the HMAC so a flood of stale deliveries costs
     nothing to reject, but the result is not returned until after the
     comparison below — order of checks must not leak which one failed. */
  const ageSeconds = Math.abs(Math.floor(now / 1000) - parsed.t);

  const expected = createHmac("sha256", secret)
    .update(signedMaterial(parsed.t, bodyString), "utf8")
    .digest("hex");

  /* Constant time, length-checked first because timingSafeEqual throws on a
     length mismatch. */
  const a = Buffer.from(parsed.v1.toLowerCase());
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature" };

  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  return { ok: true };
}

export const MAX_DELIVERY_ATTEMPTS = 8;

/** Exponential backoff, doubling each step: 1s, 2s, 4s, 8s, 16s, 32s, 64s,
 *  128s. `attempt` is 1-based and counts the attempt that just failed — the
 *  wait is how long to hold before the next one. Total worst case across
 *  all 8 attempts is about 255s of waiting, comfortably inside a Background
 *  Function's execution budget (up to 15 minutes). */
export function backoffMs(attempt) {
  return Math.pow(2, attempt - 1) * 1000;
}
