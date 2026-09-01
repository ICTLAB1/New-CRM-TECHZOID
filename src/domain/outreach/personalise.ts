/**
 * Putting a prospect's details into a template.
 *
 * THE RULE THAT MATTERS MOST: a template must never send with a hole in it.
 * "Hello ," or "I see {{company_name}} is growing" arriving in a purchase
 * manager's inbox does more damage than not writing at all — it says
 * plainly that this was a mail merge and that nobody checked. So every
 * variable a template uses is resolved BEFORE the campaign is allowed to
 * run, and any prospect missing one is reported by name rather than sent to
 * with a gap.
 *
 * Substitution is deliberately not a template engine. No conditionals, no
 * loops, no expressions — just named values. Anything cleverer becomes a way
 * to put logic in a string that nobody tests.
 */

export const VARIABLES = [
  "first_name", "last_name", "full_name", "job_title",
  "company_name", "company_domain", "industry", "country", "city",
  "sender_name", "sender_company", "sender_email", "sender_phone", "sender_signature",
] as const;
export type VariableName = (typeof VARIABLES)[number];

export const VARIABLE_LABELS: Readonly<Record<VariableName, string>> = {
  first_name: "First name", last_name: "Last name", full_name: "Full name",
  job_title: "Job title", company_name: "Company", company_domain: "Company domain",
  industry: "Industry", country: "Country", city: "City",
  sender_name: "Your name", sender_company: "Your company", sender_email: "Your email",
  sender_phone: "Your phone", sender_signature: "Your signature",
};

/** Which variables are about the PROSPECT — the ones that can be missing.
 *  Sender fields come from settings and the mailbox, so they are the
 *  company's problem to fill in once, not a per-recipient risk. */
export const PROSPECT_VARIABLES: ReadonlySet<VariableName> = new Set<VariableName>([
  "first_name", "last_name", "full_name", "job_title",
  "company_name", "company_domain", "industry", "country", "city",
]);

/* Tolerates the spacing people actually type: {{first_name}}, {{ first_name }}. */
const TOKEN = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

/** Every variable a piece of text refers to, in the order first seen. */
export function variablesUsed(...texts: (string | undefined)[]): VariableName[] {
  const seen: VariableName[] = [];
  for (const text of texts) {
    for (const m of String(text ?? "").matchAll(TOKEN)) {
      const name = m[1]!.toLowerCase() as VariableName;
      if (!seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

/** Variables a template uses that this system does not know about — a typo
 *  like {{fisrt_name}}, which would otherwise ship as literal text. */
export const unknownVariables = (...texts: (string | undefined)[]): string[] =>
  variablesUsed(...texts).filter((v) => !(VARIABLES as readonly string[]).includes(v));

export type Values = Partial<Record<VariableName, string>>;

export interface Filled {
  text: string;
  /** Variables the template wanted and the data did not have. */
  missing: VariableName[];
}

/**
 * Substitute, and report what was missing rather than papering over it.
 *
 * An unknown variable is left EXACTLY as written. Replacing it with an empty
 * string would hide a typo and quietly ship a sentence with a hole in it;
 * leaving `{{fisrt_name}}` visible in the preview is how somebody notices.
 */
export function fill(template: string, values: Values): Filled {
  const missing: VariableName[] = [];
  const text = String(template ?? "").replace(TOKEN, (whole, rawName: string) => {
    const name = rawName.toLowerCase() as VariableName;
    if (!(VARIABLES as readonly string[]).includes(name)) return whole;
    const value = (values[name] ?? "").trim();
    if (!value) {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    return value;
  });
  return { text, missing };
}

export interface Recipient {
  id: string;
  email: string;
  values: Values;
}

export interface ReadinessRow {
  id: string;
  email: string;
  missing: VariableName[];
}

export interface Readiness {
  ready: Recipient[];
  /** Named, so the screen can list who and why — never a bare count. */
  blocked: ReadinessRow[];
  unknown: string[];
}

/**
 * Who this campaign can actually be sent to.
 *
 * §14 wants the real eligible number before anything goes out. This produces
 * it, and the blocked list carries the missing field per person so somebody
 * can fix the data instead of guessing which rows are wrong.
 */
export function checkReadiness(
  parts: { subject: string; body: string },
  recipients: readonly Recipient[],
): Readiness {
  const unknown = unknownVariables(parts.subject, parts.body);
  const ready: Recipient[] = [];
  const blocked: ReadinessRow[] = [];

  for (const r of recipients) {
    const missing = [
      ...fill(parts.subject, r.values).missing,
      ...fill(parts.body, r.values).missing,
    ].filter((v, i, a) => a.indexOf(v) === i);

    if (missing.length) blocked.push({ id: r.id, email: r.email, missing });
    else ready.push(r);
  }
  return { ready, blocked, unknown };
}

/**
 * A polite fallback for a first name.
 *
 * NOT applied automatically. Silently turning a missing name into "there"
 * would defeat the readiness check above, and a campaign that quietly
 * degrades is one nobody audits. It is offered in the UI as a deliberate
 * choice, per campaign.
 */
export const GREETING_FALLBACK = "there";

/** Fill the whole message at once, for the preview and for sending. */
export function fillMessage(
  parts: { subject: string; body: string },
  values: Values,
): { subject: string; body: string; missing: VariableName[] } {
  const s = fill(parts.subject, values);
  const b = fill(parts.body, values);
  return {
    subject: s.text,
    body: b.text,
    missing: [...s.missing, ...b.missing].filter((v, i, a) => a.indexOf(v) === i),
  };
}

/** Build the values for one prospect. Sender fields are the same for every
 *  recipient in a campaign; prospect fields vary. */
export function valuesFor(
  prospect: {
    firstName?: string; lastName?: string; fullName?: string; jobTitle?: string;
    company?: string; companyDomain?: string; industry?: string; country?: string; city?: string;
  },
  sender: { name?: string; company?: string; email?: string; phone?: string; signature?: string },
): Values {
  const first = (prospect.firstName ?? "").trim();
  const last = (prospect.lastName ?? "").trim();
  return {
    first_name: first,
    last_name: last,
    full_name: (prospect.fullName ?? "").trim() || [first, last].filter(Boolean).join(" "),
    job_title: (prospect.jobTitle ?? "").trim(),
    company_name: (prospect.company ?? "").trim(),
    company_domain: (prospect.companyDomain ?? "").trim(),
    industry: (prospect.industry ?? "").trim(),
    country: (prospect.country ?? "").trim(),
    city: (prospect.city ?? "").trim(),
    sender_name: (sender.name ?? "").trim(),
    sender_company: (sender.company ?? "").trim(),
    sender_email: (sender.email ?? "").trim(),
    sender_phone: (sender.phone ?? "").trim(),
    sender_signature: (sender.signature ?? "").trim(),
  };
}
