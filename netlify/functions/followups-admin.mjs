import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInProfile } from "../lib/auth.mjs";
import { handler as runDueFollowUps } from "./followups-run.mjs";

/**
 * Why isn't a follow-up going out, and go out now.
 *
 * WHAT THIS IS FOR. An automatic follow-up passes through six gates before
 * it reaches anybody: a key in Netlify, three template names Meta has
 * approved, the customer's WhatsApp opt-in, a phone number with a country
 * code, the WhatsApp box ticked when the sequence was armed, and a
 * scheduled function that actually runs. Every one of them fails silently,
 * and the only symptom of any of them is nothing happening — at 09:30 the
 * next morning, which is the earliest anyone finds out.
 *
 * So this reports the state of all six from the live queue, and lets an
 * admin run the due batch immediately instead of waiting a day to learn
 * which one it was. Rows that already failed carry the provider's own
 * refusal, which is usually the whole answer: a template name that is not
 * registered in the account is refused by Meta and says so.
 *
 * PRIVILEGED ONLY. It reads every owner's queue and it can spend messages.
 */

/* Counted rather than returned: a queue is thousands of rows and the
   question is "how many, in what state", not "show me all of them". */
const RECENT_FAILURES = 5;

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const who = await signedInProfile(event);
  if (!who) return fail(event, 403, "Sign in required.");
  if (who.role !== "Admin" && who.role !== "Manager") {
    return fail(event, 403, "Only an admin or a manager can look at the follow-up queue.");
  }

  const body = readJson(event) ?? {};
  const admin = adminClient();

  if (body.action === "run") {
    /* The same code the schedule runs, on demand. Not a second
       implementation — a second implementation of "should this still be
       sent" is how a customer gets chased for a decision they already
       gave. */
    const result = await runDueFollowUps();
    let tally = null;
    try { tally = JSON.parse(result.body); } catch { /* a non-JSON body is reported as-is below */ }
    return json(event, 200, { ran: true, tally, note: result.statusCode === 200 ? null : String(result.body) });
  }

  /* ── what is configured ── */
  const { data: settingsRow } = await admin.from("settings").select("data").eq("id", "main").single();
  const settings = settingsRow?.data ?? {};
  const templateNames = {
    nudge: String(settings["waTemplateNudge"] ?? "").trim(),
    check: String(settings["waTemplateCheck"] ?? "").trim(),
    final: String(settings["waTemplateFinal"] ?? "").trim(),
  };

  /* ── what is in the queue ── */
  const { data: rows, error } = await admin
    .from("follow_ups")
    .select("state, channel, due_on, sent_at, error, template_name, doc_number, delivery_state")
    .order("due_on", { ascending: true })
    .limit(2000);

  if (error) {
    console.error("follow-ups admin: queue unreadable —", error.message);
    return fail(event, 500, "Could not read the follow-up queue.", error.message);
  }

  const all = rows ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const count = (fn) => all.filter(fn).length;

  const scheduled = all.filter((r) => r.state === "scheduled");
  const failures = all
    .filter((r) => r.state === "failed" && r.error)
    .slice(-RECENT_FAILURES)
    .map((r) => ({ docNumber: r.doc_number, channel: r.channel, templateName: r.template_name, error: r.error }));

  const sentRows = all.filter((r) => r.sent_at);
  const lastSentAt = sentRows.length
    ? sentRows.map((r) => r.sent_at).sort().at(-1)
    : null;

  return json(event, 200, {
    configured: {
      interaktKey: !!process.env.INTERAKT_API_KEY,
      templateNames,
      /* All three must be named. A blank one silently falls back to a
         suggested default that is almost certainly not registered in the
         account, and Meta refuses it at send time — a day later. */
      templatesNamed: !!(templateNames.nudge && templateNames.check && templateNames.final),
      mailer: !!(process.env.SMTP_HOST || process.env.MS_CLIENT_ID),
    },
    queue: {
      total: all.length,
      scheduled: scheduled.length,
      dueNow: count((r) => r.state === "scheduled" && r.due_on <= today),
      nextDueOn: scheduled[0]?.due_on ?? null,
      sent: count((r) => r.state === "sent"),
      failed: count((r) => r.state === "failed"),
      cancelled: count((r) => r.state === "cancelled"),
      onWhatsApp: count((r) => r.channel === "whatsapp"),
      onEmail: count((r) => r.channel !== "whatsapp"),
      whatsappScheduled: count((r) => r.channel === "whatsapp" && r.state === "scheduled"),
      whatsappSent: count((r) => r.channel === "whatsapp" && r.state === "sent"),
      whatsappDelivered: count((r) => r.channel === "whatsapp" && r.delivery_state === "delivered"),
      /* The strongest signal that the schedule itself has never fired: rows
         are due, and nothing has ever been sent. */
      neverSentAnything: sentRows.length === 0,
      lastSentAt,
    },
    recentFailures: failures,
  });
}
