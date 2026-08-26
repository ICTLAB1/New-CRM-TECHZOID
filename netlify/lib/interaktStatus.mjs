/**
 * Reading a delivery status out of an Interakt webhook.
 *
 * WRITTEN TO BE FORGIVING, ON PURPOSE. Interakt's published documentation
 * describes the shape in prose — a `data.message` object, a `data.customer`
 * object, the `callback_data` we sent echoed back, and statuses of Sent,
 * Delivered, Read and Failed — without pinning every field name. Rather than
 * guess one exact shape and silently drop every callback if it is wrong,
 * this looks in the places the status and the id could plausibly be, and the
 * endpoint records the raw payload the first time it cannot find them.
 *
 * The cost of being wrong here is small and visible: a follow-up shows
 * "sent" instead of "delivered". The cost of being brittle is that nothing
 * ever updates and nobody can tell why.
 */

/** The four states WhatsApp reports, however the provider spells them. */
const STATES = ["failed", "read", "delivered", "sent"];

/**
 * The status, or "" when this payload is not about one.
 *
 * Checked longest-first-ish by severity: a payload mentioning both "sent"
 * and "failed" is a failure, and reading it as a send would show a customer
 * as reached when they were not.
 */
export function readStatus(payload) {
  const hay = [
    payload?.type,
    payload?.event,
    payload?.status,
    payload?.data?.message?.message_status,
    payload?.data?.message?.status,
    payload?.data?.status,
  ]
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase();

  if (!hay) return "";
  for (const state of STATES) {
    if (hay.includes(state)) return state;
  }
  return "";
}

/**
 * What we sent as `callbackData` when the message was queued: the follow-up
 * row's own id. It is the only field that ties a callback to a row with no
 * ambiguity, which is why it is sent in the first place.
 */
export function readCallbackData(payload) {
  const candidates = [
    payload?.callback_data,
    payload?.callbackData,
    payload?.data?.message?.callback_data,
    payload?.data?.message?.callbackData,
    payload?.data?.callback_data,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** The provider's own id for the message — the fallback match, and what
 *  Interakt's support will ask for. */
export function readMessageId(payload) {
  const candidates = [
    payload?.data?.message?.id,
    payload?.data?.message?.message_id,
    payload?.message_id,
    payload?.id,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Why it failed, short enough to sit in a table cell on a document. */
export function readFailureDetail(payload) {
  const candidates = [
    payload?.data?.message?.failure_reason,
    payload?.data?.message?.error,
    payload?.data?.error,
    payload?.error,
    payload?.message,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
  }
  return "";
}
