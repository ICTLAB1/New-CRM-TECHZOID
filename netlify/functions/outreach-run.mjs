import { adminClient } from "../lib/auth.mjs";
import { sendMail } from "../lib/mailer.mjs";
import { localParts, scheduleOf, sendWindow } from "../lib/outreachAudience.mjs";
import { withUnsubscribe } from "../lib/outreachRender.mjs";

/**
 * Send the campaign mail that is due right now.
 *
 * Runs on a schedule with nobody watching, and unlike the follow-up sender it
 * writes to strangers. That shapes everything here:
 *
 *   IT RE-CHECKS SUPPRESSION IMMEDIATELY BEFORE EVERY SEND. Days pass between
 *   queueing a row and reaching it. In that time the person may have clicked
 *   unsubscribe on an earlier message in the same campaign. Writing to them
 *   after that is the one failure with a legal edge, so the queue is never
 *   trusted: the check happens per message, not per run.
 *
 *   IT SENDS WHAT WAS WRITTEN. The subject and body were rendered per
 *   recipient at launch and stored. Nothing is re-templated here — only the
 *   unsubscribe link is filled in, because it needs the row's own id.
 *
 *   IT NEVER SENDS TWICE. A row is claimed by moving queued -> sending with
 *   the update conditional on it still being 'queued'. Two overlapping runs
 *   cannot both claim the same row: the second update matches nothing.
 *
 *   IT OBEYS THE THROTTLE. Daily cap, minimum gap, sending hours and sending
 *   days, all in the campaign's own timezone. Most runs send nothing and that
 *   is the system working — a domain that sends 400 cold emails in an hour
 *   stops reaching inboxes by Thursday, and it shares that domain with the
 *   mailbox this company's quotations go out from.
 *
 *   IT IS BOUNDED. At most BATCH messages per run across all campaigns.
 */

/* THE SCHEDULE IS DECLARED IN netlify.toml, NOT HERE. `export const config`
   is Netlify's v2 function format, which also requires a default export;
   every function in this repo is v1. A file carrying the v2 marker with no
   default export can be classified as a broken v2 function and take the
   whole deploy down with it. */

/** Across all campaigns, per run. The gap between messages is what actually
 *  paces a campaign; this only stops one run outliving its time budget. */
const BATCH = 20;

export async function handler() {
  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("outreach: no service credentials —", err?.message ?? err);
    return { statusCode: 500, body: "not configured" };
  }

  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
  const now = new Date();

  const { data: campaigns, error } = await admin
    .from("outreach_campaigns")
    .select("*")
    .eq("status", "sending")
    .order("started_at", { ascending: true });

  if (error) {
    console.error("outreach: could not read campaigns —", error.message);
    return { statusCode: 500, body: "campaigns unreadable" };
  }

  /* Read once for the whole run rather than per message. A person who
     unsubscribes DURING a run is caught on the next one — minutes later —
     and the alternative is a query per message against a list that changes
     a few times a week. */
  const suppressed = await loadSuppressions(admin);
  if (!suppressed) {
    /* Not knowing who has opted out is not a reason to guess. */
    console.error("outreach: suppression list unreadable — sending nothing this run");
    return { statusCode: 500, body: "suppression list unreadable" };
  }

  const tally = { campaigns: (campaigns ?? []).length, sent: 0, failed: 0, skipped: 0, held: {} };
  let budget = BATCH;

  for (const campaign of campaigns ?? []) {
    if (budget <= 0) break;

    const schedule = scheduleOf(campaign);
    const today = localParts(now, schedule.timezone).date;

    const sentToday = await countSentToday(admin, campaign.id, schedule.timezone, today);
    const lastSentAt = await lastSend(admin, campaign.id);

    const window = sendWindow({ now, schedule, sentToday, lastSentAt, batchLimit: budget });

    if (!window.allowed) {
      tally.held[window.hold] = (tally.held[window.hold] ?? 0) + 1;
      /* A campaign whose queue is empty and whose window is merely closed is
         not finished — but one with nothing left at all is. */
      await finishIfDrained(admin, campaign.id);
      continue;
    }

    const { data: rows, error: qErr } = await admin
      .from("outreach_sends")
      .select("id, prospect_id, send_to, subject, body, html")
      .eq("campaign_id", campaign.id)
      .eq("state", "queued")
      .order("created_at", { ascending: true })
      .limit(window.allowed);

    if (qErr) {
      console.error("outreach: queue unreadable for", campaign.id, "—", qErr.message);
      continue;
    }

    if (!rows?.length) {
      await finishIfDrained(admin, campaign.id);
      continue;
    }

    for (const row of rows) {
      if (budget <= 0) break;

      /* THE CHECK THAT MATTERS. Between launch and this moment they may have
         unsubscribed from an earlier message in this very campaign. */
      if (suppressed.has(String(row.send_to).trim().toLowerCase())) {
        await mark(admin, row.id, {
          state: "skipped",
          note: "On the suppression list by the time this was due.",
        });
        tally.skipped += 1;
        continue;
      }

      /* Claim it. Conditional on still being 'queued', so a second run that
         overlaps this one matches no rows and cannot send the same message
         a second time. */
      const { data: claimed, error: claimErr } = await admin
        .from("outreach_sends")
        .update({ state: "sending", claimed_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("state", "queued")
        .select("id");

      if (claimErr) {
        console.error("outreach: could not claim", row.id, "—", claimErr.message);
        continue;
      }
      if (!claimed?.length) continue; // another run got there first

      const message = withUnsubscribe(row, siteUrl);

      const result = await sendMail({
        admin,
        userId: campaign.owner_id,
        /* The mailbox the campaign was set up to send from — possibly a
           shared one somebody was granted (024), not the owner's own. */
        accountId: campaign.from_account_id || null,
        to: row.send_to,
        subject: message.subject,
        message: message.message,
        html: message.html,
        replyTo: campaign.reply_to || "",
      });

      budget -= 1;

      if (result.ok) {
        tally.sent += 1;
        await mark(admin, row.id, {
          state: "sent",
          sent_at: new Date().toISOString(),
          note: "",
          ...(result.id ? { provider_message_id: String(result.id) } : {}),
        });
        /* So the prospect list shows when they were last written to, without
           anyone having to join through the send queue to find out. */
        await admin
          .from("outreach_prospects")
          .update({ last_contacted_at: new Date().toISOString(), status: "Contacted" })
          .eq("id", row.prospect_id);
      } else {
        tally.failed += 1;
        await mark(admin, row.id, {
          state: "failed",
          note: String(result.error ?? "").slice(0, 500),
        });

        /* A mailbox that cannot authenticate will fail identically for every
           remaining row. Pausing beats burning the whole queue into failures
           that a person then has to pick through one by one. */
        if (!result.retryable && /expired|reconnect|not connected/i.test(String(result.error ?? ""))) {
          await admin
            .from("outreach_campaigns")
            .update({ status: "paused", updated_at: new Date().toISOString() })
            .eq("id", campaign.id);
          console.error("outreach: paused", campaign.id, "— the mailbox needs reconnecting");
          break;
        }
      }
    }
  }

  console.log("outreach:", JSON.stringify(tally));
  return { statusCode: 200, body: JSON.stringify(tally) };
}

/** @returns {Promise<Set<string>|null>} null when it could not be read. */
async function loadSuppressions(admin) {
  const { data, error } = await admin.from("outreach_suppressions").select("email");
  if (error) return null;
  return new Set((data ?? []).map((r) => String(r.email).trim().toLowerCase()));
}

/**
 * How many this campaign has sent today, in its own timezone.
 *
 * The boundary is computed from the campaign's local date rather than UTC:
 * a cap of 50 that resets at 05:30 local would let 100 go out on the day
 * somebody notices.
 */
async function countSentToday(admin, campaignId, timezone, localDate) {
  /* A day in the campaign's timezone, expressed as a UTC range. Built by
     asking Intl what UTC instant the local midnight corresponds to, rather
     than assuming an offset — India is +5:30 and a UAE colleague's campaign
     is not. */
  const startUtc = localMidnightUtc(localDate, timezone);
  const endUtc = new Date(startUtc.getTime() + 86400000);

  const { count, error } = await admin
    .from("outreach_sends")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("state", "sent")
    .gte("sent_at", startUtc.toISOString())
    .lt("sent_at", endUtc.toISOString());

  if (error) {
    console.error("outreach: could not count today's sends —", error.message);
    /* Unknown is treated as "the cap is spent". Sending too few is a delay;
       sending too many is a reputation this company cannot buy back. */
    return Number.MAX_SAFE_INTEGER;
  }
  return count ?? 0;
}

/** The UTC instant of local midnight on `localDate` in `timezone`. */
function localMidnightUtc(localDate, timezone) {
  const guess = new Date(`${localDate}T00:00:00Z`);
  const seen = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(guess);
  const h = Number(seen.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(seen.find((p) => p.type === "minute")?.value ?? 0);
  /* If midnight UTC reads as 05:30 locally, local midnight was 5h30m before. */
  return new Date(guess.getTime() - (h * 60 + m) * 60000);
}

async function lastSend(admin, campaignId) {
  const { data, error } = await admin
    .from("outreach_sends")
    .select("sent_at")
    .eq("campaign_id", campaignId)
    .eq("state", "sent")
    .order("sent_at", { ascending: false })
    .limit(1);
  if (error || !data?.length || !data[0].sent_at) return null;
  return new Date(data[0].sent_at);
}

/** Mark a campaign done once nothing is left to send. */
async function finishIfDrained(admin, campaignId) {
  const { count, error } = await admin
    .from("outreach_sends")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("state", ["queued", "sending"]);
  if (error || (count ?? 0) > 0) return;

  const { error: uErr } = await admin
    .from("outreach_campaigns")
    .update({ status: "done", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("status", "sending");
  if (uErr) console.error("outreach: could not finish", campaignId, "—", uErr.message);
}

async function mark(admin, id, patch) {
  const { error } = await admin.from("outreach_sends").update(patch).eq("id", id);
  if (error) console.error("outreach: could not record the outcome of", id, "—", error.message);
}
