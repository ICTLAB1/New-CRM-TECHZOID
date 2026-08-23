import { clientIp, fail, guard, json } from "../lib/http.mjs";
import { adminClient } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { str } from "../lib/validate.mjs";

/**
 * Branding for the public registration form.
 *
 * INTENTIONALLY UNAUTHENTICATED — anyone with a form link calls this — so it
 * returns ONLY what already appears on the company's website: name, logo,
 * tagline, website, accent colour, and the salesperson's first name. Never
 * the settings row itself, which holds bank details and the company GSTIN,
 * and never anything about a customer.
 *
 * An unknown link gets `{ valid: false }` rather than an error, so the form
 * can say "ask for a fresh link" instead of looking broken.
 */

export async function handler(event) {
  const stop = guard(event, "GET", "GET, OPTIONS");
  if (stop) return stop;

  const refId = str(event.queryStringParameters?.ref, 64);
  if (!refId) return fail(event, 400, "This link looks incomplete.", null, "GET, OPTIONS");

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "The form isn't available just now.", err?.message, "GET, OPTIONS");
  }

  const rl = await consume(admin, "public-lead-info", clientIp(event));
  if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds), null, "GET, OPTIONS");

  try {
    const [{ data: profile }, { data: settingsRow }] = await Promise.all([
      admin.from("profiles").select("id, name").eq("id", refId).maybeSingle(),
      admin.from("settings").select("data").eq("id", "main").maybeSingle(),
    ]);

    if (!profile) return json(event, 200, { valid: false }, "GET, OPTIONS");

    const s = settingsRow?.data ?? {};
    const company = s.company ?? {};
    const template = s.docTemplate ?? {};

    return json(event, 200, {
      valid: true,
      /* First name only. The form says who invited you; it isn't a staff
         directory, and a full name plus an id is the start of one. */
      repName: String(profile.name ?? "").trim().split(" ")[0] || "our team",
      company: {
        name: company.name ?? "",
        logo: s.logo ?? null,
        tagline: company.tagline ?? "",
        website: company.website ?? "",
      },
      accentColor: template.accentColor ?? "#2563EB",
    }, "GET, OPTIONS");
  } catch (err) {
    return fail(event, 500, "The form isn't available just now. Please try again in a moment.", err?.message, "GET, OPTIONS");
  }
}
