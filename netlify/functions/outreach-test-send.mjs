import { adminClient, signedInProfile } from "../lib/auth.mjs";
import { buildValues, withGreetingFallback } from "../lib/outreachAudience.mjs";
import { renderCampaignFor, withUnsubscribe } from "../lib/outreachRender.mjs";
import { renderSignature, signatureFrom } from "../lib/outreachSignature.mjs";
import { sendMail } from "../lib/mailer.mjs";

/**
 * Send one copy of a campaign to the person writing it, right now.
 *
 * WHY THIS EXISTS. A campaign goes out through a queue that a scheduled
 * function drains every fifteen minutes, inside working hours, at one message
 * every ninety seconds. That is correct for four hundred strangers and
 * useless for "does this look right?" — the first person to try it queued a
 * test, saw nothing arrive, and reasonably concluded the feature was broken.
 * Waiting a quarter of an hour to find out whether a subject line renders is
 * not a review loop anybody will use, and a review loop nobody uses is how a
 * campaign with a visible mistake reaches four hundred people.
 *
 * IT ONLY EVER SENDS TO THE CALLER'S OWN ADDRESS. The recipient is read from
 * the signed-in user's profile server-side and no address in the request is
 * consulted, because an authenticated endpoint that sends to an arbitrary
 * address is a relay: one leaked session and this company's sending domain is
 * delivering somebody else's mail. There is deliberately no parameter for it.
 *
 * IT DOES NOT TOUCH THE QUEUE. Nothing is written to outreach_sends, no
 * prospect is marked contacted, no daily cap is spent. A test is not a send,
 * and a test that consumed a slot would quietly reduce the day's real
 * capacity every time somebody checked their work.
 *
 * IT IS RATE LIMITED, because "send" is a button and buttons get pressed
 * twice.
 */

/** Per person, per minute. Generous for real use, tight enough that a stuck
 *  finger cannot become a hundred messages. */
const MAX_PER_MINUTE = 6;
const recent = new Map();

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });

  const caller = await signedInProfile(event);
  if (!caller?.user) return json(401, { error: "Sign in first." });

  /* THE ONLY ADDRESS THIS WILL EVER SEND TO. From the profile, server-side. */
  const to = String(caller.profile?.email ?? "").trim();
  if (!to) {
    return json(400, {
      error: "Your profile has no email address on it, so there is nowhere to send a test.",
    });
  }

  const now = Date.now();
  const hits = (recent.get(caller.user.id) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= MAX_PER_MINUTE) {
    return json(429, { error: "That is a lot of tests in one minute. Give it a moment." });
  }
  recent.set(caller.user.id, [...hits, now]);

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "That request was not valid JSON." });
  }

  const subject = String(body.subject ?? "").trim();
  const message = String(body.body ?? "").trim();
  if (!subject || !message) {
    return json(400, { error: "Write a subject and a message first." });
  }

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("outreach-test-send: no service credentials —", err?.message ?? err);
    return json(500, { error: "Sending is not configured on the server." });
  }

  /* WHICH MAILBOX. Checked, not taken on trust: a request naming a mailbox
     the caller was never granted would otherwise send as somebody else. */
  let accountId = String(body.fromAccountId ?? "") || null;
  if (accountId) {
    const { data: allowed } = await admin.rpc("may_manage_email_account", { p_account_id: accountId });
    if (allowed !== true) {
      const privileged = caller.role === "Admin" || caller.role === "Manager";
      if (!privileged) return json(403, { error: "That is not a mailbox you can send from." });
    }
  }

  /* Read once, and before the values are built: the sender's company name
     comes from here, and building the values first would leave
     {{sender_company}} empty in the test but filled in the real send. */
  let settings = {};
  try {
    const { data } = await admin.from("settings").select("data").eq("id", "main").maybeSingle();
    settings = data?.data ?? {};
  } catch (err) {
    console.warn("outreach-test-send: could not read settings —", err?.message ?? err);
  }

  /* Rendered against a REAL prospect where one was named, so the test shows
     what a recipient would actually receive rather than a template. Falls
     back to the caller's own details, which is honest about being a stand-in. */
  let values;
  const prospectId = String(body.prospectId ?? "");
  if (prospectId) {
    const { data: p } = await admin
      .from("outreach_prospects")
      .select("*")
      .eq("id", prospectId)
      .maybeSingle();
    if (p) values = buildValues(p, senderOf(caller, settings));
  }
  if (!values) {
    values = buildValues(
      { first_name: caller.profile?.name?.split(" ")[0] ?? "", company: "", email: to },
      senderOf(caller, settings),
    );
  }
  values = withGreetingFallback(values, !!body.greetUnnamed);

  /* The same signature the real send carries — whether it looks right is one
     of the main things a test is for. */
  const signature = renderSignature(signatureFrom(settings, {
    name: caller.profile?.name ?? "",
    email: caller.profile?.email ?? "",
    designation: caller.profile?.designation ?? "",
    phone: caller.profile?.phone ?? "",
  }));

  const rendered = renderCampaignFor({ subject, body: message }, values, signature);

  /* A real, working unsubscribe link, pointed at nothing. Its own id is not a
     send row, so clicking it does nothing — but it has to be in the message,
     because whether the footer looks right is one of the things a test is
     for. */
  const withFooter = withUnsubscribe(
    { id: "00000000-0000-0000-0000-000000000000", subject: rendered.subject, body: rendered.body, html: rendered.html },
    process.env.URL || process.env.DEPLOY_PRIME_URL || "",
  );

  const result = await sendMail({
    admin,
    userId: caller.user.id,
    accountId,
    to,
    /* Marked, so a test can never be mistaken for a message a prospect
       received. Everything below the subject line is exactly what would be
       sent, which is the part worth judging. */
    subject: `[Test] ${withFooter.subject}`,
    message: withFooter.message,
    html: withFooter.html,
    replyTo: String(body.replyTo ?? "") || "",
  });

  if (!result.ok) {
    console.error("outreach-test-send: failed —", result.error);
    return json(502, { error: String(result.error ?? "The test could not be sent.") });
  }

  console.log("outreach-test-send: sent to", to, "via", result.via);
  return json(200, { sent: true, to, via: result.via ?? "" });
}

/** The same shape outreach-launch.mjs builds, from the same places. A test
 *  that filled these differently from a launch would be worse than no test. */
const senderOf = (caller, settings = {}) => {
  const company = settings.company ?? {};
  return {
    name: caller.profile?.name ?? "",
    email: caller.profile?.email ?? "",
    company: String(company.name ?? ""),
    designation: caller.profile?.designation ?? "",
    /* Their own mobile, falling back to the company's. A purchase manager
       who rings the number under the name expects the person who wrote. */
    phone: String(caller.profile?.phone ?? "").trim() || String(company.phone ?? ""),
    signature: caller.profile?.designation ?? "",
  };
};

const json = (statusCode, payload) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
