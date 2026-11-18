import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { checkAttachment, str } from "../lib/validate.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { sendMessage } from "../lib/whatsappSender.mjs";
import { uploadDocument } from "../lib/whatsappMeta.mjs";
import { documentFor } from "../lib/whatsappTemplates.mjs";

/**
 * Send the company profile to several customers on WhatsApp — one message
 * each, with the profile PDF attached.
 *
 * THE SHAPE IS THE EMAIL MAILSHOT'S, and deliberately so: a list arrives in
 * pieces, each recipient gets their own message, every send is logged, and
 * nothing that was refused is silently dropped. What differs is everything
 * about the medium.
 *
 * IT GOES THROUGH `sendMessage`, NOT STRAIGHT TO META. That is the whole
 * safety of this endpoint. Writing a loop that called `sendTemplate`
 * directly would be shorter and would skip: the opt-in check, the
 * company's own switches, the "already had this today" guard, the refusal
 * to send a blank parameter, and the row in the message history that the
 * Inbox and the customer's timeline both read. Every one of those is a
 * rule somebody would have to remember to re-implement, and a broadcast is
 * the worst place to find out that one was forgotten.
 *
 * THE FILE IS UPLOADED ONCE. Two hundred recipients, one media id. Meta
 * accepts a document once and hands back an id that any number of messages
 * may name, so the alternative is pushing the same two megabytes two
 * hundred times for an identical answer.
 *
 * ONLY PEOPLE WHO AGREED, and that is not a setting anybody can turn off.
 * `sendMessage` refuses a customer without `whatsappOptIn`, so a list that
 * includes them comes back with those names and the reason. That check is
 * Meta's rule rather than this CRM's preference, and it is the one thing
 * here that is not the sender's to decide.
 *
 * THERE IS NO DAILY CAP, at the company's instruction. How many
 * introductions go out in a day is the sender's judgement. What remains is
 * the per-request rate limit every sending endpoint has, which stops a
 * runaway loop rather than a deliberate campaign.
 */

/** Per request. The browser sends in pieces; this is the piece size. */
const MAX_PER_REQUEST = 10;

/** Meta's own document ceiling is 100 MB, but a profile a customer will
 *  actually open is a couple of megabytes. The same bound the mailshot
 *  uses, so one stored file suits both. */
const MAX_ATTACHMENT = 3.5 * 1024 * 1024;

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid JSON.");

  const companyId = str(body.companyId, 64);
  if (!companyId) return fail(event, 400, "Which company is this being sent from?");

  const customerIds = Array.isArray(body.customerIds)
    ? body.customerIds.map((id) => str(id, 64)).filter(Boolean)
    : [];

  /* A LIST SOMEBODY PASTED, which has no record in the CRM and therefore
     no tick to read. `declaredConsent` is the sender saying these people
     agreed; it is recorded against their own user id on every row — see
     mayMessage. Without it nothing in this list is sent, because the
     alternative is a CRM that quietly messages strangers on the company's
     only WhatsApp number. */
  const pasted = Array.isArray(body.numbers)
    ? body.numbers
      .map((n) => ({ phone: str(n?.phone, 24), label: str(n?.label, 120) }))
      .filter((n) => n.phone)
    : [];
  const declaredConsent = body.declaredConsent === true;
  if (pasted.length && !declaredConsent) {
    return fail(
      event, 400,
      "Confirm that these numbers have agreed to hear from you on WhatsApp before sending to them.",
    );
  }

  const total = customerIds.length + pasted.length;
  if (total === 0) return fail(event, 400, "There is nobody to send to.");
  if (total > MAX_PER_REQUEST) {
    return fail(event, 400, `Send at most ${MAX_PER_REQUEST} at a time — the list is sent in pieces.`);
  }

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "WhatsApp isn't configured on the server yet.", err?.message);
  }

  /* THE COMPANY IS CHECKED, NOT TAKEN ON TRUST — the same rule the email
     mailshot follows. A browser can name any company; without this,
     somebody signed in to one business could send another's profile out
     on that business's WhatsApp number. */
  const { data: membership, error: memberErr } = await admin
    .from("company_members").select("user_id")
    .eq("company_id", companyId).eq("user_id", user.id).maybeSingle();
  if (memberErr) return fail(event, 500, "Could not check your access to that company.", memberErr.message);
  if (!membership) return fail(event, 403, "You are not a member of that company.");

  const rl = await consume(admin, "whatsapp-send", user.id);
  if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));

  /* The sending company's name, read here once rather than per recipient:
     it is the same for everybody in a broadcast and it is the second blank
     in the template. */
  const { data: settingsRow } = await admin
    .from("settings").select("data").eq("company_id", companyId).maybeSingle();
  const settings = settingsRow?.data ?? {};
  const senderCompany = str((settings?.company ?? {}).name, 200);
  if (!senderCompany) {
    return fail(event, 400, "Your company name is not set, and the message says it. Settings → Company.");
  }

  /* ── the profile itself ───────────────────────────────────────────── */
  const { data: profile, error: profileErr } = await admin
    .from("company_profiles").select("file_name, mime, bytes, content")
    .eq("company_id", companyId).maybeSingle();
  if (profileErr) return fail(event, 500, "Could not read the company profile.", profileErr.message);
  if (!profile?.content) {
    return fail(event, 400, "There is no company profile on file yet. Upload the PDF first.");
  }

  const att = checkAttachment(profile.content, profile.file_name, MAX_ATTACHMENT);
  if (!att.ok) return fail(event, 400, `The stored company profile cannot be sent: ${att.error}`);

  /* ONE UPLOAD FOR THE WHOLE PIECE. The id is reused by every message
     below — see the note at the top. If it fails, nothing is sent: a
     template with a document header cannot go without one, and an
     introduction with no profile attached has no reason to exist. */
  const filename = documentFor("company_profile", { senderCompany });
  let documentId = "";
  try {
    const up = await uploadDocument({
      bytes: Buffer.from(profile.content, "base64"),
      filename,
    });
    if (!up.ok) return fail(event, 502, up.error || "The company profile could not be sent to WhatsApp.");
    documentId = up.id;
  } catch (err) {
    return fail(event, 502, "The company profile could not be sent to WhatsApp.", err?.message);
  }

  /* ── one message each ─────────────────────────────────────────────── */
  const results = [];

  for (const one of pasted) {
    let out;
    try {
      out = await sendMessage(admin, {
        companyId,
        template: "company_profile",
        recordType: "customer",
        /* No record to name. The number is what identifies the send, and
           it is what the "already had this today" guard keys on. */
        recordId: "",
        manual: true,
        trigger: "company profile broadcast",
        sentBy: user.id,
        extra: { senderCompany, customerName: one.label },
        documentId,
        declared: { phone: one.phone, by: user.id, name: one.label },
      });
    } catch (err) {
      out = { ok: false, reason: err?.message ?? "The message was not sent." };
    }
    results.push({
      phone: one.phone,
      label: one.label,
      ok: !!out.ok,
      error: out.ok ? null : out.reason ?? "The message was not sent.",
    });
  }

  for (const customerId of customerIds) {
    let out;
    try {
      out = await sendMessage(admin, {
        companyId,
        template: "company_profile",
        recordType: "customer",
        /* The customer IS the record: an introduction is about a person,
           not about a document of theirs. */
        recordId: customerId,
        customerId,
        manual: true,
        trigger: "company profile broadcast",
        sentBy: user.id,
        extra: { senderCompany },
        documentId,
      });
    } catch (err) {
      out = { ok: false, reason: err?.message ?? "The message was not sent." };
    }

    results.push({
      customerId,
      ok: !!out.ok,
      error: out.ok ? null : out.reason ?? "The message was not sent.",
    });
  }

  const sent = results.filter((r) => r.ok).length;
  return json(event, 200, {
    sent,
    failed: results.length - sent,
    attachment: { name: filename, bytes: profile.bytes || att.attachment.bytes },
    results,
  });
}
