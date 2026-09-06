import { timingSafeEqual } from "node:crypto";
import { adminClient } from "../lib/auth.mjs";
import { classify } from "../lib/indiamart.mjs";
import { applyLeads, ownerFor, readState, writeState } from "../lib/indiamartStore.mjs";

/**
 * IndiaMART's push webhook — a lead the moment it is raised.
 *
 * THE ACCELERATOR, NOT THE SOURCE OF TRUTH. indiamart-pull.mjs remains
 * authoritative. IndiaMART documents no retry policy, no ordering and no
 * delivery guarantee for this endpoint, so anything that arrives here is a
 * bonus and anything that does not is picked up by the poller within five
 * minutes. Both write through the same idempotent upsert, so a lead that
 * arrives twice is one customer.
 *
 * THERE IS NO SIGNATURE TO CHECK. This is the important difference from
 * webhook-receive.mjs, which verifies an HMAC the company's own website
 * computes. IndiaMART has no such scheme: their panel takes a URL and posts
 * to it, and that is the whole of it. So the URL itself is the credential —
 * a high-entropy token in the query string, compared in constant time, and
 * the URL is therefore a secret. It is shown once when generated and stored
 * hashed, the same way the outbound signing secret already is.
 *
 * WHAT THAT MEANS IN PRACTICE: anybody holding the URL can create customer
 * records. They cannot read anything — this endpoint answers the same short
 * acknowledgement whatever happens — and every record it writes is tagged
 * with its origin, so a flood is identifiable and reversible. That is a
 * deliberate trade for a feature IndiaMART only offers this way.
 */

const MAX_BODY_BYTES = 100_000;

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST") return reply(405, { error: "Method not allowed" });

  const raw = event.body || "";
  if (raw.length > MAX_BODY_BYTES) return reply(413, { error: "Payload too large." });

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("indiamart-push not configured:", err?.message ?? err);
    /* 500 rather than 4xx: ours to fix, and a sender that retries should. */
    return reply(500, { error: "Not configured." });
  }

  const supplied = String(event.queryStringParameters?.token ?? "");
  const { data: row } = await admin
    .from("webhook_secrets").select("secret").eq("id", "indiamart_push").maybeSingle();
  const expected = String(row?.secret ?? "");

  if (!expected || !constantTimeEqual(supplied, expected)) {
    /* The same answer whether the token is absent, wrong, or the feature was
       never switched on: a caller learns nothing from which. */
    return reply(401, { error: "Unauthorized." });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    /* They send JSON. Anything else is worth seeing in the log, because a
       change at their end shows up here first. */
    console.error("indiamart-push: body was not JSON:", raw.slice(0, 500));
    return reply(400, { error: "Expected JSON." });
  }

  /* RESPONSE is a single object here rather than the Pull API's array;
     leadsFrom flattens the difference. */
  const verdict = classify(200, body);
  if (!verdict.ok) {
    console.error("indiamart-push: envelope said", verdict.code, verdict.message);
    /* 200 on purpose. Their retry behaviour is undocumented, and a lead we
       could not read is one the poller will fetch anyway — better than an
       error that might make them disable the endpoint. */
    return reply(200, { received: 0 });
  }

  const owner = await ownerFor(admin);
  const tally = await applyLeads(admin, verdict.leads, owner);

  const { all } = await readState(admin);
  await writeState(admin, all, {
    lastPushAt: Date.now(),
    lastPushCount: verdict.leads.length,
  });

  if (tally.problems.length) console.error("indiamart-push: some leads did not apply —", tally.problems.join("; "));
  console.log("indiamart-push:", verdict.leads.length, "lead(s) ->", tally.created, "new,", tally.updated, "updated");

  return reply(200, { received: verdict.leads.length });
}

/** Constant time, so the comparison cannot be used to guess the token one
 *  character at a time. Length is compared first because timingSafeEqual
 *  throws on a mismatch, which would itself be a signal. */
function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const reply = (statusCode, payload) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
