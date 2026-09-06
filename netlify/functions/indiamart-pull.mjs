import { adminClient, signedInProfile } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { MIN_GAP_SECONDS, classify, pullUrl, windowFor } from "../lib/indiamart.mjs";
import { applyLeads, ownerFor, readState, writeState } from "../lib/indiamartStore.mjs";

/**
 * Fetches IndiaMART leads into the CRM.
 *
 * THE AUTHORITATIVE HALF. indiamart-push.mjs is faster but IndiaMART
 * publishes no retry, no ordering and no delivery guarantee for it, so a
 * listener that is down for ten minutes loses those leads permanently. This
 * runs every five minutes over an overlapping window and can be re-run
 * across any period in the last year, so a missed push heals itself without
 * anybody noticing it was missed.
 *
 * WHY FIVE MINUTES AND NOT FASTER. That is IndiaMART's floor: closer
 * together earns CODE 429, and more than five calls inside one minute gets
 * the key disabled for fifteen. The schedule is in netlify.toml.
 *
 * WHY IT MUST KEEP RUNNING EVEN WITH NOTHING TO FETCH. The key expires if it
 * goes unused for seven consecutive days. A poller that skipped its run when
 * business was quiet would eventually put the integration to sleep over a
 * long holiday and nobody would find out until the leads stopped.
 *
 * THE CURSOR ONLY MOVES ON SUCCESS. If a fetch fails the window stays where
 * it was, so the next run asks for the same period again. Advancing past a
 * window we never actually read is how leads disappear silently.
 */

export const handler = async (event) => {
  const manual = event?.httpMethod === "POST" || event?.httpMethod === "GET";

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("indiamart-pull not configured:", err?.message ?? err);
    return reply(500, { error: "Not configured." });
  }

  /* A person pressing "Fetch now" must be signed in and is rate limited;
     the scheduler is neither, because it has no session and its cadence is
     already fixed by netlify.toml. */
  if (manual) {
    const caller = await signedInProfile(event);
    if (!caller?.user) return reply(403, { error: "Sign in required." });
    const verdict = await consume(admin, "indiamart-pull", caller.user.id, { limit: 6, windowSeconds: 3600 });
    if (!verdict.allowed) return reply(429, { error: tooManyMessage(verdict.retryAfterSeconds) });
  }

  const key = process.env.INDIAMART_CRM_KEY || "";
  if (!key) {
    return reply(400, {
      error: "IndiaMART is not connected yet — INDIAMART_CRM_KEY has to be set in Netlify first.",
    });
  }

  const { all, state } = await readState(admin);
  if (state.enabled === false) return reply(200, { skipped: "IndiaMART fetching is switched off in Settings." });

  const now = new Date();

  /* Their floor, enforced on our side too. Two schedulers, or a scheduled
     run landing next to somebody pressing Fetch now, would otherwise spend
     the allowance and get the key disabled for a quarter of an hour. */
  const lastAt = Number(state.lastAttemptAt ?? 0);
  const waited = (now.getTime() - lastAt) / 1000;
  if (lastAt && waited < MIN_GAP_SECONDS) {
    return reply(200, {
      skipped: "Too soon — IndiaMART allows one fetch every five minutes.",
      retryAfterSeconds: Math.ceil(MIN_GAP_SECONDS - waited),
    });
  }

  const since = state.cursor ? new Date(state.cursor) : null;
  const window = windowFor(now, Number.isFinite(since?.getTime()) ? since : null);

  await writeState(admin, all, { lastAttemptAt: now.getTime() });

  let status = 0;
  let body = null;
  try {
    const response = await fetch(pullUrl(key, window), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    status = response.status;
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      /* Logged in full rather than swallowed: the one thing most likely to
         be wrong on a first connection is the timestamp format, and their
         answer to a malformed one is the fastest way to see it. */
      console.error("indiamart-pull: unparseable response", status, text.slice(0, 500));
      await writeState(admin, all, { lastError: "IndiaMART sent something that was not JSON.", lastErrorAt: Date.now() });
      return reply(502, { error: "IndiaMART sent something that was not JSON." });
    }
  } catch (err) {
    const reason = err?.name === "TimeoutError" ? "IndiaMART did not answer in time." : String(err?.message ?? err);
    console.error("indiamart-pull: fetch failed —", reason);
    await writeState(admin, all, { lastError: reason, lastErrorAt: Date.now() });
    return reply(502, { error: reason });
  }

  const verdict = classify(status, body);

  if (!verdict.ok) {
    console.error("indiamart-pull:", verdict.reason, verdict.code, verdict.message);
    await writeState(admin, all, {
      lastError: readableError(verdict),
      lastErrorAt: Date.now(),
      /* Surfaced separately because it is the one a person must act on. */
      keyProblem: verdict.reason === "bad-key" ? verdict.message || "The IndiaMART key was refused." : "",
    });
    /* The cursor deliberately does not move. */
    return reply(verdict.retry ? 503 : 400, { error: readableError(verdict), code: verdict.code });
  }

  const owner = await ownerFor(admin);
  const tally = await applyLeads(admin, verdict.leads, owner);

  /* Only now, having actually read the window, does the cursor advance. */
  await writeState(admin, all, {
    cursor: window.end.toISOString(),
    lastRunAt: Date.now(),
    lastError: "",
    keyProblem: "",
    lastCount: verdict.leads.length,
    lastCreated: tally.created,
  });

  if (tally.problems.length) console.error("indiamart-pull: some leads did not apply —", tally.problems.join("; "));
  console.log(
    "indiamart-pull:", verdict.leads.length, "leads for",
    window.startParam, "to", window.endParam,
    "->", tally.created, "new,", tally.updated, "updated",
  );

  return reply(200, {
    fetched: verdict.leads.length,
    created: tally.created,
    updated: tally.updated,
    skipped: tally.skipped,
    failed: tally.failed,
    window: { from: window.startParam, to: window.endParam },
  });
};

function readableError(verdict) {
  if (verdict.reason === "bad-key") {
    return "IndiaMART refused the key. Generate a new one in the seller panel under Lead Manager, "
      + "then update INDIAMART_CRM_KEY in Netlify. A key expires if it goes seven days unused.";
  }
  if (verdict.reason === "rate-limited") return "IndiaMART is rate limiting us. The next run will pick up where this left off.";
  if (verdict.reason === "their-fault") return "IndiaMART had a server error. The next run will try the same window again.";
  if (verdict.reason === "bad-request") return `IndiaMART rejected the request: ${verdict.message || "check the dates sent."}`;
  return verdict.message || "IndiaMART answered with something unexpected.";
}

const reply = (statusCode, payload) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
