import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { sendMail } from "../lib/mailer.mjs";

/**
 * Tell somebody a discount was asked for, or decided.
 *
 * WHY THE SERVER PICKS THE RECIPIENTS. A browser asking "email these three
 * addresses about approval X" is a browser that can email anybody about
 * anything, on the company's mailbox, with the company's name on it. This
 * takes the approval's id and works out for itself who should hear: the
 * company's Admins when a request comes in, the salesperson who asked when
 * it is decided. The caller supplies no addresses at all.
 *
 * WHAT IT WILL NOT PUT IN AN EMAIL: the reseller price, the buying price,
 * the distributor discount, the margin. The Admin's notification says what
 * was asked for and links them into the CRM to see the rest; the
 * salesperson's says what was approved. An email is forwarded, printed and
 * read on phones in meetings, and the one place the cost picture belongs is
 * behind a sign-in.
 *
 * SILENT WHEN THERE IS NO MAILBOX. A company that has not connected one
 * gets { sent: 0, reason: "no mailbox" } and the approval still stands —
 * the notification is a courtesy on top of the record, never the record.
 */

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid.");

  const approvalId = String(body.approvalId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return fail(event, 400, "Which approval?");

  try {
    const rl = await consume(adminClient(), "email-send", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable:", err?.message ?? err);
  }

  const admin = adminClient();

  const { data: approval } = await admin
    .from("discount_approvals")
    .select("id, company_id, quote_id, quote_number, requested_by, reason, state, lines, approved_lines, decision_note")
    .eq("id", approvalId)
    .maybeSingle();
  if (!approval) return fail(event, 404, "No such approval request.");

  /* THE CALLER HAS TO BE IN THAT COMPANY. Read as the service role above,
     so this check is the one standing between a signed-in stranger and
     knowing that a company has a discount request outstanding. */
  const { data: membership } = await admin
    .from("company_members")
    .select("role")
    .eq("company_id", approval.company_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return fail(event, 403, "Not your company.");

  const asking = approval.state === "pending";
  const recipients = asking
    ? await adminsOf(admin, approval.company_id)
    : await emailsOf(admin, [approval.requested_by]);

  /* Never tell somebody about their own action. */
  const { data: me } = await admin.from("profiles").select("email").eq("id", user.id).maybeSingle();
  const list = recipients.filter((r) => r.email && r.email.toLowerCase() !== String(me?.email ?? "").toLowerCase());
  if (!list.length) return json(event, 200, { sent: 0, reason: "nobody to tell" });

  const doc = approval.quote_number || approval.quote_id;
  const lineCount = Array.isArray(approval.lines) ? approval.lines.length : 0;

  const subject = asking
    ? `Discount approval needed — ${doc}`
    : approval.state === "approved"
      ? `Discount approved — ${doc}`
      : `Discount not approved — ${doc}`;

  const message = asking
    ? [
        `A discount needs your approval on quotation ${doc}.`,
        ``,
        `Reason given: ${approval.reason}`,
        `${lineCount} line${lineCount === 1 ? "" : "s"} priced below the minimum.`,
        ``,
        `Open the CRM and go to Discount approvals to see what each line costs and decide.`,
      ].join("\n")
    : approval.state === "approved"
      ? [
          `Your discount on quotation ${doc} was approved.`,
          approval.decision_note ? `\n${approval.decision_note}` : "",
          ``,
          `The quotation is unlocked. Open it in the CRM to check the approved prices and send it.`,
        ].join("\n")
      : [
          `Your discount on quotation ${doc} was not approved.`,
          approval.decision_note ? `\n${approval.decision_note}` : "",
          ``,
          `Open the quotation in the CRM to reprice it, or ask again with more context.`,
        ].join("\n");

  let sent = 0;
  const failures = [];
  for (const who of list) {
    try {
      const out = await sendMail({
        admin,
        userId: user.id,
        to: who.email,
        subject,
        message,
      });
      if (out?.ok) sent += 1;
      else failures.push(out?.error ?? "unknown");
    } catch (err) {
      failures.push(err?.message ?? String(err));
    }
  }

  if (!sent && failures.length) {
    /* 200, not an error: the decision is recorded and standing. Telling the
       caller the email did not go is useful; failing the whole action
       because of it would be wrong. */
    return json(event, 200, { sent: 0, reason: failures[0] });
  }
  return json(event, 200, { sent });
}

async function adminsOf(admin, companyId) {
  const { data } = await admin
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("role", "Admin");
  return emailsOf(admin, (data ?? []).map((r) => r.user_id));
}

async function emailsOf(admin, ids) {
  const wanted = [...new Set((ids ?? []).filter(Boolean))];
  if (!wanted.length) return [];
  const { data } = await admin.from("profiles").select("id, name, email").in("id", wanted);
  return (data ?? []).filter((p) => p.email);
}
