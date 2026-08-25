import { adminClient } from "../lib/auth.mjs";
import { sendMail } from "../lib/mailer.mjs";
import { stopReason, TABLE_FOR } from "../lib/followupRules.mjs";

/**
 * Send the follow-ups that are due this morning.
 *
 * Runs on a schedule with nobody watching, which shapes every decision here:
 *
 *   IT RE-CHECKS THE DOCUMENT, ALWAYS. Weeks can pass between arming a
 *   sequence and sending step three. In that time the quotation may have
 *   been accepted, turned down or left to lapse. Chasing a customer for a
 *   decision they already gave is the single worst thing this feature could
 *   do, so the queue is never trusted on its own.
 *
 *   IT SENDS WHAT WAS WRITTEN. The subject, the body and the HTML were
 *   rendered when a person armed the sequence and previewed them. Nothing is
 *   re-templated here. This function has no opinion about what an email
 *   looks like.
 *
 *   IT NEVER SENDS TWICE. A row is marked before the next one is tried, and
 *   a transport failure that never handed the message over is recorded as
 *   failed rather than retried in the same run — the next morning is soon
 *   enough, and a retry loop against a mail API at 4am is how an account
 *   gets suspended.
 *
 *   IT IS BOUNDED. At most BATCH rows a run. A backlog drains over
 *   consecutive mornings instead of one run timing out half way and leaving
 *   nobody able to tell which half went.
 */

/* 04:00 UTC is 09:30 in India — the start of a working day, which is when a
   chaser should land rather than overnight. */
export const config = { schedule: "0 4 * * *" };

/** Enough for any real day's backlog; small enough to finish inside a
 *  function's time budget with room to spare. */
const BATCH = 100;

export async function handler() {
  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("follow-ups: no service credentials —", err?.message ?? err);
    return { statusCode: 500, body: "not configured" };
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await admin
    .from("follow_ups")
    .select("*")
    .eq("state", "scheduled")
    .lte("due_on", today)
    .order("due_on", { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("follow-ups: could not read the queue —", error.message);
    return { statusCode: 500, body: "queue unreadable" };
  }

  const rows = data ?? [];
  const tally = { due: rows.length, sent: 0, stopped: 0, failed: 0, skipped: 0 };

  /* One document is read once per run however many of its steps are due, and
     one stopped document takes its whole sequence with it. */
  const docs = new Map();
  const stopped = new Set();

  for (const row of rows) {
    if (stopped.has(row.doc_id)) { tally.stopped += 1; continue; }

    const verdict = await checkDocument(admin, docs, row, today);

    if (verdict.action === "skip") { tally.skipped += 1; continue; }

    if (verdict.action === "stop") {
      stopped.add(row.doc_id);
      tally.stopped += 1;
      await cancelSequence(admin, row.doc_id, verdict.why);
      continue;
    }

    const result = await sendMail({
      admin,
      userId: row.owner_id,
      to: row.send_to,
      cc: splitList(row.cc),
      subject: row.subject,
      message: row.message,
      html: row.html || null,
      replyTo: row.reply_to || "",
    });

    if (result.ok) {
      tally.sent += 1;
      await mark(admin, row.id, { state: "sent", sent_at: new Date().toISOString(), error: null });
    } else {
      tally.failed += 1;
      /* Recorded on the row, so it shows on the document the salesperson is
         looking at rather than only in a log they cannot reach. */
      await mark(admin, row.id, { state: "failed", error: String(result.error ?? "").slice(0, 500) });
    }
  }

  console.log("follow-ups:", JSON.stringify(tally));
  return { statusCode: 200, body: JSON.stringify(tally) };
}

/**
 * What to do with one queued row, given the document behind it.
 *
 * Three answers, and the third is the one that matters: "skip" means leave
 * the row exactly as it is and look again tomorrow. A database that would
 * not answer this morning is NOT evidence that a quotation was accepted, and
 * cancelling on a transient error would throw away a sequence nobody asked
 * to cancel — silently, at four in the morning.
 *
 * @returns {{action: "send"} | {action: "stop", why: string} | {action: "skip"}}
 */
async function checkDocument(admin, cache, row, today) {
  const table = TABLE_FOR[row.doc_type];
  if (!table) return { action: "stop", why: `it is a ${row.doc_type}, which is not followed up` };

  if (!cache.has(row.doc_id)) {
    const { data, error } = await admin.from(table).select("data").eq("id", row.doc_id).maybeSingle();
    if (error) {
      console.error("follow-ups: could not read", table, row.doc_id, "—", error.message);
      cache.set(row.doc_id, { unreadable: true });
    } else {
      cache.set(row.doc_id, { doc: data?.data ?? null });
    }
  }

  const entry = cache.get(row.doc_id);
  if (entry.unreadable) return { action: "skip" };
  /* Deleted, on the other hand, is permanent and knowable: there is nothing
     left to chase and nothing to look at tomorrow. */
  if (!entry.doc) return { action: "stop", why: "it no longer exists" };

  const why = stopReason(entry.doc, today);
  return why ? { action: "stop", why } : { action: "send" };
}

async function cancelSequence(admin, docId, why) {
  const { error } = await admin
    .from("follow_ups")
    .update({
      state: "cancelled",
      error: `Not sent — ${why}.`,
      updated_at: new Date().toISOString(),
    })
    .eq("doc_id", docId)
    .eq("state", "scheduled");
  if (error) console.error("follow-ups: could not stop the sequence for", docId, "—", error.message);
}

async function mark(admin, id, patch) {
  const { error } = await admin
    .from("follow_ups")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("follow-ups: could not record the outcome of", id, "—", error.message);
}

const splitList = (value) =>
  String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
