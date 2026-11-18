import {
  approvedTemplates, buildParams, checkTemplate, documentFor, fillBody, nameFor, TEMPLATES,
} from "./whatsappTemplates.mjs";
import {
  metaAccount, sendTemplate, sendText, templateMissing, uploadDocument,
} from "./whatsappMeta.mjs";
import { mayMessage } from "./whatsappConsent.mjs";
import { checkRecordType, factsFor, loadRecord, nameOf } from "./whatsappFacts.mjs";
import { todayInIndia } from "./whatsappSchedule.mjs";

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

/** The biggest quotation PDF worth pushing through a function request. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** The PDF a browser sent, as bytes, or null. Never throws on bad input. */
export function pdfFrom(input) {
  const base64 = String(input?.base64 ?? "").trim();
  if (!base64) return null;
  try {
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES) return null;
    return { bytes };
  } catch {
    return null;
  }
}

/**
 * What this message will say, without sending it.
 *
 * Shown on screen before anybody confirms. It is built by the same code
 * that sends, from the same record, so the preview is the message — not an
 * impression of it.
 */
export async function previewMessage(admin, {
  companyId, template, recordType, recordId, customerId, extra = {}, pdf = null, documentId = "",
}) {
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

  /* WHICH NAME WILL BE TRIED, decided here and not on screen, so the preview
     cannot promise an attachment the send then leaves off. */
  const hasPdf = !!pdf?.bytes?.byteLength || !!documentId;
  const pick = nameFor(template, { hasPdf });
  const filename = pick.wantsPdf ? documentFor(template, facts) : "";

  /* The approved wording, read from Meta so the preview shows what the
     customer will actually read. Asked for the name that will be tried
     first; when that one is still in review the send falls back on its own
     and this simply has no wording to show. */
  const { token, wabaId } = metaAccount();
  const approved = await approvedTemplates({ token, wabaId });
  const wording = approved.ok ? (approved.templates[pick.meta] ?? approved.templates[pick.legacy]) : null;
  const problem = approved.ok && approved.templates[pick.meta]
    ? checkTemplate(template, approved.templates[pick.meta]).problem
    : "";

  return {
    ok: true,
    template,
    /* The name that will be tried at Meta, so a person can match it to what
       they created there. */
    metaTemplate: pick.meta,
    label: spec.label,
    /* What is attached, named exactly as the customer will see it — and
       empty when nothing is, which is what the screen reads. */
    documentName: filename,
    /* Why there is no attachment, when the caller offered one. */
    documentNote: pick.wantsPdf ? "" : (pdf?.bytes?.byteLength ? pick.why : ""),
    /* WHAT THE RECORD DOES NOT HAVE. Not a warning any more — the send is
       refused outright rather than a vague message going to a customer. */
    willNotSend: missing.length > 0,
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
  trigger = "", sentBy = null, extra = {}, pdf = null, documentId = "",
}) {
  const spec = TEMPLATES[template];
  if (!spec) return refused(`There is no WhatsApp template called ${template}.`);
  if (!companyId) return refused("No company was named for this message.");

  /* THE RIGHT MESSAGE ABOUT THE RIGHT KIND OF RECORD.
     The endpoint a browser goes through checks this already, and this is
     not that check repeated for the sake of it: the daily job, the payment
     sender and anything added next call `sendMessage` directly, and a
     quotation template pointed at a proforma row does not fail — both
     hold a number and a date, so it quietly produces a message telling a
     customer that the invoice they have been asked to pay is a quotation.
     The pairing is an invariant of sending, so it is checked where the
     sending happens. */
  const wrongRecord = checkRecordType(template, recordType || "");
  if (wrongRecord) return refused(wrongRecord);

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

  /* WHICH NAME TO TRY, and whether a file goes with it.

     The quotation and the proforma messages carry one. Both follow-ups are
     text-only: they are sent by the 10am job, where there is no browser and
     nothing that can render a document. */
  const hasPdf = !!pdf?.bytes?.byteLength;
  const pick = nameFor(template, { hasPdf });

  /* NO NAME TO SEND UNDER. A message whose template carries the document
     itself, asked for without one, has nothing to fall back to — and an
     empty name reaches Meta as "No WhatsApp template was named", which tells
     the person at the screen nothing about what went wrong. `nameFor` has
     the reason; this is where it gets said. */
  if (!pick.meta) return refused(pick.why || "That message cannot be sent as asked.");

  const filename = pick.wantsPdf ? documentFor(template, facts) : "";
  const { values, missing } = buildParams(template, facts);

  /* NOTHING GOES OUT WITH A HOLE IN IT.

     Meta refuses an empty blank outright, and filling one with a stand-in
     phrase — which this used to do — means a customer reading "your
     quotation (number to follow) is ready", which is worse than no message.
     So the send is refused and the reason is written into the history,
     where the salesperson looking at that customer will see it, naming the
     field that is missing. */
  if (missing.length) {
    const names = missing.map((key) => spec.params.find((p) => p.key === key)?.label ?? key);
    const reason = `Not sent — the record has no ${names.join(", no ")}.`;
    await logSkipped(admin, {
      companyId, customer, customerId, phone: allowed.to, template, values,
      reason, trigger, recordType, recordId, sentBy,
    });
    return refused(reason, { missing: names });
  }

  /* ALREADY GONE TODAY? ASKED BEFORE UPLOADING, not after.

     The log row is still what guarantees a customer is not messaged twice —
     the unique index refuses the second one, whatever any caller believes.
     This is only here to avoid paying for that refusal with a wasted
     upload, and it is a real cost: pressing Send on a quotation also tells
     the CRM the quotation has been shared, which asks for the very same
     message a moment later. Found in a browser, where one press put the
     same 10 KB PDF into Meta twice and used one of them.

     Only asked when something is about to be uploaded. Every other message
     costs nothing to refuse. */
  if (pick.wantsPdf) {
    const gone = await sentAlreadyToday(admin, { companyId, template, recordId, phone: allowed.to });
    if (gone) {
      return refused(`${spec.label} has already gone to this customer today.`, { alreadySent: true });
    }
  }

  /* THE FILE GOES TO META BEFORE ANYTHING IS CLAIMED OR SENT.

     A template with a document header must be sent with a document; there
     is no half-way. So if the upload fails the message is not sent at all
     and the reason is handed back in plain words — never a quotation
     message that silently arrives without the quotation, and never a log
     row for a send that did not happen. */
  let document = null;
  if (pick.wantsPdf) {
    const up = await uploadDocument({ bytes: pdf.bytes, filename });
    if (!up.ok) return refused(up.error);
    document = { id: up.id, filename };
  }

  let body = "";
  try {
    const { token, wabaId } = metaAccount();
    const approved = await approvedTemplates({ token, wabaId });
    const wording = approved.ok ? (approved.templates[pick.meta] ?? approved.templates[pick.legacy]) : null;
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
      /* THE CRM'S OWN NAME, not Meta's. It is the key of the switch, the
         thing every screen looks a message up by, and what the once-a-day
         guard keys on — so it must not change when the name at Meta does.
         Which name actually went is `meta_template` below. */
      template,
      params: values,
      body,
      /* What was attached, so the history shows the customer got the
         quotation and not just a message about it — and so the follow-up
         just a message about it. */
      document_id: document?.id ?? "",
      document_name: document?.filename ?? "",
      /* Filled in after the send, because which of the two names Meta
         accepted is not known until it answers. */
      meta_template: "",
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

  /* THE NEW NAME FIRST, THE OLD ONE ONCE.

     The `_v2` templates are in review, and Meta answers a name it does not
     have with the same error whether it was never created or is still being
     looked at. Rather than anybody having to flip a setting on the day a
     review finishes, every send tries the new name and falls back once.

     The fallback never carries the document: the old quotation template has
     no header, and sending a file to a template that does not declare one
     is refused. */
  let usedName = pick.meta;
  let result = await sendTemplate({ to: allowed.to, templateName: usedName, values, document });

  if (!result.ok && pick.legacy && pick.legacy !== usedName && templateMissing(result.code, result.error)) {
    console.log(`whatsapp: ${pick.meta} is not available at Meta — sending ${pick.legacy} instead`);
    usedName = pick.legacy;
    result = await sendTemplate({ to: allowed.to, templateName: usedName, values, document: null });
    if (result.ok && document) {
      /* It went, but without the attachment. The history must not claim
         otherwise. */
      document = null;
    }
  }

  await admin
    .from("whatsapp_messages")
    .update({
      /* WHICH NAME ACTUALLY WENT. The whole point of the fallback is that
         nobody has to watch it, so the log is where it is visible. */
      meta_template: usedName,
      document_id: document?.id ?? "",
      document_name: document?.filename ?? "",
      status: result.ok ? "sent" : "failed",
      wa_message_id: result.ok ? result.id ?? null : null,
      error: result.ok ? "" : String(result.error ?? "").slice(0, 500),
      /* Where it really went, as Meta normalised it. */
      phone: result.ok && result.to ? result.to : allowed.to,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);

  return result.ok
    ? {
      ok: true,
      id: result.id ?? null,
      rowId,
      to: allowed.to,
      template,
      metaTemplate: usedName,
      documentName: document?.filename ?? "",
    }
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

/**
 * Write down a message that was NOT sent, and why.
 *
 * A refusal nobody can see is a message that silently never arrived. This
 * puts it where everything else is — the customer's history — as a failed
 * row naming the field that was missing, so the person looking at that
 * customer can fill it in and send again.
 *
 * Recorded as `failed`, which is also what keeps it out of the once-a-day
 * guard: a message that did not go must not block the one that will.
 */
async function logSkipped(admin, {
  companyId, customer, customerId, phone, template, values, reason,
  trigger, recordType, recordId, sentBy,
}) {
  try {
    await admin.from("whatsapp_messages").insert({
      company_id: companyId,
      direction: "out",
      customer_id: customer?.id ?? customerId ?? null,
      phone: phone || "",
      contact_name: nameOf(customer),
      template,
      params: values,
      status: "failed",
      error: reason.slice(0, 500),
      trigger: trigger || "manual",
      record_type: recordType || "",
      record_id: recordId || "",
      sent_by: sentBy,
    });
  } catch (err) {
    /* The refusal still stands; only the note failed. */
    console.error("whatsapp: could not record a skipped message —", err?.message ?? err);
  }
}

/**
 * Has this exact message already gone to this number today?
 *
 * The same question the unique index answers, asked cheaply and in advance.
 * It is NOT the guarantee — two callers a millisecond apart both get "no"
 * here and the index refuses the second insert, which is the point of
 * claiming the row before sending. It exists so the expensive work in front
 * of that claim is not done for nothing.
 *
 * The day is India's, matching the index.
 */
export async function sentAlreadyToday(admin, { companyId, template, recordId, phone }) {
  if (!companyId || !template || !recordId || !phone) return false;
  const since = new Date(`${todayInIndia()}T00:00:00+05:30`).toISOString();
  const { data } = await admin
    .from("whatsapp_messages")
    .select("id")
    .eq("company_id", companyId)
    .eq("template", template)
    .eq("record_id", recordId)
    .eq("phone", phone)
    .eq("direction", "out")
    .neq("status", "failed")
    .gte("created_at", since)
    .limit(1);
  return !!data?.length;
}

