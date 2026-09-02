import { adminClient, signedInProfile } from "../lib/auth.mjs";
import { buildAudience, buildValues, withGreetingFallback } from "../lib/outreachAudience.mjs";
import { renderCampaignFor } from "../lib/outreachRender.mjs";
import { drainQueue } from "../lib/outreachSender.mjs";
import { renderSignature, signatureFrom } from "../lib/outreachSignature.mjs";

/**
 * Turn a campaign and a list of prospects into a send queue.
 *
 * THIS EXISTS BECAUSE THE BROWSER MAY NOT WRITE TO THE QUEUE. Migration 027
 * revokes insert on `outreach_sends` from `authenticated`, so this endpoint is
 * the only way a row gets there. Anything a screen could have got wrong — a
 * stale suppression list, a prospect it was not allowed to see, a campaign
 * belonging to somebody else — is re-decided here against the database as it
 * stands right now.
 *
 * IT RENDERS EVERY MESSAGE UP FRONT, one per recipient, and stores the words.
 * The sender then sends what is written and templates nothing. That costs a
 * little storage and buys the one thing that matters when 400 emails go out
 * over nine days: what was sent to a given person is a fact on a row, not a
 * re-derivation that could come out differently next Tuesday because somebody
 * edited the campaign in between.
 *
 * IT QUEUES, THEN SENDS THE FIRST FEW ITSELF. Queueing alone meant the first
 * message could be a quarter of an hour behind the person who pressed Launch,
 * because only the scheduled sender drained the queue. They pressed it,
 * watched nothing arrive, and concluded the feature was broken — a fair
 * reading. The throttle is unchanged: what goes out here is what the campaign
 * is allowed right now, and the schedule carries the rest.
 */

/** Enough for a real list; small enough that the insert cannot outlive the
 *  function's time budget. A larger list queues in several presses, and the
 *  unique index means overlapping presses cannot double up. */
const MAX_RECIPIENTS = 5000;
const CHUNK = 500;

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Use POST." });
  }

  const caller = await signedInProfile(event);
  if (!caller?.user) return json(401, { error: "Sign in first." });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "That request was not valid JSON." });
  }

  const campaignId = String(body.campaignId ?? "");
  const prospectIds = Array.isArray(body.prospectIds) ? body.prospectIds.map(String) : [];
  const allowMissing = !!body.allowMissing;
  const greetUnnamed = !!body.greetUnnamed;

  if (!campaignId) return json(400, { error: "Which campaign?" });
  if (!prospectIds.length) return json(400, { error: "Choose at least one prospect." });
  if (prospectIds.length > MAX_RECIPIENTS) {
    return json(400, { error: `That is more than ${MAX_RECIPIENTS} recipients. Launch it in smaller batches.` });
  }

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("outreach-launch: no service credentials —", err?.message ?? err);
    return json(500, { error: "Sending is not configured on the server." });
  }

  /* WHOSE CAMPAIGN. The service role bypasses RLS, so the ownership check
     that the database would have made has to be made here, explicitly. */
  const { data: campaign, error: campErr } = await admin
    .from("outreach_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();

  if (campErr) {
    console.error("outreach-launch: campaign unreadable —", campErr.message);
    return json(500, { error: "Could not read that campaign." });
  }
  if (!campaign) return json(404, { error: "That campaign no longer exists." });

  const privileged = caller.role === "Admin" || caller.role === "Manager";
  if (campaign.owner_id !== caller.user.id && !privileged) {
    return json(403, { error: "That campaign belongs to somebody else." });
  }

  if (campaign.status === "cancelled" || campaign.status === "done") {
    return json(409, { error: `That campaign is ${campaign.status}. Copy it to send again.` });
  }
  if (!String(campaign.subject || "").trim() || !String(campaign.body || "").trim()) {
    return json(400, { error: "The campaign needs a subject and a message before it can go out." });
  }

  /* The prospects, as they are now — not as the screen remembers them. */
  const { data: prospects, error: pErr } = await admin
    .from("outreach_prospects")
    .select("*")
    .in("id", prospectIds);

  if (pErr) {
    console.error("outreach-launch: prospects unreadable —", pErr.message);
    return json(500, { error: "Could not read those prospects." });
  }

  /* THE SUPPRESSION LIST AS IT STANDS THIS SECOND. Somebody may have
     unsubscribed while the composer was open. */
  const { data: suppressedRows, error: sErr } = await admin
    .from("outreach_suppressions")
    .select("email");
  if (sErr) {
    console.error("outreach-launch: suppression list unreadable —", sErr.message);
    return json(500, { error: "Could not read the suppression list. Nothing was queued." });
  }
  const suppressed = new Set((suppressedRows ?? []).map((r) => String(r.email).trim().toLowerCase()));

  /* Anyone this campaign has already queued or written to. Belt to the
     unique index's braces, and it lets the excluded count explain itself
     rather than the insert silently dropping rows. */
  const { data: existing } = await admin
    .from("outreach_sends")
    .select("send_to")
    .eq("campaign_id", campaignId);
  const already = new Set((existing ?? []).map((r) => String(r.send_to).trim().toLowerCase()));

  /* THE SENDER'S OWN DETAILS, and this was wrong. company was the empty
     string and the designation was never passed at all, so a message using
     {{sender_company}} or {{sender_designation}} rendered them as literal
     braces in the email that went out — while the composer's preview, which
     reads the same values from settings, showed them filled. A preview that
     disagrees with what is sent is the one failure this feature cannot
     afford, and it was sitting in the difference between two files. */
  const settings = await loadSettings(admin);
  const company = (settings.company ?? {});

  const sender = {
    name: caller.profile?.name ?? "",
    email: caller.profile?.email ?? "",
    company: String(company.name ?? ""),
    designation: caller.profile?.designation ?? "",
    phone: String(company.phone ?? ""),
    signature: caller.profile?.designation ?? "",
  };

  /* The signature block, rendered ONCE for the campaign rather than per
     recipient: it is the same for everybody, and rendering it four hundred
     times would put four hundred copies of a base64 logo into the queue. */
  const signature = renderSignature(signatureFrom(settings, {
    name: sender.name, email: sender.email, designation: sender.designation,
  }));

  const audience = buildAudience({
    candidates: (prospects ?? []).map((p) => ({
      id: String(p.id),
      email: String(p.email ?? ""),
      /* The same fallback the screen applied, applied here too. Without it
         the screen would show "Hello there," in its preview and this would
         render "Hello {{first_name}}," into the actual email. */
      values: withGreetingFallback(buildValues(p, sender), greetUnnamed),
      quarantined: !!p.quarantined,
      verificationStatus: String(p.verification_status ?? "Unknown"),
    })),
    parts: { subject: String(campaign.subject), body: String(campaign.body) },
    suppressed,
    alreadySent: already,
    allowMissing,
  });

  if (!audience.send.length) {
    return json(200, { queued: 0, excluded: audience.excluded.length, sending: false });
  }

  /* Rendered per person, now, and stored. See the note at the top. */
  const rows = audience.send.map((r) => {
    const rendered = renderCampaignFor(campaign, r.values, signature);
    return {
      campaign_id: campaignId,
      prospect_id: r.id,
      send_to: r.email.trim(),
      /* Step one. A campaign's later steps are queued with their own
         step_no and due_at — see supabase/030_outreach_sequences.sql — and
         the unique index is (campaign, prospect, step) so the same person
         can receive all four without colliding. */
      step_no: 1,
      subject: rendered.subject,
      body: rendered.body,
      html: rendered.html,
      state: "queued",
    };
  });

  let queued = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    /* ignoreDuplicates, so a second press of Launch adds only the people who
       were not already queued rather than failing the whole batch. */
    const { data, error } = await admin
      .from("outreach_sends")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "campaign_id,prospect_id,step_no", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("outreach-launch: could not queue —", error.message);
      /* Partial is honest: the rows already written WILL be sent, and saying
         "nothing was queued" here would be a lie the sender then contradicts. */
      return json(500, { error: "Only part of the campaign could be queued.", queued });
    }
    queued += (data ?? []).length;
  }

  const { error: startErr } = await admin
    .from("outreach_campaigns")
    .update({
      status: "sending",
      started_at: campaign.started_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
  if (startErr) {
    /* The queue exists but the campaign is not marked live, so the sender
       will not pick it up. Say so rather than reporting success. */
    console.error("outreach-launch: queued but could not start —", startErr.message);
    return json(500, { error: "The recipients were queued but the campaign could not be started. Try Resume.", queued });
  }

  /* SEND WHAT IT MAY, NOW. Small budget on purpose: a person is waiting on
     this response, and the point is that the first message leaves before they
     have finished reading the confirmation — not that the whole campaign goes
     out in one request. Failing here is not failing the launch: the rows are
     queued and the schedule will carry them, so a problem draining is logged
     and the launch still reports success. */
  let sentNow = 0;
  try {
    const drained = await drainQueue(admin, {
      siteUrl: process.env.URL || process.env.DEPLOY_PRIME_URL || "",
      batchLimit: 2,
      campaignId,
    });
    sentNow = drained.sent ?? 0;
  } catch (err) {
    console.error("outreach-launch: queued but could not start sending —", err?.message ?? err);
  }

  console.log("outreach-launch:", JSON.stringify({ campaignId, queued, sentNow, excluded: audience.excluded.length }));
  return json(200, { queued, sentNow, excluded: audience.excluded.length, sending: true });
}

/**
 * The workspace settings.
 *
 * Read server-side rather than accepted from the request, so a compromised
 * session cannot put arbitrary HTML into mail leaving this company's domain.
 * An empty object on failure: a campaign with no company name in it is worse
 * than one with, and better than no campaign at all.
 */
async function loadSettings(admin) {
  try {
    const { data } = await admin.from("settings").select("data").eq("id", "main").maybeSingle();
    return data?.data ?? {};
  } catch (err) {
    console.warn("outreach-launch: could not read settings —", err?.message ?? err);
    return {};
  }
}

const json = (statusCode, payload) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
