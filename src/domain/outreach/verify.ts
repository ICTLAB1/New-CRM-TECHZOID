/**
 * Deciding whether an address is safe to write to — without a provider.
 *
 * WHAT LOCAL CHECKS CAN AND CANNOT DO, because getting this wrong is how a
 * list gets trusted that should not be. These rules can RULE AN ADDRESS OUT
 * — a malformed address, a throwaway domain, a domain that cannot receive
 * mail at all. They can NEVER rule one IN: nothing short of asking the
 * receiving server can say a particular mailbox exists. So no local check
 * ever returns "Valid". The best it returns is `Unknown`, meaning nothing is
 * wrong with it and nobody has confirmed it either.
 *
 * That honesty matters downstream: a campaign that reports "842 valid" when
 * it means "842 not obviously broken" is lying to whoever presses Send.
 */

export const VERIFICATION_STATUSES = [
  "Valid", "Invalid", "Risky", "Unknown", "Disposable", "Role-based",
  "Catch-all", "Syntax Error", "Domain Invalid", "Mailbox Unreachable",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface Verdict {
  status: VerificationStatus;
  /** Written for a person: it appears under "Why was this email rejected?" */
  reason: string;
  /** May this address enter a campaign? */
  eligible: boolean;
  /** True when only a provider or an MX lookup can settle it. */
  needsProvider: boolean;
}

/* Deliberately strict but not RFC-exhaustive. The full grammar permits
   quoted local parts and bracketed IP domains, and an address using them is
   very much more likely to be a typo in a spreadsheet than a real prospect. */
/* The domain half deliberately accepts a SINGLE LABEL — "ravi@acme" gets
   through here and is caught by the explicit domain checks below, which can
   say "not a full domain name" instead of the useless "syntax error". The
   reason a rejection gives is the whole point of the quarantine screen. */
const SHAPE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

/**
 * Throwaway mailbox providers. An address here is not a prospect — it is
 * somebody who did not want to be contacted, and writing to it damages the
 * sending domain for no possible return.
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "throwawaymail.com", "yopmail.com",
  "getnada.com", "trashmail.com", "sharklasers.com", "grr.la", "spam4.me",
  "dispostable.com", "maildrop.cc", "fakeinbox.com", "mintemail.com",
  "mohmal.com", "emailondeck.com", "moakt.com", "tempr.email", "inboxkitten.com",
]);

/**
 * Addresses that reach a function rather than a person.
 *
 * NOT AUTOMATICALLY REJECTED, and that is a considered decision for this
 * business. Selling Microsoft and Autodesk licensing to companies means the
 * person who actually buys is very often behind `procurement@`, `purchase@`
 * or `it@` — those are the intended targets, not collateral. Suppressing
 * them by default would throw away the best addresses on the list.
 *
 * What they are not suitable for is anything that reads as personal. They
 * are marked Risky so a campaign can exclude them by choice, and so a
 * template that opens "Hello {{first_name}}" can warn before it goes to a
 * shared inbox.
 */
export const ROLE_LOCAL_PARTS: ReadonlySet<string> = new Set([
  "info", "sales", "support", "admin", "administrator", "contact", "enquiry",
  "enquiries", "inquiry", "help", "helpdesk", "office", "mail", "team",
  "hello", "marketing", "accounts", "accounting", "billing", "finance",
  "hr", "careers", "jobs", "recruitment", "legal", "compliance",
  "it", "sysadmin", "webmaster", "hostmaster", "postmaster", "abuse",
  "purchase", "purchasing", "procurement", "orders", "tenders",
]);

/** Never write to these, whatever else is true. They are not people, and
 *  several are addresses that mail providers watch for abuse. */
const NEVER_SEND: ReadonlySet<string> = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "bounce", "bounces",
  "mailer-daemon", "postmaster", "abuse", "spam",
]);

export const localPartOf = (email: string): string =>
  String(email ?? "").trim().toLowerCase().split("@")[0] ?? "";

export const domainOf = (email: string): string =>
  String(email ?? "").trim().toLowerCase().split("@")[1] ?? "";

export const isRoleAddress = (email: string): boolean =>
  ROLE_LOCAL_PARTS.has(localPartOf(email));

export const isDisposable = (email: string): boolean =>
  DISPOSABLE_DOMAINS.has(domainOf(email));

/**
 * Everything that can be decided without asking the network.
 *
 * Order matters: the cheapest and most certain rejections come first, so a
 * malformed address is never reported as "role-based" and a throwaway domain
 * is never reported as merely risky.
 */
export function classifyLocally(rawEmail: string): Verdict {
  const email = String(rawEmail ?? "").trim();

  if (!email) {
    return { status: "Syntax Error", reason: "No email address.", eligible: false, needsProvider: false };
  }
  if (/\s/.test(email)) {
    return { status: "Syntax Error", reason: "The address contains a space.", eligible: false, needsProvider: false };
  }
  if (!SHAPE.test(email)) {
    return {
      status: "Syntax Error",
      reason: "Not a valid email address — check for a missing @, a typo in the domain, or a stray character.",
      eligible: false, needsProvider: false,
    };
  }

  const domain = domainOf(email);
  const local = localPartOf(email);

  /* A single-label domain ("ravi@acme") passes many naive checks and can
     never receive mail from outside its own network. */
  if (!domain.includes(".")) {
    return { status: "Domain Invalid", reason: `"${domain}" is not a full domain name.`, eligible: false, needsProvider: false };
  }
  if (domain.endsWith(".") || domain.startsWith(".") || domain.includes("..")) {
    return { status: "Domain Invalid", reason: "The domain is malformed.", eligible: false, needsProvider: false };
  }
  /* A trailing label that is not a plausible TLD — "acme.i", "acme.123". */
  if (!/\.[A-Za-z]{2,}$/.test(domain)) {
    return { status: "Domain Invalid", reason: `"${domain}" does not end in a valid domain suffix.`, eligible: false, needsProvider: false };
  }

  if (NEVER_SEND.has(local)) {
    return {
      status: "Invalid",
      reason: `"${local}@" is an automated address that nobody reads. Sending to it can harm your sending reputation.`,
      eligible: false, needsProvider: false,
    };
  }

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      status: "Disposable",
      reason: `${domain} is a throwaway mailbox provider. Mail to it will not reach a person.`,
      eligible: false, needsProvider: false,
    };
  }

  if (ROLE_LOCAL_PARTS.has(local)) {
    return {
      status: "Role-based",
      reason: `"${local}@" reaches a shared inbox rather than a named person. Often the right contact for licensing — but personal greetings will read oddly.`,
      /* ELIGIBLE ON PURPOSE. See the note on ROLE_LOCAL_PARTS: for licensing
         procurement these are frequently the buyer. */
      eligible: true, needsProvider: false,
    };
  }

  /* Nothing is wrong with it, and nothing has confirmed it either. */
  return {
    status: "Unknown",
    reason: "Nothing wrong with the address. Whether the mailbox exists has not been confirmed.",
    eligible: true, needsProvider: true,
  };
}

/** What an MX lookup adds, once a function has done it. Separate from the
 *  syntax pass so the network result can arrive later without re-deciding
 *  anything already settled. */
export function applyMxResult(verdict: Verdict, hasMx: boolean): Verdict {
  if (!verdict.needsProvider && verdict.status !== "Role-based") return verdict;
  if (hasMx) return verdict;
  return {
    status: "Domain Invalid",
    reason: "The domain does not accept mail — it has no mail server configured.",
    eligible: false,
    needsProvider: false,
  };
}

/** Which statuses may enter a campaign, for filtering a list. */
export const ELIGIBLE_STATUSES: ReadonlySet<VerificationStatus> =
  new Set<VerificationStatus>(["Valid", "Unknown", "Role-based", "Catch-all"]);

export const isEligible = (status: string): boolean =>
  ELIGIBLE_STATUSES.has(status as VerificationStatus);
