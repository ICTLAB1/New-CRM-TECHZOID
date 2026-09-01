import { clientIp, fail, guard, json } from "../lib/http.mjs";
import { signedInUser } from "../lib/auth.mjs";
import { adminClient } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { str } from "../lib/validate.mjs";
import { cnameTarget, DOMAIN_RE, mxHost, resolve, unquoteTxt } from "../lib/dns.mjs";

/**
 * Reading a sending domain's DNS.
 *
 * SERVER-SIDE BECAUSE IT HAS TO BE: a browser cannot resolve TXT or MX
 * records at all. Uses DNS-over-HTTPS rather than Node's `dns` module,
 * because a serverless function's resolver is whatever the platform gives it
 * — often a cache with its own opinions — and an authoritative answer from a
 * known resolver is the one an administrator can reproduce.
 *
 * The grading lives in src/domain/outreach/domainHealth.ts and is unit
 * tested. This file only fetches; it makes no judgements of its own.
 */

/* Microsoft 365 publishes exactly these two and rotates between them. */
const DKIM_SELECTORS = ["selector1", "selector2"];

export async function handler(event) {
  const stop = guard(event, "GET", "GET, OPTIONS");
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.", null, "GET, OPTIONS");

  const domain = str(event.queryStringParameters?.domain, 253).toLowerCase().trim();
  if (!DOMAIN_RE.test(domain)) {
    return fail(event, 400, "That does not look like a domain name.", null, "GET, OPTIONS");
  }

  let admin;
  try { admin = adminClient(); } catch { admin = null; }
  if (admin) {
    /* Each check is four outbound lookups. Limited so a page that refreshes
       in a loop cannot turn into a resolver hammer. */
    const rl = await consume(admin, "domain-health", clientIp(event));
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds), null, "GET, OPTIONS");
  }

  try {
    const [rootTxt, dmarcTxt, mx, ...dkim] = await Promise.all([
      resolve(domain, "TXT"),
      resolve(`_dmarc.${domain}`, "TXT"),
      resolve(domain, "MX"),
      ...DKIM_SELECTORS.map((s) => resolve(`${s}._domainkey.${domain}`, "CNAME")),
    ]);

    return json(event, 200, {
      domain,
      spfTxt: rootTxt.map((a) => unquoteTxt(a.data)),
      dmarcTxt: dmarcTxt.map((a) => unquoteTxt(a.data)),
      /* An MX answer is "10 mail.example.com." — the priority and the
         trailing dot are noise to everything downstream. */
      mx: mx.map((a) => mxHost(a.data)).filter(Boolean),
      dkim: Object.fromEntries(DKIM_SELECTORS.map((s, i) => [
        s, cnameTarget(dkim[i]?.[0]?.data),
      ])),
      checkedAt: Date.now(),
    }, "GET, OPTIONS");
  } catch (err) {
    return fail(event, 502, "Could not read this domain's DNS just now. Try again in a moment.", err?.message, "GET, OPTIONS");
  }
}
