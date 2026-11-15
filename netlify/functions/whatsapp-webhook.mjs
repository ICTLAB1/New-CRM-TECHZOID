import { createHmac, timingSafeEqual } from "node:crypto";
import { adminClient } from "../lib/auth.mjs";
import { sendMail } from "../lib/mailer.mjs";
import { nextStatus, parseWebhook } from "../lib/whatsappEvents.mjs";
import { alertEmailOf } from "../lib/whatsappConsent.mjs";
import { escapeHtml } from "../lib/html.mjs";

/**
 * The address Meta calls when a customer writes to us, or when a message we
 * sent is delivered, read or fails.
 *
 * WHY THIS ENDPOINT IS THE WHOLE POINT OF THE INBOX. The business number is
 * API-only: it has no phone, no app, nobody holding it. A customer who
 * replies "yes please go ahead" is writing into a void unless this endpoint
 * catches it and puts it in front of somebody. So the rule here is that an
 * inbound message is never dropped — not for an unknown number, not for a
 * file we cannot read, not for a type nobody has seen before.
 *
 * TWO METHODS, two different jobs:
 *
 *   GET  is Meta's one-time check that we own this URL. It sends
 *        hub.verify_token and expects hub.challenge echoed back as plain
 *        text. The token is WHATSAPP_VERIFY_TOKEN, invented by whoever sets
 *        this up and typed into both places.
 *   POST is the events, in batches, mixing replies and delivery reports.
 *
 * ALWAYS 200 ON A POST WE UNDERSTOOD, even when a row could not be matched.
 * Meta retries anything that is not a 200 and eventually disables a webhook
 * that keeps failing — so a cosmetic miss must not become a retry storm and
 * then a dead integration. Anything we genuinely could not act on is logged
 * with its shape.
 */

const MAX_BODY_BYTES = 256_000;

/** Who a reply alert goes to when nobody has set one in Settings. */
const DEFAULT_ALERT_TO = "abhinav.jain@techzoidtechnologies.com";

export async function handler(event) {
  const method = String(event.httpMethod ?? "").toUpperCase();

  if (method === "GET") return verify(event);
  if (method === "OPTIONS") return { statusCode: 204, body: "" };
  if (method !== "POST") return { statusCode: 405, body: "Method not allowed" };

  const raw = event.body ?? "";
  if (raw.length > MAX_BODY_BYTES) return { statusCode: 413, body: "Payload too large" };

  /* WHO IS CALLING. Meta signs every POST with the app secret when one is
     configured. Checked when we have it; when the app secret has not been
     set, the endpoint still works — Meta's verification already proved the
     URL is ours, and refusing everything would mean no replies at all. The
     gap is logged once per cold start rather than silently accepted. */
  const signature = headerOf(event, "x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
  if (appSecret) {
    if (!signatureMatches(raw, signature, appSecret)) {
      return { statusCode: 401, body: "Unauthorized" };
    }
  } else if (!warnedAboutSignature) {
    warnedAboutSignature = true;
    console.warn("whatsapp-webhook: WHATSAPP_APP_SECRET is not set, so payload signatures are not checked.");
  }

  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    /* Not retryable by Meta and not ours to fix. */
    return { statusCode: 200, body: "ignored" };
  }

  const { messages, statuses } = parseWebhook(payload);
  if (!messages.length && !statuses.length) {
    /* A change we do not act on — a template approval, a quality rating. */
    return { statusCode: 200, body: "ok" };
  }

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("whatsapp-webhook not configured:", err?.message ?? err);
    /* Ours to fix, so Meta SHOULD retry. */
    return { statusCode: 500, body: "Not configured" };
  }

  const company = await companyForWhatsApp(admin);

  for (const status of statuses) {
    try {
      await applyStatus(admin, status);
    } catch (err) {
      console.error("whatsapp-webhook: status", status.waMessageId, "—", err?.message ?? err);
    }
  }

  for (const message of messages) {
    try {
      await saveIncoming(admin, company, message);
    } catch (err) {
      /* A reply that could not be filed is the one thing worth shouting
         about: nobody else is holding this number. */
      console.error("whatsapp-webhook: COULD NOT SAVE a reply from", message.from, "—", err?.message ?? err);
    }
  }

  return { statusCode: 200, body: "ok" };
}

let warnedAboutSignature = false;

/* ── Meta proving it has the right URL ───────────────────────────────── */

function verify(event) {
  const q = event.queryStringParameters ?? {};
  const mode = String(q["hub.mode"] ?? q.hub_mode ?? "");
  const token = String(q["hub.verify_token"] ?? q.hub_verify_token ?? "");
  const challenge = String(q["hub.challenge"] ?? q.hub_challenge ?? "");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";

  if (!expected) {
    console.error("whatsapp-webhook: WHATSAPP_VERIFY_TOKEN is not set, so verification cannot succeed.");
    return { statusCode: 500, body: "Not configured" };
  }
  if (mode !== "subscribe" || !constantEquals(token, expected)) {
    /* One answer for every rejection: a caller learns nothing from which
       check failed. */
    return { statusCode: 403, body: "Forbidden" };
  }

  /* PLAIN TEXT, exactly what was sent. Meta compares it byte for byte and
     a JSON wrapper fails the check with no explanation. */
  return { statusCode: 200, headers: { "Content-Type": "text/plain" }, body: challenge };
}

/* ── what happened to something we sent ──────────────────────────────── */

async function applyStatus(admin, status) {
  const { data: row } = await admin
    .from("whatsapp_messages")
    .select("id, status")
    .eq("wa_message_id", status.waMessageId)
    .maybeSingle();

  /* A status for a message this CRM did not send — another tool on the same
     number, or a row that was never written. Nothing to update. */
  if (!row) return;

  const moved = nextStatus(row.status, status.status);
  if (moved === row.status && !status.error) return;

  await admin
    .from("whatsapp_messages")
    .update({
      status: moved,
      error: status.error ? String(status.error).slice(0, 500) : "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}

/* ── a customer writing to us ────────────────────────────────────────── */

async function saveIncoming(admin, fallbackCompany, message) {
  /* ALREADY SEEN? Meta retries a delivery it did not get a 200 for, and the
     same reply arriving twice would show as the customer repeating
     themselves. */
  if (message.waMessageId) {
    const { data: seen } = await admin
      .from("whatsapp_messages").select("id").eq("wa_message_id", message.waMessageId).maybeSingle();
    if (seen) return;
  }

  /* WHOSE NUMBER IS THIS decides whose company this is. The fallback is
     only for a number nobody has on file — a new enquiry — and then the
     oldest company is as good a guess as any. */
  const company = (await matchCompany(admin, message.from)) ?? fallbackCompany;
  const customerId = company ? await matchCustomer(admin, company, message.from) : null;

  const { data: saved, error } = await admin
    .from("whatsapp_messages")
    .insert({
      company_id: company,
      direction: "in",
      customer_id: customerId,
      phone: message.from,
      contact_name: message.name ?? "",
      body: message.body ?? "",
      wa_message_id: message.waMessageId || null,
      status: "received",
      trigger: "reply",
      created_at: message.at,
      updated_at: message.at,
    })
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);

  /* The email goes out AFTER the message is safely stored. A reply that is
     emailed but not filed is a reply nobody can answer from the CRM. */
  await alert(admin, company, { ...message, customerId, rowId: saved?.id ?? "" });
}

async function matchCompany(admin, digits) {
  try {
    const { data } = await admin.rpc("whatsapp_company_for", { p_digits: digits });
    const id = Array.isArray(data) ? data[0] : data;
    return id ? String(id) : null;
  } catch (err) {
    console.error("whatsapp-webhook: could not decide the company for", digits, "—", err?.message ?? err);
    return null;
  }
}

async function matchCustomer(admin, company, digits) {
  try {
    const { data } = await admin.rpc("whatsapp_customer_for", { p_company: company, p_digits: digits });
    const id = Array.isArray(data) ? data[0] : data;
    return id ? String(id) : null;
  } catch (err) {
    /* An unmatched reply is still a reply. It shows in the Inbox under the
       number, where somebody can link it to a customer by hand. */
    console.error("whatsapp-webhook: could not match", digits, "—", err?.message ?? err);
    return null;
  }
}

/* ── telling somebody ────────────────────────────────────────────────── */

async function alert(admin, company, message) {
  let settings = {};
  let owner = null;
  let customerName = "";

  try {
    if (company) {
      const { data } = await admin.from("settings").select("data").eq("company_id", company).maybeSingle();
      settings = data?.data ?? {};
    }
    if (message.customerId) {
      const { data } = await admin
        .from("customers").select("owner_id, data").eq("id", message.customerId).maybeSingle();
      owner = data?.owner_id ?? null;
      customerName = String(data?.data?.company ?? data?.data?.contact ?? "");
    }
  } catch (err) {
    console.error("whatsapp-webhook: could not read who to tell —", err?.message ?? err);
  }

  const to = alertEmailOf(settings, DEFAULT_ALERT_TO);
  if (!to) return;

  const who = customerName || message.name || message.from;
  const subject = `WhatsApp reply from ${who}`;

  /* Short on purpose. This is a nudge to go and look, not a copy of the
     conversation — and it is read on a phone, in a notification. */
  const lines = [
    `${who} replied on WhatsApp:`,
    "",
    message.body || "(no text)",
    "",
    `Number: +${message.from}`,
    customerName ? "" : "This number is not on any customer record yet.",
    "",
    "Open the CRM → WhatsApp Inbox to answer. You can reply in your own words for 24 hours after their message.",
  ].filter((l) => l !== undefined);

  const html = `<div style="font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2e2e2e;">
    <p style="margin:0 0 12px;"><strong>${escapeHtml(who)}</strong> replied on WhatsApp:</p>
    <blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #76550a;background:#faf9f7;">
      ${escapeHtml(message.body || "(no text)")}
    </blockquote>
    <p style="margin:0 0 6px;color:#6b6259;">Number: +${escapeHtml(message.from)}</p>
    ${customerName ? "" : `<p style="margin:0 0 6px;color:#6b6259;">This number is not on any customer record yet.</p>`}
    <p style="margin:14px 0 0;">Open the CRM → WhatsApp Inbox to answer. You can reply in your own words for 24 hours after their message.</p>
  </div>`;

  try {
    const result = await sendMail({
      admin,
      /* From the salesperson who owns the customer, so the alert lands in
         the thread they already have with that account — and so it is not
         from nobody. */
      userId: owner,
      to,
      subject,
      message: lines.join("\n"),
      html,
    });
    if (!result.ok) console.error("whatsapp-webhook: reply alert not sent —", result.error);
  } catch (err) {
    console.error("whatsapp-webhook: reply alert not sent —", err?.message ?? err);
  }
}

/* ── which company ───────────────────────────────────────────────────── */

/**
 * There is one WhatsApp number, and it belongs to the business running this
 * CRM. With a single company that is unambiguous; with more than one, the
 * oldest is the one that was set up first and owns the integration.
 */
async function companyForWhatsApp(admin) {
  try {
    const { data } = await admin
      .from("companies").select("id").order("created_at", { ascending: true }).limit(1);
    return data?.[0]?.id ?? null;
  } catch (err) {
    console.error("whatsapp-webhook: could not decide the company —", err?.message ?? err);
    return null;
  }
}

/* ── plumbing ────────────────────────────────────────────────────────── */

function headerOf(event, name) {
  const headers = event.headers ?? {};
  return String(headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? "");
}

function signatureMatches(raw, supplied, secret) {
  const given = String(supplied ?? "");
  if (!given.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  return constantEquals(given, expected);
}

/** Constant time, so a caller cannot learn a token one character at a time. */
function constantEquals(a, b) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
