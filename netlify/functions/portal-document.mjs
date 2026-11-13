import { clientIp, fail, guard, json } from "../lib/http.mjs";
import { adminClient } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { str } from "../lib/validate.mjs";
import { resolveToken } from "../lib/portalToken.mjs";
import { isVisibleToCustomer, printableDocument, printableSettings } from "../lib/portalPrint.mjs";

/**
 * One document, in the form its PDF is built from.
 *
 * WHY THIS EXISTS SEPARATELY FROM portal.mjs. The page shows what is on a
 * document; this returns what is PRINTED on it — the letterhead, the
 * registration numbers, the signature block, the bank details. Loading
 * that with the list would put it in front of every link holder whether
 * they wanted a copy or not, and the list is fetched the moment the page
 * opens. Asked for per document, on a button, it is the thing somebody
 * actually requested.
 *
 * WHY THE PDF IS BUILT IN THE BROWSER rather than here. It is the same
 * renderer the CRM uses, so a customer's copy is byte-for-byte the
 * document the salesperson sent — one renderer, one layout, one set of
 * rounding rules. Rendering it here would mean a second implementation in
 * another language's PDF library, and two renderers that must agree
 * forever is how a customer's copy comes to say something the company's
 * copy does not.
 *
 * THE TOKEN DECIDES WHICH DOCUMENT, not the id. The id is filtered against
 * the link's own customer and against the same visibility rule the list
 * uses, so a caller who guesses another document's id gets nothing — and a
 * draft is not downloadable however it is asked for.
 */

const TABLES = {
  quotation: "quotes",
  proforma: "proformas",
  invoice: "invoices",
};

export async function handler(event) {
  const stop = guard(event, "GET", "GET, OPTIONS");
  if (stop) return stop;

  const token = str(event.queryStringParameters?.t, 200);
  const id = str(event.queryStringParameters?.id, 64);
  const kind = str(event.queryStringParameters?.kind, 20);
  if (!token || !id || !TABLES[kind]) {
    return fail(event, 400, "This link looks incomplete.", null, "GET, OPTIONS");
  }

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "This page isn't available just now.", err?.message, "GET, OPTIONS");
  }

  const rl = await consume(admin, "portal", clientIp(event));
  if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds), null, "GET, OPTIONS");

  try {
    const found = await resolveToken(admin, token);
    if (!found.ok) {
      console.warn("portal document rejected:", found.reason);
      return json(event, 200, { ok: false }, "GET, OPTIONS");
    }

    const [docRes, settingsRes] = await Promise.all([
      admin.from(TABLES[kind]).select("id, data")
        .eq("id", id).eq("customer_id", found.link.customer_id).maybeSingle(),
      admin.from("settings").select("data").eq("id", "main").maybeSingle(),
    ]);

    /* The same answer for "not this customer's" as for "no such document":
       a caller probing ids must not be able to tell them apart. */
    if (!docRes.data || !isVisibleToCustomer(kind, docRes.data?.data?.status)) {
      return json(event, 200, { ok: false }, "GET, OPTIONS");
    }

    return json(event, 200, {
      ok: true,
      kind,
      doc: printableDocument(kind, docRes.data),
      settings: printableSettings(settingsRes.data),
    }, "GET, OPTIONS");
  } catch (err) {
    return fail(event, 500, "We couldn't fetch that document.", err?.message, "GET, OPTIONS");
  }
}
