import { createHmac, randomUUID } from "node:crypto";

/**
 * Outbound webhook signing.
 *
 * Pulled out of the handler so the signature and the envelope shape are
 * unit-testable without a running function or a network call — the same
 * split `state.mjs` uses for the OAuth `state` parameter.
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
    id: randomUUID(),
    kind: eventKind,
    occurredAt: new Date(now).toISOString(),
    data: payload,
  };
}

/** HMAC-SHA256 over the exact bytes being sent, hex-encoded. Sign the
 *  string that is actually transmitted — signing a re-serialised copy risks
 *  a receiver computing a different signature over key-order differences. */
export function signBody(bodyString, secret) {
  return createHmac("sha256", secret).update(bodyString, "utf8").digest("hex");
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
