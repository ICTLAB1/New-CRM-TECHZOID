import { clientIp, fail, guard, json } from "../lib/http.mjs";
import { adminClient } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { str } from "../lib/validate.mjs";
import { noteView, resolveToken } from "../lib/portalToken.mjs";
import {
  isVisibleToCustomer, publicCompany, publicCustomer, publicDocument,
} from "../lib/portalView.mjs";

/**
 * The customer's own view of their quotes, proformas and invoices.
 *
 * INTENTIONALLY UNAUTHENTICATED in the ordinary sense — there is no account
 * and no password — but not unprotected: the link itself is a 32-byte secret,
 * it is stored only as a hash (supabase/021_portal_tokens.sql), it expires,
 * and it can be revoked.
 *
 * WHY THIS RUNS ON THE SERVER. The obvious implementation is to let the
 * customer's browser query Supabase with the anon key and an RLS policy keyed
 * on the token. That would mean granting `anon` a way to read `quotes`,
 * `proformas` and `invoices` — the entire sales history of the company, with
 * the buying price of every line in it — and betting the business on one
 * policy predicate being right forever. Reading here with the service role
 * costs a function invocation and means the anon key is granted nothing new at
 * all. A customer's browser never speaks to the database.
 *
 * Everything returned goes through ../lib/portalView.mjs, which is an
 * allowlist. Read the comment at the top of that file before adding a field.
 */

export async function handler(event) {
  const stop = guard(event, "GET", "GET, OPTIONS");
  if (stop) return stop;

  const token = str(event.queryStringParameters?.t, 200);
  if (!token) return fail(event, 400, "This link looks incomplete.", null, "GET, OPTIONS");

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "This page isn't available just now.", err?.message, "GET, OPTIONS");
  }

  /* Rate limited on the IP, not the token: the traffic worth stopping is
     somebody trying many tokens, and limiting per-token would let them. */
  const rl = await consume(admin, "portal", clientIp(event));
  if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds), null, "GET, OPTIONS");

  try {
    const found = await resolveToken(admin, token);
    if (!found.ok) {
      /* 200, not 404, and the same body whatever went wrong. A different
         status or message for "revoked" than for "never existed" is a probe
         oracle, and the page has something useful to say either way. */
      console.warn("portal link rejected:", found.reason);
      return json(event, 200, { valid: false }, "GET, OPTIONS");
    }
    const { link } = found;

    const [customerRes, settingsRes, quotes, proformas, invoices] = await Promise.all([
      admin.from("customers").select("id, data").eq("id", link.customer_id).maybeSingle(),
      admin.from("settings").select("data").eq("id", "main").maybeSingle(),
      admin.from("quotes").select("id, data").eq("customer_id", link.customer_id),
      admin.from("proformas").select("id, data").eq("customer_id", link.customer_id),
      admin.from("invoices").select("id, data").eq("customer_id", link.customer_id),
    ]);

    if (!customerRes.data) return json(event, 200, { valid: false }, "GET, OPTIONS");

    /* Note the tables that are NOT queried: purchase_orders, orders, challans,
       profiles, attachments, and every table belonging to another customer.
       The customer_id filter is applied here rather than trusted from the
       request, so there is no parameter to tamper with. */
    const documents = [
      ...(quotes.data ?? []).map((r) => ["quotation", r]),
      ...(proformas.data ?? []).map((r) => ["proforma", r]),
      ...(invoices.data ?? []).map((r) => ["invoice", r]),
    ]
      .filter(([kind, row]) => isVisibleToCustomer(kind, row?.data?.status))
      .map(([kind, row]) => publicDocument(kind, row))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    noteView(admin, link);

    return json(event, 200, {
      valid: true,
      customer: publicCustomer(customerRes.data),
      company: publicCompany(settingsRes.data),
      documents,
    }, "GET, OPTIONS");
  } catch (err) {
    return fail(event, 500, "This page isn't available just now. Please try again in a moment.", err?.message, "GET, OPTIONS");
  }
}
