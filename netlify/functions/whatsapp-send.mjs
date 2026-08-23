import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { normalisePhone } from "../lib/validate.mjs";

/**
 * Send a WhatsApp message through the connected provider.
 *
 * The provider is Whapi.Cloud, a QR-linked service — unchanged from v1,
 * including the environment variable name, because a deployment already has
 * WHATSAPP_API_TOKEN set and pointing this at a different API would silently
 * stop a working integration. Swapping provider means changing the URL and
 * the body shape in `deliver` and nothing else; the sign-in check, the limit
 * and the CRM-side call all stay as they are.
 *
 * The app always offers "Open in WhatsApp instead" as well, which needs no
 * setup and always works — so this failing is an inconvenience, never a dead
 * end. The messages below say that, because a salesperson standing in front
 * of a customer needs the next step, not a diagnosis.
 */

const MAX_MESSAGE = 4000;

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid JSON.");

  const phone = normalisePhone(body.to);
  const message = String(body.message ?? "");

  if (!phone || !message) return fail(event, 400, "A phone number and a message are both required.");
  if (!/^\d{10,15}$/.test(phone)) {
    return fail(event, 400, "That doesn't look like a phone number. Include the country code, for example +91 98100 12345.");
  }
  if (message.length > MAX_MESSAGE) {
    return fail(event, 400, `WhatsApp messages are limited to ${MAX_MESSAGE.toLocaleString("en-IN")} characters.`);
  }

  const token = process.env.WHATSAPP_API_TOKEN;
  if (!token) {
    return fail(event, 400,
      "WhatsApp isn't connected yet. Use “Open in WhatsApp instead” — it needs no setup — or ask an admin to connect a provider in Settings → Integrations.");
  }

  /* A failing limiter must not block a send; it is logged instead. */
  try {
    const rl = await consume(adminClient(), "whatsapp-send", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable:", err?.message ?? err);
  }

  return deliver(event, { token, phone, message });
}

async function deliver(event, { token, phone, message }) {
  try {
    const resp = await fetch("https://gate.whapi.cloud/messages/text", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ to: phone, body: message }),
    });
    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      /* The provider's own wording tends to be internal ("bad_request:
         channel not authorized"). Log it; tell the sender what to do. */
      console.error("whatsapp provider refused:", resp.status, result?.error?.code ?? result?.error?.message);
      return fail(event, 400, "WhatsApp refused to send that. Use “Open in WhatsApp instead” to send it yourself.");
    }
    return json(event, 200, { success: true, id: result?.message?.id ?? result?.id ?? null });
  } catch (err) {
    return fail(event, 502, "Could not reach WhatsApp. Use “Open in WhatsApp instead” to send it yourself.", err?.message);
  }
}
