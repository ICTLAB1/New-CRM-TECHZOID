import { timingSafeEqual } from "node:crypto";
import { adminClient } from "../lib/auth.mjs";
import { readCallbackData, readFailureDetail, readMessageId, readStatus } from "../lib/interaktStatus.mjs";

/**
 * Delivery status for WhatsApp follow-ups, called by Interakt.
 *
 * WHAT AUTHENTICATES A CALLER. Interakt does not sign its webhooks, so there
 * is no HMAC to check the way there is for the website sync. The credential
 * is the URL: a 32-byte random key held only by Interakt and this database,
 * compared in constant time. That makes the callback URL itself a secret —
 * it is shown to an admin once and can be rotated the moment anyone thinks
 * it has been pasted somewhere it should not be.
 *
 * ALWAYS 200, EXCEPT WHEN REFUSED. A webhook sender retries anything that is
 * not a success, so answering 500 because one row could not be matched turns
 * a cosmetic miss into a retry loop. Anything understood is applied; anything
 * not is logged with its shape and acknowledged.
 *
 * THIS ENDPOINT CHANGES NOTHING THE PRODUCT ACTS ON. It writes
 * `delivery_state`, which is what happened to the message out in the world.
 * `state` — what the CRM did — is untouched, so no schedule, no stop rule,
 * and no follow-up ever moves because of something a caller here said.
 */

const MAX_BODY_BYTES = 100_000;

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  const raw = event.body || "";
  if (raw.length > MAX_BODY_BYTES) return { statusCode: 413, body: "Payload too large" };

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("whatsapp-status not configured:", err?.message ?? err);
    /* Our fault, so the sender SHOULD retry. */
    return { statusCode: 500, body: "Not configured" };
  }

  const { data: secretRow } = await admin
    .from("webhook_secrets").select("secret").eq("id", "whatsapp").maybeSingle();
  const expected = secretRow?.secret ?? "";
  const supplied = String(event.queryStringParameters?.k ?? "");

  if (!expected || !constantEquals(supplied, expected)) {
    /* One answer for every rejection: a caller learns nothing from which
       check failed. */
    return { statusCode: 401, body: "Unauthorized" };
  }

  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return { statusCode: 200, body: "ignored" };
  }

  const status = readStatus(payload);
  const rowId = readCallbackData(payload);
  const messageId = readMessageId(payload);

  if (!status) {
    /* Not every Interakt webhook is a delivery status — incoming customer
       messages come through here too. Acknowledged and dropped. */
    return { statusCode: 200, body: "ignored" };
  }

  if (!rowId && !messageId) {
    /* The shape was not what this expects. Logged with its keys — never its
       values, which carry a customer's phone number — so it can be matched
       against the real payload rather than guessed at again. */
    console.warn("whatsapp-status: no id in payload; top-level keys:", Object.keys(payload ?? {}).join(","));
    return { statusCode: 200, body: "ignored" };
  }

  const patch = {
    delivery_state: status,
    updated_at: new Date().toISOString(),
  };
  if (status === "delivered") patch.delivered_at = new Date().toISOString();
  if (status === "read") {
    patch.read_at = new Date().toISOString();
    /* Read implies delivered, and a callback for one can arrive without the
       other ever having been sent. */
    patch.delivered_at = patch.delivered_at ?? new Date().toISOString();
  }
  if (status === "failed") patch.delivery_detail = readFailureDetail(payload) || "WhatsApp could not deliver it.";
  if (messageId) patch.provider_message_id = messageId;

  /* Matched on the row id we sent as callbackData, which is exact. The
     provider's message id is the fallback for a callback that does not echo
     it back. */
  const query = rowId
    ? admin.from("follow_ups").update(patch).eq("id", rowId)
    : admin.from("follow_ups").update(patch).eq("provider_message_id", messageId);

  const { error } = await query;
  if (error) {
    console.error("whatsapp-status: could not record", status, "-", error.message);
    /* Still 200: a row that cannot be updated is not something the sender
       can fix by trying again. */
    return { statusCode: 200, body: "not recorded" };
  }

  return { statusCode: 200, body: "ok" };
}

/** Constant time, and length-safe: comparing different-length buffers throws
 *  in timingSafeEqual, and returning early on length is itself a leak of one
 *  bit — so both sides are padded to a fixed width first. */
function constantEquals(a, b) {
  const width = 128;
  const left = Buffer.alloc(width);
  const right = Buffer.alloc(width);
  left.write(String(a).slice(0, width));
  right.write(String(b).slice(0, width));
  return timingSafeEqual(left, right);
}
