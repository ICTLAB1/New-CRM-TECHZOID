import { fail, guard, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume } from "../lib/ratelimit.mjs";
import { MAX_DELIVERY_ATTEMPTS, backoffMs, buildEnvelope, isValidEventKind, signBody } from "../lib/webhookSign.mjs";

/**
 * Delivers one outbound webhook event to the company's own website.
 *
 * A NETLIFY BACKGROUND FUNCTION (note the filename): Netlify answers the
 * caller immediately and keeps running this in the background for up to 15
 * minutes, which is what "retry with backoff" needs — a normal function's
 * response window is nowhere near long enough for eight attempts doubling
 * from one second. The browser fires this and moves on; nothing here may
 * ever block a screen waiting for a customer's website to answer.
 *
 * Two secrets never reach the browser: the signing secret (webhook_secrets,
 * no client-facing RLS policy at all) and the destination's own response —
 * only a short status line is written to webhook_deliveries for the
 * settings screen to show.
 */

const MAX_PAYLOAD_BYTES = 20_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithTimeout(url, body, headers, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "POST", headers, body, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid JSON.");

  const eventKind = String(body.eventKind ?? "");
  if (!isValidEventKind(eventKind)) return fail(event, 400, "Unrecognised event kind.");

  const payload = body.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fail(event, 400, "The event payload must be an object.");
  }

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "Webhooks aren't configured on the server yet.", err?.message);
  }

  const rl = await consume(admin, "webhook-deliver", user.id);
  if (!rl.allowed) {
    /* Silent, not an error the caller needs to see — this fires from
       background CRM activity, not a button someone is watching. */
    console.warn("webhook-deliver rate limited for", user.id);
    return { statusCode: 202, body: "" };
  }

  /* Netlify answers the caller with 202 the moment this invocation starts —
     that response has already gone out before this line runs, which is the
     entire point of a background function. What happens here is AWAITED
     anyway: an un-awaited promise risks the platform freezing this
     instance before the retry loop's sleeps and later fetches complete. */
  try {
    await deliver(admin, eventKind, payload);
  } catch (err) {
    console.error("webhook delivery crashed:", err?.message ?? err);
  }

  return { statusCode: 202, body: "" };
}

async function deliver(admin, eventKind, payload) {
  const { data: settingsRow } = await admin.from("settings").select("data").eq("id", "main").maybeSingle();
  const webhook = (settingsRow?.data ?? {}).webhook ?? {};
  const endpointUrl = String(webhook.endpointUrl ?? "").trim();
  if (!webhook.enabled || !endpointUrl) return; // Not configured — nothing to do.

  let url;
  try {
    url = new URL(endpointUrl);
    if (url.protocol !== "https:") return;
  } catch {
    return; // A malformed URL was saved somehow; nothing safe to call.
  }

  const { data: secretRow } = await admin.from("webhook_secrets").select("secret").eq("id", "main").maybeSingle();
  const secret = secretRow?.secret ?? "";
  if (!secret) return; // No secret generated yet — deliveries would be unsigned.

  const envelope = buildEnvelope(eventKind, payload);
  const bodyString = JSON.stringify(envelope).slice(0, MAX_PAYLOAD_BYTES * 2);
  if (bodyString.length > MAX_PAYLOAD_BYTES) {
    await logDelivery(admin, envelope, "failed", 0, "Payload too large to send.");
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    "x-techzoid-event-id": envelope.id,
    "x-techzoid-signature": signBody(bodyString, secret),
  };

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
    try {
      const resp = await postWithTimeout(url.toString(), bodyString, headers);
      if (resp.ok) {
        await logDelivery(admin, envelope, "delivered", attempt);
        return;
      }
      lastError = `HTTP ${resp.status}`;
    } catch (err) {
      lastError = err?.name === "AbortError" ? "Timed out" : (err?.message ?? "Network error");
    }
    if (attempt < MAX_DELIVERY_ATTEMPTS) await sleep(backoffMs(attempt));
  }

  await logDelivery(admin, envelope, "failed", MAX_DELIVERY_ATTEMPTS, lastError);
}

async function logDelivery(admin, envelope, status, attempts, lastError) {
  try {
    await admin.from("webhook_deliveries").insert({
      event_id: envelope.id,
      event_kind: envelope.kind,
      status,
      attempts,
      last_error: lastError ?? null,
      delivered_at: status === "delivered" ? new Date().toISOString() : null,
    });
  } catch (err) {
    console.error("could not record webhook delivery:", err?.message ?? err);
  }
}
