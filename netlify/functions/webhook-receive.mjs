import { corsHeaders } from "../lib/http.mjs";
import { adminClient } from "../lib/auth.mjs";
import { isValidEventKind, verifySignature } from "../lib/webhookSign.mjs";
import {
  crmIdForWebsiteDeal, customerFieldsFromEvent, noteFromEvent, normaliseStage, websiteDealId,
} from "../lib/inboundMap.mjs";

/**
 * Receives events from the company's own website.
 *
 * THE OTHER HALF OF THE SYNC. `webhook-deliver-background.mjs` sends what
 * happens in the CRM out to the website; this accepts what happens on the
 * website into the CRM.
 *
 * NO BEARER TOKEN. This endpoint is called by a server, not a signed-in
 * person, so there is no session to check. What authenticates a caller is
 * the `x-techzoid-signature` header: an HMAC over the timestamp and the
 * exact body, using a secret only the two systems hold. A request without a
 * valid one is refused before anything is read out of it.
 *
 * NO LOOP BACK OUT. Writes here go straight to Postgres. The browser learns
 * about them through the realtime subscription, which flows into
 * `useWorkspace.reload()` — a path that never calls the outbound dispatcher.
 * Only a person editing in the CRM sends an event back to the website, which
 * is what makes a two-way sync terminate instead of ping-ponging.
 */

const MAX_BODY_BYTES = 100_000;

/** Same answer for every rejection: a caller learns nothing from which
 *  check failed, and a legitimate sender's retry logic only needs the code. */
const REFUSED = "Invalid signature.";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(event), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return respond(event, 405, { error: "Method not allowed" });
  }

  const raw = event.body || "";
  if (raw.length > MAX_BODY_BYTES) return respond(event, 413, { error: "Payload too large." });

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("webhook-receive not configured:", err?.message ?? err);
    /* 500, not 4xx: this is our fault, and the sender SHOULD retry. */
    return respond(event, 500, { error: "Not configured." });
  }

  const { data: secretRow } = await admin
    .from("webhook_secrets").select("secret").eq("id", "inbound").maybeSingle();
  const secret = secretRow?.secret ?? "";

  const header = event.headers?.["x-techzoid-signature"] || event.headers?.["X-Techzoid-Signature"] || "";
  const verdict = verifySignature(raw, header, secret);
  if (!verdict.ok) {
    console.warn("webhook-receive refused a delivery:", verdict.reason);
    /* An unconfigured secret is OUR fault, so it earns a retryable 500 —
       answering 401 would have the sender give up on eight deliveries that
       would have worked a minute after an admin pressed Generate. */
    if (verdict.reason === "unconfigured") return respond(event, 500, { error: "Not configured." });
    return respond(event, 401, { error: REFUSED });
  }

  let envelope;
  try {
    envelope = JSON.parse(raw || "{}");
  } catch {
    return respond(event, 400, { error: "Body was not valid JSON." });
  }

  const eventId = String(
    event.headers?.["x-techzoid-event-id"] || event.headers?.["X-Techzoid-Event-Id"] || envelope.id || "",
  ).trim();
  if (!eventId) return respond(event, 400, { error: "Missing event id." });

  const kind = String(envelope.kind ?? envelope.type ?? "");
  if (!isValidEventKind(kind)) {
    /* Recorded and accepted: an event kind we do not handle is not a
       failure the sender should retry for ever. */
    await record(admin, eventId, kind || "unknown", "ignored", "Unrecognised event kind.");
    return respond(event, 200, { ok: true, ignored: true });
  }

  /* Exactly-once. The insert is the lock: if this event id is already
     recorded, another delivery of it already applied, and we answer 200 so
     the sender stops retrying. */
  const { error: dupeError } = await admin
    .from("webhook_received").insert({ event_id: eventId, event_kind: kind, status: "applied" });
  if (dupeError) {
    if (dupeError.code === "23505") return respond(event, 200, { ok: true, duplicate: true });
    console.error("could not record inbound event:", dupeError.message);
    return respond(event, 500, { error: "Could not record the event." });
  }

  try {
    const applied = await apply(admin, kind, envelope);
    if (!applied.ok) {
      await record(admin, eventId, kind, "ignored", applied.reason, true);
      return respond(event, 200, { ok: true, ignored: true, reason: applied.reason });
    }
    return respond(event, 200, { ok: true });
  } catch (err) {
    console.error("applying inbound event failed:", err?.message ?? err);
    await record(admin, eventId, kind, "failed", String(err?.message ?? err).slice(0, 300), true);
    /* 500 so the sender retries — but the row above stays, so a retry that
       succeeds updates it rather than applying twice. */
    return respond(event, 500, { error: "Could not apply the event." });
  }
}

function respond(event, statusCode, payload) {
  return { statusCode, headers: corsHeaders(event), body: JSON.stringify(payload) };
}

async function record(admin, eventId, kind, status, detail, update = false) {
  try {
    const row = { event_id: eventId, event_kind: kind, status, detail: detail ?? null };
    if (update) await admin.from("webhook_received").update(row).eq("event_id", eventId);
    else await admin.from("webhook_received").insert(row);
  } catch (err) {
    console.error("could not record inbound event outcome:", err?.message ?? err);
  }
}

/** Who owns a customer the website created. */
async function ownerId(admin) {
  const { data: settingsRow } = await admin.from("settings").select("data").eq("id", "main").maybeSingle();
  const configured = ((settingsRow?.data ?? {}).webhook ?? {}).inboundOwnerId;
  if (configured) return String(configured);

  /* Nothing chosen yet: fall back to an Admin so a lead is never dropped on
     the floor for want of a setting. A record owned by nobody would be
     invisible to the whole Sales team under the row-level security rules. */
  const { data: admins } = await admin
    .from("profiles").select("id").eq("role", "Admin").order("created_at").limit(1);
  return admins?.[0]?.id ?? null;
}

async function apply(admin, kind, envelope) {
  const data = envelope.data ?? envelope.payload ?? {};
  const dealId = websiteDealId(data);
  if (!dealId) return { ok: false, reason: "No deal id in the payload." };

  const id = crmIdForWebsiteDeal(dealId);
  const occurredAtMs = Date.parse(envelope.occurredAt ?? "") || Date.now();

  const { data: existing } = await admin
    .from("customers").select("id, owner_id, data").eq("id", id).maybeSingle();

  const owner = existing?.owner_id ?? (await ownerId(admin));
  if (!owner) return { ok: false, reason: "No owner configured and no Admin to fall back to." };

  const current = existing?.data ?? {};
  const incoming = customerFieldsFromEvent(data);

  /* deal.won / deal.lost carry the outcome in the event kind itself, which
     is more reliable than a stage field that may be spelled anything. */
  if (kind === "deal.won") incoming.stage = "won";
  if (kind === "deal.lost") incoming.stage = "lost";
  if (kind === "deal.stage_changed") {
    const to = normaliseStage(data.toStage ?? data.to_stage ?? data.stage);
    if (to) incoming.stage = to;
  }

  /* An activity event is about a conversation, not the deal's details —
     applying its fields would let a note's author overwrite the company
     name. Only the note itself is taken. */
  const fields = kind === "activity.logged" ? {} : incoming;

  const next = {
    ...current,
    ...fields,
    id,
    ownerId: owner,
    /* Kept so the two systems can always be reconciled by hand, and so a
       field this mapping did not recognise is visible rather than lost. */
    websiteDealId: dealId,
    websitePayload: data,
    updatedAt: Date.now(),
  };
  if (!current.createdAt) next.createdAt = occurredAtMs;
  if (!next.stage) next.stage = "lead";
  if (!next.currency) next.currency = "INR";
  if (!next.taxType) next.taxType = "gst";
  if (incoming.stage === "won" && !current.wonAt) next.wonAt = occurredAtMs;

  if (kind === "activity.logged") {
    const note = noteFromEvent(data, String(envelope.id ?? ""), occurredAtMs);
    const notes = Array.isArray(current.notes) ? current.notes : [];
    next.notes = notes.some((n) => n?.id === note.id) ? notes : [...notes, note];
  }

  const { error } = await admin.from("customers").upsert({
    id,
    owner_id: owner,
    data: next,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  return { ok: true };
}
