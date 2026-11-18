import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { checkAttachment, isEmail, str } from "../lib/validate.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { sendMail } from "../lib/mailer.mjs";
import { allowanceFor, partialMessage, spentMessage } from "../lib/profileSendLimit.mjs";

/**
 * Send the company profile to several people — one message each.
 *
 * THE WHOLE FEATURE IS THE WORD "EACH". A customer must receive a mail that
 * is, in its headers as well as its wording, addressed to them alone: their
 * address in To, nobody else's anywhere, their name in the greeting. So this
 * loops and calls the transport once per recipient. There is no code path
 * here that puts two addresses on one message, and there is deliberately no
 * cc or bcc parameter to pass one in — the shape of the function is the
 * guarantee.
 *
 * THE FILE IS READ HERE, NOT UPLOADED BY THE BROWSER. A three-megabyte PDF
 * times thirty recipients is ninety megabytes up somebody's office
 * connection to send one mailshot, and the failure would land halfway
 * through with no way to tell which messages had gone. The profile is
 * stored once (supabase/059_company_profile.sql) and read once per request.
 *
 * THE WORDS ARE RENDERED BY THE BROWSER, which is the same choice
 * outreach-launch.mjs made: this sends what it was given and templates
 * nothing. What was sent to a given customer is then a fact on a row in
 * profile_sends, not a re-derivation that could come out differently next
 * month because somebody edited the wording in between. It also means the
 * preview the sender approved is the message, not an impression of it.
 *
 * A LIST ARRIVES IN PIECES. The browser sends six at a time (CHUNK in
 * src/domain/outreach/profileMail.ts) because each send is a round trip to
 * Microsoft and a function host will cut off a request that runs too long —
 * mid-list, with nothing to say which of the last few went. Six fits inside
 * every budget involved, and the count on screen moves after each piece.
 */

/** Per request. Must stay at or above the browser's CHUNK, or a full piece
 *  would be refused; above it, so a slightly larger client is not broken by
 *  a server deployed first. */
const MAX_PER_REQUEST = 10;

/** Graph refuses a message over about 4 MB when the attachment rides along
 *  inside it, and a bounced 30-message batch is worse than a refusal here. */
const MAX_ATTACHMENT = 3.5 * 1024 * 1024;

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid JSON.");

  const companyId = str(body.companyId, 64);
  const batchId = str(body.batchId, 64);
  if (!companyId) return fail(event, 400, "Which company is this being sent from?");
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return fail(event, 400, "That send has no valid batch id.");

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) return fail(event, 400, "There is nobody to send to.");
  if (messages.length > MAX_PER_REQUEST) {
    return fail(event, 400, `Send at most ${MAX_PER_REQUEST} at a time — the list is sent in pieces.`);
  }

  /* VALIDATED BEFORE ANYTHING IS SENT, all of it. A list where the fourth
     address is malformed must fail before the first three go out, or the
     person has to work out which half of their list is in an inbox. */
  const planned = [];
  for (const raw of messages) {
    const to = str(raw?.email, 320).toLowerCase();
    const subject = str(raw?.subject, 300);
    const text = String(raw?.message ?? "");
    const html = String(raw?.html ?? "").slice(0, 400_000) || null;

    if (!to || !isEmail(to)) return fail(event, 400, `"${to || "(blank)"}" doesn't look like an email address.`);
    if (!subject) return fail(event, 400, `There is no subject for ${to}.`);
    if (!text.trim()) return fail(event, 400, `There is no message for ${to}.`);
    if (text.length > 100_000) return fail(event, 400, `The message for ${to} is too long to send.`);

    /* A VARIABLE NOBODY COULD FILL MUST NOT REACH AN INBOX. The browser
       renders these and leaves an unfilled {{token}} visible on purpose, so
       that the preview shows the hole rather than hiding it — see
       domain/outreach/personalise.ts. That is right for a preview and
       unacceptable in a customer's subject line, and the screen blocks it.
       This is the second wall: it was a real send that went out reading
       "{{sender_company}} — company profile" to nine people, because the
       company name had never been filled in on the settings row. */
    const hole = /\{\{\s*[a-z_][a-z0-9_]*\s*\}\}/i;
    if (hole.test(subject) || hole.test(text) || (html && hole.test(html))) {
      return fail(
        event, 400,
        `The message for ${to} still has a ${(subject.match(hole) ?? text.match(hole))?.[0]} in it that nothing filled in. `
        + "Fill in the missing detail — the company name in Settings, usually — or take the variable out.",
      );
    }

    planned.push({
      to,
      subject,
      text,
      html,
      customerId: str(raw?.customerId, 64) || null,
      label: str(raw?.label, 200),
    });
  }

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "Email isn't configured on the server yet.", err?.message);
  }

  /* THE COMPANY IS CHECKED, NOT TAKEN ON TRUST. The browser names it, and a
     browser can name any company. Without this, somebody signed in to one
     business could send another business's profile out under their own
     mailbox. */
  const { data: membership, error: memberErr } = await admin
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberErr) return fail(event, 500, "Could not check your access to that company.", memberErr.message);
  if (!membership) return fail(event, 403, "You are not a member of that company.");

  /* One request's worth of sending, one token. The bucket is its own rather
     than email-send's, so a mailshot cannot eat the allowance a salesperson
     needs to send the quotation they are working on. */
  const rl = await consume(admin, "profile-send", user.id);
  if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));

  /* WHERE REPLIES GO, and it has to be right: a profile email that cannot
     be answered is a leaflet. The session's email claim is the first
     choice, but it is not always there — some sign-in paths carry only a
     subject — so the profile row is the fallback. Looked up here rather
     than taken from the request: a reply-to the client could name is a way
     to have the company's own mailbox invite replies elsewhere. */
  let replyTo = user.email && isEmail(user.email) ? user.email : "";
  if (!replyTo) {
    try {
      const { data: me } = await admin.from("profiles").select("email").eq("id", user.id).maybeSingle();
      const own = str(me?.email, 320);
      if (own && isEmail(own)) replyTo = own;
    } catch (err) {
      console.warn("profile-send: could not read the sender's address —", err?.message ?? err);
    }
  }

  const { data: profile, error: profileErr } = await admin
    .from("company_profiles")
    .select("file_name, mime, bytes, content")
    .eq("company_id", companyId)
    .maybeSingle();
  if (profileErr) return fail(event, 500, "Could not read the company profile.", profileErr.message);
  if (!profile?.content) {
    return fail(event, 400, "There is no company profile on file yet. Upload the PDF first.");
  }

  /* Re-checked here even though the upload checked it. This is the copy
     that is about to be handed to a mail transport thirty times; a row that
     has been edited by some other route since, or that predates a tightened
     limit, must not become thirty bounced messages. */
  const att = checkAttachment(profile.content, profile.file_name, MAX_ATTACHMENT);
  if (!att.ok) return fail(event, 400, `The stored company profile cannot be sent: ${att.error}`);

  /* ── THE DAY'S ALLOWANCE, CHECKED BEFORE A SINGLE MESSAGE GOES ──────
     See lib/profileSendLimit.mjs for what this is protecting and why it is
     a stop rather than a warning. In short: the reputation that carries
     this company's quotations and invoices is the same reputation a
     mailshot spends, and it is cheap to protect and slow to repair.

     COUNTED HERE, NOT ON THE SCREEN. The browser shows what is left so
     nobody is surprised, but a browser is not where a limit lives — this
     endpoint is reachable without it, the list arrives in pieces that each
     believe they are small, and two people sending at once would each see
     an allowance the other was spending. */
  let allowance;
  try {
    const { data: settingsRow } = await admin
      .from("settings").select("data").eq("company_id", companyId).maybeSingle();
    allowance = await allowanceFor(admin, companyId, settingsRow?.data ?? {});
  } catch (err) {
    /* A COUNT THAT CANNOT BE READ STOPS THE SEND. The alternative is
       sending an unknown number on top of an unknown number, which is the
       one outcome the limit exists to prevent. */
    return fail(event, 503, "Could not check today's sending limit, so nothing was sent. Try again in a moment.", err?.message);
  }

  if (allowance.remaining <= 0) return fail(event, 429, spentMessage(allowance));

  /* A LIST LONGER THAN WHAT IS LEFT IS CUT, NOT REFUSED. The first of them
     go out and the rest come back named, so the sender knows exactly where
     the list stopped and can pick it up tomorrow. Refusing the whole piece
     would waste an allowance that was still there and leave them guessing. */
  const sending = planned.slice(0, allowance.remaining);
  const held = planned.slice(allowance.remaining);

  const results = [];

  for (const one of sending) {
    /* ONE RECIPIENT. `to` is a single address and there is no cc — see the
       note at the top of this file. */
    let result;
    try {
      result = await sendMail({
        admin,
        userId: user.id,
        to: one.to,
        subject: one.subject,
        message: one.text,
        html: one.html,
        /* Replies go to the person who sent it, which is what makes the
           mail answerable rather than a broadcast. */
        replyTo,
        attachment: att.attachment,
      });
    } catch (err) {
      result = { ok: false, error: err?.message ?? "The message was not sent.", retryable: true };
    }

    results.push({
      email: one.to,
      customerId: one.customerId,
      ok: !!result.ok,
      via: result.ok ? result.via ?? "" : "",
      from: result.ok ? result.from ?? null : null,
      error: result.ok ? null : result.error ?? "The message was not sent.",
      retryable: result.ok ? false : result.retryable !== false,
    });

    /* LOGGED ONE AT A TIME, straight after the send rather than in a batch
       at the end. A function cut off mid-loop must not lose the record of
       mail that has already left — an unrecorded send is one somebody sends
       again. */
    try {
      await admin.from("profile_sends").insert({
        company_id: companyId,
        batch_id: batchId,
        customer_id: one.customerId,
        email: one.to,
        recipient_name: one.label,
        subject: one.subject,
        status: result.ok ? "sent" : "failed",
        via: result.ok ? String(result.via ?? "") : "",
        error: result.ok ? "" : String(result.error ?? "").slice(0, 500),
        sent_by: user.id,
      });
    } catch (err) {
      /* The mail has gone. A log that could not be written is worth a line
         in the server log, and is not worth failing the send over. */
      console.error("profile-send: could not log", one.to, "—", err?.message ?? err);
    }
  }

  /* The ones the limit held back, reported exactly like a failure so the
     screen already knows how to show them — but marked retryable, because
     tomorrow they will go. */
  for (const one of held) {
    results.push({
      email: one.to,
      customerId: one.customerId,
      ok: false,
      via: "",
      from: null,
      error: partialMessage(allowance),
      retryable: true,
    });
  }

  const sent = results.filter((r) => r.ok).length;
  /* 200 WITH THE DETAIL, even when some failed. A 500 for a partial batch
     would tell the browser nothing about which messages are now in an
     inbox, and it would invite a retry that sends those again. */
  return json(event, 200, {
    sent,
    failed: results.length - sent,
    /* The STORED byte count, which is the file's real size. The one
       checkAttachment derives from the base64 length is an upper bound — it
       does not subtract the padding — and a screen that says "2.4 MB" should
       say what the file is, not what its encoding rounds up to. */
    attachment: { name: att.attachment.name, bytes: profile.bytes || att.attachment.bytes },
    /* WHAT IS LEFT AFTER THIS PIECE, so the screen can say so without
       asking again and the next piece is not sent into a wall. */
    limit: {
      cap: allowance.cap,
      sentToday: allowance.sentToday + sent,
      remaining: Math.max(0, allowance.remaining - sent),
    },
    results,
  });
}
