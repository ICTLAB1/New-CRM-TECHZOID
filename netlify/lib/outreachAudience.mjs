/**
 * Who a campaign may write to — the server's copy.
 *
 * THIS IS A SECOND IMPLEMENTATION OF src/domain/outreach/sending.ts, and that
 * is a liability, not a design. It exists because Netlify functions are plain
 * .mjs and the screens are TypeScript, the same split that already forced
 * portalToken.mjs to mirror src/domain/portal/token.ts.
 *
 * The liability is paid off in outreachAudience.test.mjs, which runs BOTH
 * implementations over the same table of cases and fails if they ever
 * disagree. If you change a rule here, change it there, and the test will
 * tell you if you did not. Do not "fix" a difference by editing the test.
 *
 * The rules, in the order they are applied — the order matters because a
 * person can fail several at once and the first reason is the one shown:
 *
 *   1. suppressed     — unsubscribed, complained or hard-bounced. No override.
 *   2. quarantined    — flagged at import, not yet cleared by a person.
 *   3. unverified     — the address failed verification.
 *   4. already-sent   — this campaign has written to them.
 *   5. missing-data   — the template would leave a visible hole.
 */

/** Statuses that may enter a campaign. Mirrors ELIGIBLE_STATUSES in
 *  src/domain/outreach/verify.ts. Role addresses stay eligible on purpose:
 *  procurement@ is frequently the right person to write to in this business. */
const ELIGIBLE = new Set(["Valid", "Unknown", "Role-based", "Catch-all"]);

const VARIABLE_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

const lower = (s) => String(s ?? "").trim().toLowerCase();

/** Which variables a template asks for, in order, without repeats. */
export function variablesUsed(...texts) {
  const seen = [];
  for (const text of texts) {
    for (const m of String(text ?? "").matchAll(VARIABLE_RE)) {
      if (!seen.includes(m[1])) seen.push(m[1]);
    }
  }
  return seen;
}

/**
 * Substitute, and report what could not be filled.
 *
 * A missing value is LEFT AS THE LITERAL {{variable}} rather than replaced
 * with an empty string. "Hello ," in a purchase manager's inbox says plainly
 * that this was a mail merge and nobody checked; leaving the braces visible
 * means the hole shows up in the preview and the recipient is reported.
 */
export function fill(template, values) {
  const missing = [];
  const text = String(template ?? "").replace(VARIABLE_RE, (whole, name) => {
    const value = values?.[name];
    if (typeof value !== "string" || !value.trim()) {
      /* An unknown variable — a typo — is not "missing data" about this
         person, so it is left alone here and reported for the campaign. */
      if (Object.prototype.hasOwnProperty.call(values ?? {}, name) || KNOWN_VARIABLES.has(name)) {
        if (!missing.includes(name)) missing.push(name);
      }
      return whole;
    }
    return value;
  });
  return { text, missing };
}

/** Mirrors VARIABLES in src/domain/outreach/personalise.ts. */
export const KNOWN_VARIABLES = new Set([
  "first_name", "last_name", "full_name", "job_title", "company_name",
  "company_domain", "industry", "country", "city",
  "sender_name", "sender_company", "sender_email", "sender_phone", "signature",
]);

/** Variables a template uses that this CRM cannot supply — a typo, usually. */
export const unknownVariables = (...texts) =>
  variablesUsed(...texts).filter((v) => !KNOWN_VARIABLES.has(v));

export const EXCLUSIONS = ["suppressed", "quarantined", "unverified", "already-sent", "missing-data"];

/**
 * Split a prospect list into who will be written to and who will not.
 *
 * Every candidate comes out in exactly one of the two lists, so the counts a
 * screen shows always add up.
 */
export function buildAudience({ candidates, parts, suppressed, alreadySent, allowMissing }) {
  const stop = suppressed ?? new Set();
  const already = alreadySent ?? new Set();

  const excluded = [];
  const surviving = [];

  for (const c of candidates ?? []) {
    const email = lower(c.email);

    if (!email || stop.has(email)) {
      excluded.push({ id: c.id, email: c.email, reason: "suppressed", missing: [] });
      continue;
    }
    if (c.quarantined) {
      excluded.push({ id: c.id, email: c.email, reason: "quarantined", missing: [] });
      continue;
    }
    if (!ELIGIBLE.has(c.verificationStatus ?? "Unknown")) {
      excluded.push({ id: c.id, email: c.email, reason: "unverified", missing: [] });
      continue;
    }
    if (already.has(email)) {
      excluded.push({ id: c.id, email: c.email, reason: "already-sent", missing: [] });
      continue;
    }
    surviving.push(c);
  }

  /* Personalisation is checked last, on the survivors only: telling somebody
     their industry field is blank is noise when the address is suppressed. */
  const send = [];
  for (const c of surviving) {
    const missing = [
      ...fill(parts.subject, c.values).missing,
      ...fill(parts.body, c.values).missing,
    ].filter((v, i, a) => a.indexOf(v) === i);

    if (missing.length && !allowMissing) {
      excluded.push({ id: c.id, email: c.email, reason: "missing-data", missing });
    } else {
      send.push({ id: c.id, email: c.email, values: c.values });
    }
  }

  const rank = (r) => EXCLUSIONS.indexOf(r);
  excluded.sort((a, b) => rank(a.reason) - rank(b.reason) || String(a.email).localeCompare(String(b.email)));

  return { send, excluded, unknownVariables: unknownVariables(parts.subject, parts.body) };
}

/**
 * The merge values for one prospect.
 *
 * Mirrors valuesFor in src/domain/outreach/personalise.ts. Takes a database
 * row (snake_case) rather than a mapped object, because that is what the
 * server has in its hand.
 */
export function buildValues(row, sender) {
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  return {
    first_name: first,
    last_name: last,
    full_name: String(row.full_name ?? "").trim() || [first, last].filter(Boolean).join(" "),
    job_title: String(row.job_title ?? "").trim(),
    company_name: String(row.company ?? "").trim(),
    company_domain: String(row.company_domain ?? "").trim(),
    industry: String(row.industry ?? "").trim(),
    country: String(row.country ?? "").trim(),
    city: String(row.city ?? "").trim(),
    sender_name: String(sender?.name ?? "").trim(),
    sender_company: String(sender?.company ?? "").trim(),
    sender_email: String(sender?.email ?? "").trim(),
    sender_phone: String(sender?.phone ?? "").trim(),
    signature: String(sender?.signature ?? "").trim(),
  };
}

/**
 * A polite fallback for a first name. Mirrors GREETING_FALLBACK in
 * src/domain/outreach/personalise.ts.
 *
 * NEVER applied on its own. A campaign opts into it, and both the screen and
 * this file then apply it BEFORE the rules run, so the person is not missing
 * a name rather than being excluded and then smuggled past the exclusion.
 */
export const GREETING_FALLBACK = "there";

/** Fill an absent first name, when the campaign asked for it. */
export function withGreetingFallback(values, greetUnnamed) {
  if (!greetUnnamed) return values;
  if (String(values.first_name ?? "").trim()) return values;
  return { ...values, first_name: GREETING_FALLBACK };
}

/* ── how fast, and when ────────────────────────────────────────────── */

/** The campaign's local wall clock: ISO weekday, hour, calendar date. */
export function localParts(now, timezone) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const DAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    weekday: DAYS[String(parts.weekday)] ?? 1,
    hour: Number(parts.hour),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * How many messages this campaign may send at this instant.
 *
 * Returning 0 with a reason is the common case, not a failure: a sender that
 * wakes every few minutes spends most of its life outside the window or
 * waiting out the gap.
 */
export function sendWindow({ now, schedule, sentToday, lastSentAt, batchLimit }) {
  const { weekday, hour } = localParts(now, schedule.timezone);

  if (!schedule.sendDays.includes(weekday)) return { allowed: 0, hold: "not-a-sending-day" };
  if (hour < schedule.sendFromHour || hour >= schedule.sendToHour) {
    return { allowed: 0, hold: "outside-hours" };
  }

  const remaining = schedule.dailyCap - sentToday;
  if (remaining <= 0) return { allowed: 0, hold: "daily-cap" };

  /* The gap is an allowance, not a gate — elapsed time earns sends. See the
     note in src/domain/outreach/sending.ts. */
  let earned = batchLimit;
  if (lastSentAt) {
    const waited = (now.getTime() - lastSentAt.getTime()) / 1000;
    earned = Math.floor(waited / Math.max(1, schedule.minGapSeconds));
    if (earned < 1) return { allowed: 0, hold: "too-soon" };
  }

  return { allowed: Math.max(0, Math.min(remaining, batchLimit, earned)) };
}

/** Read a campaign row's throttle into the shape sendWindow wants. */
export const scheduleOf = (campaign) => ({
  dailyCap: Number(campaign.daily_cap ?? 50),
  minGapSeconds: Number(campaign.min_gap_seconds ?? 90),
  sendFromHour: Number(campaign.send_from_hour ?? 9),
  sendToHour: Number(campaign.send_to_hour ?? 18),
  sendDays: Array.isArray(campaign.send_days) ? campaign.send_days.map(Number) : [1, 2, 3, 4, 5],
  timezone: String(campaign.timezone || "Asia/Kolkata"),
});
