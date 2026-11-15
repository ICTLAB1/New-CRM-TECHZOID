import { approvedTemplates, buildParams, checkTemplate, fillBody, TEMPLATES } from "./whatsappTemplates.mjs";
import { metaAccount, sendTemplate, sendText } from "./whatsappMeta.mjs";
import { mayMessage } from "./whatsappConsent.mjs";
import { factsFor, loadRecord, nameOf } from "./whatsappFacts.mjs";

/**
 * Sending one WhatsApp message, and writing down that it happened.
 *
 * EVERY SEND IN THE PRODUCT COMES THROUGH HERE — the button a salesperson
 * presses, the four automatic messages that follow an action, and the four
 * the daily job sends. One door means one place where consent is checked,
 * one place where the log row is written, and no second implementation to
 * drift from this one.
 *
 * THE ORDER MATTERS AND IT IS DELIBERATE:
 *
 *   1. decide whether we may send at all (consent, the switch, a number)
 *   2. build the message from the record
 *   3. claim the right to send it, by writing the log row FIRST
 *   4. send
 *   5. record what happened
 *
 * Step 3 is the unusual one. The row is written before the send because the
 * database's unique index is what stops the same reminder going out twice —
 * two daily runs overlapping, a browser retrying, two people pressing the
 * button. Claiming it first turns "send then discover we have sent twice"
 * into "discover first, then do not send".
 */

/** The preview and the send both answer in this shape. */
const refused = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/**
 * What this message will say, without sending it.
 *
 * Shown on screen before anybody confirms. It is built by the same code
 * that sends, from the same record, so the preview is the message — not an
 * impression of it.
 */
export async function previewMessage(admin, { companyId, template, recordType, recordId, customerId, extra = {} }) {
  const spec = TEMPLATES[template];
  if (!spec) return refused(`There is no WhatsApp template called ${template}.`);

  const loaded = recordId
    ? await loadRecord(admin, { recordType: recordType || "", recordId })
    : { record: null, customer: null };
  if (loaded.error) return refused(loaded.error);

  let customer = loaded.customer;
  if (!customer && customerId) {
    const { data } = await admin.from("customers").select("*").eq("id", customerId).maybeSingle();
    customer = data ?? null;
  }

  const settings = await settingsOf(admin, companyId);
  const allowed = mayMessage({ customer, settings, template, manual: true });

  const facts = factsFor(template, { record: loaded.record, customer, extra });
  const { values, missing } = buildParams(template, facts);

  /* The approved wording, read from Meta so the preview shows what the
     customer will actually read. When Meta cannot be reached the screen
     shows the blanks on their own and says why. */
  const { token, wabaId } = metaAccount();
  const approved = await approvedTemplates({ token, wabaId });
  const wording = approved.ok ? approved.templates[template] : null;
  const problem = approved.ok ? checkTemplate(template, wording).problem : "";

  return {
    ok: true,
    template,
    label: spec.label,
    to: allowed.to ?? "",
    customerId: customer?.id ?? customerId ?? "",
    customerName: nameOf(customer),
    values,
    /* Named, so the screen can say "we have no quotation number for this"
       rather than letting the fallback wording go out unnoticed. */
    missing: missing.map((key) => spec.params.find((p) => p.key === key)?.label ?? key),
    body: wording?.body ? fillBody(wording.body, values) : "",
    wordingProblem: problem || (approved.ok ? "" : approved.error),
    blocked: allowed.ok ? "" : allowed.reason,
  };
}

/**
 * Send it.
 *
 * @returns {{ok: true, id, rowId} | {ok: false, reason, alreadySent?: boolean, switchedOff?: boolean}}
 */
export async function sendMessage(admin, {
  companyId, template, recordType, recordId, customerId, manual = false,
  trigger = "", sentBy = null, extra = {},
}) {
  const spec = TEMPLATES[template];
  if (!spec) return refused(`There is no WhatsApp template called ${template}.`);
  if (!companyId) return refused("No company was named for this message.");

  const loaded = recordId
    ? await loadRecord(admin, { recordType: recordType || "", recordId })
    : { record: null, customer: null };
  if (loaded.error) return refused(loaded.error);

  let customer = loaded.customer;
  if (!customer && customerId) {
    const { data } = await admin.from("customers").select("*").eq("id", customerId).maybeSingle();
    customer = data ?? null;
  }

  const settings = await settingsOf(admin, companyId);
  const allowed = mayMessage({ customer, settings, template, manual });
  if (!allowed.ok) return refused(allowed.reason, { switchedOff: !!allowed.switchedOff });

  const facts = factsFor(template, { record: loaded.record, customer, extra });
  const { values } = buildParams(template, facts);

  /* WHAT THE CUSTOMER WILL ACTUALLY READ, recorded with the message.
     The approved wording lives in Meta, so it is asked for — and the answer
     is remembered for a few minutes, because a run of two hundred reminders
     must not ask two hundred times. Without this the log held the blanks
     and nothing else, so the customer's record showed "(no text)" against
     every message the business had ever sent them.

     NEVER ALLOWED TO STOP A SEND. If Meta cannot be asked, the message
     still goes — Meta fills the blanks into its own approved wording at its
     end — and the log simply has no words against it. */
  let body = "";
  try {
    const { token, wabaId } = metaAccount();
    const approved = await approvedTemplates({ token, wabaId });
    const wording = approved.ok ? approved.templates[template] : null;
    if (wording?.body) body = fillBody(wording.body, values);
  } catch (err) {
    console.error("whatsapp: could not read the approved wording —", err?.message ?? err);
  }

  /* CLAIM IT FIRST. The unique index refuses a second row for the same
     customer, template and record on the same day — so if this insert is
     refused, somebody has already sent this and we must not send it again.
     Doing it the other way round means finding out afterwards. */
  const { data: claim, error: claimError } = await admin
    .from("whatsapp_messages")
    .insert({
      company_id: companyId,
      direction: "out",
      customer_id: customer?.id ?? customerId ?? null,
      phone: allowed.to,
      contact_name: nameOf(customer),
      template,
      params: values,
      body,
      status: "queued",
      trigger: trigger || (manual ? "manual" : "automatic"),
      record_type: recordType || "",
      record_id: recordId || "",
      sent_by: sentBy,
    })
    .select("id")
    .maybeSingle();

  if (claimError) {
    if (isDuplicate(claimError)) {
      return refused(`${spec.label} has already gone to this customer today.`, { alreadySent: true });
    }
    return refused("The message could not be recorded, so it was not sent.");
  }

  const rowId = claim?.id ?? null;
  const result = await sendTemplate({ to: allowed.to, templateName: template, values });

  await admin
    .from("whatsapp_messages")
    .update({
      status: result.ok ? "sent" : "failed",
      wa_message_id: result.ok ? result.id ?? null : null,
      error: result.ok ? "" : String(result.error ?? "").slice(0, 500),
      /* Where it really went, as Meta normalised it. */
      phone: result.ok && result.to ? result.to : allowed.to,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);

  return result.ok
    ? { ok: true, id: result.id ?? null, rowId, to: allowed.to }
    : refused(result.error, { rowId, retryable: !!result.retryable });
}

/**
 * Answer a customer in your own words.
 *
 * Only inside the 24 hours after their last message — Meta's rule, not
 * ours. The caller checks the window so the screen can hide the box; this
 * records what was sent either way, because a refusal is worth seeing.
 */
export async function replyInWords(admin, { companyId, customerId, phone, body, sentBy = null }) {
  const result = await sendText({ to: phone, body });

  await admin.from("whatsapp_messages").insert({
    company_id: companyId,
    direction: "out",
    customer_id: customerId || null,
    phone,
    body,
    status: result.ok ? "sent" : "failed",
    wa_message_id: result.ok ? result.id ?? null : null,
    error: result.ok ? "" : String(result.error ?? "").slice(0, 500),
    trigger: "reply",
    sent_by: sentBy,
  });

  return result.ok ? { ok: true, id: result.id ?? null } : refused(result.error);
}

/** The company's settings row, or an empty one. */
async function settingsOf(admin, companyId) {
  if (!companyId) return {};
  try {
    const { data } = await admin.from("settings").select("data").eq("company_id", companyId).maybeSingle();
    return data?.data ?? {};
  } catch {
    /* Settings that cannot be read means no switch can be confirmed as on,
       which stops automatic sends — the safe direction. */
    return {};
  }
}

/** The database refusing a second row for the same thing today. */
const isDuplicate = (error) =>
  String(error?.code ?? "") === "23505" || /duplicate key|unique constraint/i.test(String(error?.message ?? ""));
