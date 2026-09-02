import { adminClient } from "../lib/auth.mjs";

/**
 * Somebody clicking "unsubscribe" at the bottom of a campaign email.
 *
 * UNAUTHENTICATED BY NECESSITY. The person clicking has no account here and
 * never will. That makes the design of the link the whole security story:
 *
 *   IT IS KEYED BY THE SEND ROW'S ID, NOT THE ADDRESS. A link carrying
 *   ?email=someone@rival.example would let anybody unsubscribe anybody, and
 *   worse, let somebody enumerate who we have been writing to. The id is a
 *   random uuid that reveals nothing and maps to exactly one message.
 *
 *   IT ONLY EVER ADDS. There is no parameter that removes a suppression and
 *   no path here that writes anything else. The worst a forged request can
 *   achieve is stopping mail to somebody — which is a thing this system is
 *   supposed to do easily.
 *
 *   IT ANSWERS THE SAME WAY WHATEVER HAPPENS. An unknown id gets the same
 *   page as a real one. Anything else turns the endpoint into an oracle for
 *   guessing valid ids.
 *
 * GET, not POST. Mail clients and corporate link-scanners follow links, and a
 * scanner pre-fetching the URL unsubscribes somebody who never clicked — an
 * acceptable failure in this one direction, and far better than an
 * unsubscribe link that does not work.
 */

export async function handler(event) {
  const sendId = String(event.queryStringParameters?.s ?? "").trim();

  /* Answered identically for a bad id, a missing id, or a database that is
     down: nobody clicking a link in an email should be shown a stack trace,
     and nobody probing should learn anything. */
  if (!sendId || !/^[0-9a-f-]{36}$/i.test(sendId)) return page();

  try {
    const admin = adminClient();

    const { data: row } = await admin
      .from("outreach_sends")
      .select("id, send_to, prospect_id")
      .eq("id", sendId)
      .maybeSingle();

    if (row?.send_to) {
      const email = String(row.send_to).trim().toLowerCase();

      await admin.from("outreach_suppressions").upsert(
        { email, reason: "unsubscribed", source: "email-link", note: "" },
        { onConflict: "email", ignoreDuplicates: true },
      );

      /* The prospect is marked too, so the list shows it without a join and
         a salesperson looking at the record sees why it is off limits. */
      if (row.prospect_id) {
        await admin
          .from("outreach_prospects")
          .update({ status: "Unsubscribed", updated_at: new Date().toISOString() })
          .eq("id", row.prospect_id);
      }

      /* Anything still queued to this person, in any campaign, stops now
         rather than at the next suppression re-read. */
      await admin
        .from("outreach_sends")
        .update({ state: "skipped", note: "Unsubscribed before this was due." })
        .eq("send_to", row.send_to)
        .eq("state", "queued");
    }
  } catch (err) {
    /* Logged, not shown. The person still sees the confirmation: telling them
       it failed would invite them to click again, and the suppression is
       almost always already recorded by the time anything here throws. */
    console.error("unsubscribe failed for", sendId, "—", err?.message ?? err);
  }

  return page();
}

const page = () => ({
  statusCode: 200,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  body: `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Unsubscribed</title>
<style>
  body { margin:0; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif;
         background:#f8fafc; color:#0f172a; display:grid; place-items:center; min-height:100vh; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:32px;
          max-width:440px; margin:16px; }
  h1 { margin:0 0 8px; font-size:20px; }
  p { margin:0; color:#475569; line-height:1.6; }
</style>
</head><body>
  <div class="card">
    <h1>You have been unsubscribed</h1>
    <p>We will not email you again. You can close this page.</p>
  </div>
</body></html>`,
});
