import { adminClient } from "../lib/auth.mjs";
import { drainQueue } from "../lib/outreachSender.mjs";

/**
 * Drain the campaign queue on a schedule.
 *
 * The work is in ../lib/outreachSender.mjs, because a launch drains a little
 * of the queue itself so the first message goes out in seconds rather than
 * whenever this next happens to run. This is what carries the rest of a
 * campaign across the hours and days that follow.
 *
 * Most runs correctly send nothing: outside the campaign's sending hours, at
 * the weekend, once the daily cap is spent, or simply because not enough time
 * has passed since the last message to have earned another. That is the
 * throttle working, not a failure.
 */

/* THE SCHEDULE IS DECLARED IN netlify.toml, NOT HERE. `export const config`
   is Netlify's v2 function format, which also requires a default export;
   every function in this repo is v1. A file carrying the v2 marker with no
   default export can be classified as a broken v2 function and take the
   whole deploy down with it. */

/** Per run. Small, because the pacing comes from running often rather than
 *  from sending a lot at once — see the note on the gap in sendWindow. */
const BATCH = 5;

export async function handler() {
  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("outreach: no service credentials —", err?.message ?? err);
    return { statusCode: 500, body: "not configured" };
  }

  const tally = await drainQueue(admin, {
    siteUrl: process.env.URL || process.env.DEPLOY_PRIME_URL || "",
    batchLimit: BATCH,
  });

  console.log("outreach:", JSON.stringify(tally));
  return { statusCode: tally.error ? 500 : 200, body: JSON.stringify(tally) };
}
