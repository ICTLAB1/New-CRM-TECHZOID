import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { str } from "../lib/validate.mjs";
import { pdfFrom, previewMessage, replyInWords, sendMessage } from "../lib/whatsappSender.mjs";
import { TEMPLATES, checkTemplate, readApprovedTemplates } from "../lib/whatsappTemplates.mjs";
import { metaAccount, metaConfigured } from "../lib/whatsappMeta.mjs";
import { checkRecordType } from "../lib/whatsappFacts.mjs";

/**
 * The one address the browser uses for WhatsApp.
 *
 * Three things, because they share every check and differ only at the end:
 *
 *   preview — what would this say? Nothing is sent.
 *   send    — send one of the eight approved templates about one record.
 *   reply   — answer a customer in your own words, inside the 24 hours
 *             after they wrote.
 *
 * WHAT THE BROWSER MAY SAY IS DELIBERATELY NARROW: which template, which
 * record, which customer. Never the message, never the number, never the
 * figures. Everything a customer reads is read out of the record on this
 * side — see ../lib/whatsappFacts.mjs — so a page that has been tampered
 * with cannot send a customer an invented amount, and nobody can use this
 * endpoint to send arbitrary WhatsApp messages from the company's number.
 *
 * `automatic` sends are the exception that proves it: the browser reports
 * that something happened (a quotation was emailed) and the SERVER decides
 * whether the switch for that message is on. A browser cannot turn one on.
 */

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid JSON.");

  const action = str(body.action, 20) || "send";
  const companyId = str(body.companyId, 64);
  if (!companyId) return fail(event, 400, "Which company is this being sent from?");

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "WhatsApp isn't configured on the server yet.", err?.message);
  }

  /* MEMBERSHIP IS CHECKED, NOT TAKEN ON TRUST. A browser can name any
     company; without this, somebody signed in to one business could send
     from another's WhatsApp number. */
  const { data: membership, error: memberErr } = await admin
    .from("company_members").select("user_id")
    .eq("company_id", companyId).eq("user_id", user.id).maybeSingle();
  if (memberErr) return fail(event, 500, "Could not check your access to that company.", memberErr.message);
  if (!membership) return fail(event, 403, "You are not a member of that company.");

  if (action === "status") {
    /* WHAT IS ACTUALLY READY, asked of Meta rather than assumed. The three
       things that go wrong are a missing token, a template still in review,
       and a template whose wording was edited to take a different number of
       blanks — all of which otherwise show up as a message that silently
       never arrives. */
    const { token, wabaId } = metaAccount();
    const approved = await readApprovedTemplates({ token, wabaId });

    return json(event, 200, {
      ok: true,
      configured: metaConfigured(),
      wabaConfigured: !!wabaId,
      verifyTokenSet: !!process.env.WHATSAPP_VERIFY_TOKEN,
      signatureChecked: !!process.env.WHATSAPP_APP_SECRET,
      error: approved.ok ? "" : approved.error,
      /* READ AGAINST THE NAME THAT WILL BE TRIED, which is the `_v2` one.
         While a `_v2` template is still in review this reports it as not
         ready, and says whether the old name it falls back to is — so the
         screen can show "sending the old version for now" rather than
         "broken". */
      templates: Object.keys(TEMPLATES).map((name) => {
        const spec = TEMPLATES[name];
        const found = approved.ok ? approved.templates[spec.metaName] : null;
        const check = approved.ok ? checkTemplate(name, found) : { ok: false, problem: "" };

        const legacyFound = approved.ok ? approved.templates[spec.legacyName] : null;
        const legacyCheck = approved.ok ? checkTemplate(name, legacyFound) : { ok: false, problem: "" };

        return {
          name,
          label: spec.label,
          when: spec.when,
          autoKey: spec.auto,
          blanks: spec.params.length,
          /* The name at Meta, so a person can match a row to what they
             created there. */
          metaName: spec.metaName,
          approved: !!check.ok,
          problem: check.problem,
          /* The one it falls back to until the new one is approved. */
          legacyName: spec.legacyName,
          legacyApproved: !!legacyCheck.ok,
          /* Only the quotation message carries the PDF. */
          carriesPdf: !!spec.document,
        };
      }),
    });
  }

  if (action === "preview") {
    const out = await previewMessage(admin, {
      companyId,
      template: str(body.template, 60),
      recordType: str(body.recordType, 20),
      recordId: str(body.recordId, 64),
      customerId: str(body.customerId, 64),
      extra: safeExtra(body.extra),
      /* Offered, not promised: the preview says whether it will actually be
         attached, because that depends on Meta having approved the version
         of the template that carries one. */
      pdf: pdfFrom(body.pdf),
    });
    return out.ok ? json(event, 200, out) : fail(event, 400, out.reason);
  }

  /* Both of the remaining actions send something, so both cost a token. */
  try {
    const rl = await consume(admin, "whatsapp-send", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable:", err?.message ?? err);
  }

  if (action === "reply") {
    const phone = str(body.phone, 20).replace(/[^0-9]/g, "");
    const text = String(body.body ?? "").trim();
    if (!phone) return fail(event, 400, "There is no number to reply to.");
    if (!text) return fail(event, 400, "There is nothing to send.");

    /* THE 24-HOUR WINDOW IS CHECKED HERE, not only on screen. Meta refuses
       free text outside it, and a refusal a salesperson sees as "failed"
       with no reason is worse than being told plainly. */
    const open = await windowOpen(admin, companyId, phone);
    if (!open) {
      return fail(event, 400,
        "It is more than 24 hours since this customer last wrote, so a reply in your own words cannot be sent. "
        + "Send one of the approved messages instead.");
    }

    const out = await replyInWords(admin, {
      companyId, customerId: str(body.customerId, 64), phone, body: text, sentBy: user.id,
    });
    return out.ok ? json(event, 200, out) : fail(event, 400, out.reason);
  }

  if (action !== "send") return fail(event, 400, `There is no such action as “${action}”.`);

  const template = str(body.template, 60);
  const recordType = str(body.recordType, 20);
  if (!TEMPLATES[template]) return fail(event, 400, `There is no WhatsApp template called ${template}.`);

  const wrong = checkRecordType(template, recordType);
  if (wrong) return fail(event, 400, wrong);

  const out = await sendMessage(admin, {
    companyId,
    template,
    recordType,
    recordId: str(body.recordId, 64),
    customerId: str(body.customerId, 64),
    /* A PERSON PRESSING SEND, or the CRM reporting that something
       happened. The browser says which; the server decides what that
       means — a manual send skips the switches, an automatic one does
       not, and neither skips the customer's consent. */
    manual: body.manual === true,
    trigger: str(body.trigger, 40),
    sentBy: user.id,
    extra: safeExtra(body.extra),
    /* THE QUOTATION ITSELF, rendered by the browser that has it on screen.
       Nothing on this server can produce one. It is handed to Meta before
       the message is sent, and a failure there stops the send rather than
       letting a quotation message arrive without the quotation. */
    pdf: pdfFrom(body.pdf),
  });

  if (out.ok) return json(event, 200, out);

  /* ALREADY SENT IS NOT AN ERROR WORTH SHOUTING ABOUT. It is the
     duplicate guard doing its job, and the screen says so quietly. */
  if (out.alreadySent) return json(event, 200, { ok: false, alreadySent: true, reason: out.reason });
  /* Nor is a switch being off, when the CRM reported an event nobody has
     turned on yet. The action that caused it must not look broken. */
  if (out.switchedOff) return json(event, 200, { ok: false, switchedOff: true, reason: out.reason });

  return fail(event, 400, out.reason);
}

/**
 * Extra facts the record cannot hold.
 *
 * Narrow on purpose: only the handful of values that genuinely are not in
 * the row — where licence keys were emailed, what a payment was against.
 * Everything else a customer reads comes from the record.
 */
function safeExtra(extra) {
  const e = extra && typeof extra === "object" ? extra : {};
  return {
    sentTo: str(e.sentTo, 320),
    against: str(e.against, 120),
    amount: Number.isFinite(Number(e.amount)) ? Number(e.amount) : undefined,
    today: str(e.today, 10),
  };
}

/** Has this customer written to us in the last 24 hours? */
async function windowOpen(admin, companyId, phone) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("whatsapp_messages")
    .select("id")
    .eq("company_id", companyId)
    .eq("phone", phone)
    .eq("direction", "in")
    .gte("created_at", since)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}
