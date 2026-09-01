/**
 * Reading a sending domain's DNS and saying whether it is fit to send from.
 *
 * WHAT THIS IS NOT. It cannot promise anything about the inbox. No check
 * here, and nothing anywhere, makes mail "not go to spam" — placement is
 * decided by the receiving provider using signals nobody outside it can see.
 * What these records do is let a receiver verify the mail is genuinely from
 * you. Failing them is a reliable way to be filtered; passing them is a
 * precondition, not a guarantee, and the wording throughout says so.
 *
 * Pure functions over DNS answers. The lookups themselves happen in
 * netlify/functions/domain-health.mjs — a browser cannot resolve TXT records,
 * and doing it server-side keeps one place responsible for rate limiting.
 */

export type Grade = "pass" | "warn" | "fail" | "unknown";

export interface Check {
  grade: Grade;
  /** One line, written for whoever has to fix it. */
  summary: string;
  /** What to do about it. Empty when there is nothing to do. */
  action: string;
  /** The record as found, for an admin who wants to see it. */
  found: string;
}

const NOTHING_FOUND = "No record found.";

/* ── SPF ───────────────────────────────────────────────────────────────
   Says which servers may send as this domain. */
export function gradeSpf(txtRecords: readonly string[]): Check {
  const spf = txtRecords.map((r) => r.trim()).filter((r) => /^v=spf1\b/i.test(r));

  if (spf.length === 0) {
    return {
      grade: "fail", found: NOTHING_FOUND,
      summary: "No SPF record.",
      action: "Publish a TXT record at the domain root beginning v=spf1. For Microsoft 365 it usually reads: v=spf1 include:spf.protection.outlook.com -all",
    };
  }
  /* MORE THAN ONE IS WORSE THAN NONE. RFC 7208 says a domain publishing two
     SPF records is a permanent error, and receivers treat the whole check as
     failed — so a second record added "to add another sender" silently
     breaks the first. */
  if (spf.length > 1) {
    return {
      grade: "fail", found: spf.join("  |  "),
      summary: `${spf.length} SPF records. A domain may publish only one.`,
      action: "Merge them into a single record. Two SPF records is a permanent error and receivers fail the check outright.",
    };
  }

  const record = spf[0]!;
  const all = /([-~?+])all\s*$/i.exec(record)?.[1];

  if (all === "-") {
    return { grade: "pass", found: record, summary: "SPF published, strict (-all).", action: "" };
  }
  if (all === "~") {
    return {
      grade: "pass", found: record,
      summary: "SPF published, soft fail (~all).",
      action: "Fine for most senders. -all is stricter once you are sure every sending service is listed.",
    };
  }
  if (all === "?" || all === "+") {
    return {
      grade: "warn", found: record,
      summary: `SPF ends in ${all}all, which permits anyone to send as this domain.`,
      action: "Change the ending to ~all, or -all once every legitimate sender is listed.",
    };
  }
  return {
    grade: "warn", found: record,
    summary: "SPF record has no all mechanism, so it says nothing about unlisted senders.",
    action: "Add ~all or -all to the end of the record.",
  };
}

/* ── DKIM ──────────────────────────────────────────────────────────────
   Signs the mail so a receiver can verify it was not altered and did come
   from this domain. Microsoft 365 publishes two selectors as CNAMEs and
   rotates between them — both must exist. */
export function gradeDkim(selectors: Readonly<Record<string, string | null>>): Check {
  const present = Object.entries(selectors).filter(([, v]) => !!v);
  const missing = Object.entries(selectors).filter(([, v]) => !v).map(([k]) => k);

  if (present.length === 0) {
    return {
      grade: "fail", found: NOTHING_FOUND,
      summary: "No DKIM selector found — outgoing mail is not signed.",
      action: "In the Microsoft 365 Defender portal, enable DKIM for this domain, then publish the two CNAME records it gives you (selector1 and selector2).",
    };
  }
  if (missing.length > 0) {
    return {
      grade: "warn", found: present.map(([k, v]) => `${k} → ${v}`).join("  |  "),
      summary: `DKIM is partly published — ${missing.join(", ")} missing.`,
      /* Not cosmetic: Microsoft alternates selectors when rotating keys, so
         mail signed with the missing one fails verification outright. */
      action: "Publish the missing selector. Microsoft rotates between the two, so mail signed with the missing one will fail verification.",
    };
  }
  return {
    grade: "pass", found: present.map(([k, v]) => `${k} → ${v}`).join("  |  "),
    summary: "DKIM published for both selectors.", action: "",
  };
}

/* ── DMARC ─────────────────────────────────────────────────────────────
   Tells receivers what to do when SPF and DKIM fail, and where to report. */
export function gradeDmarc(txtRecords: readonly string[]): Check {
  const rec = txtRecords.map((r) => r.trim()).find((r) => /^v=DMARC1\b/i.test(r));

  if (!rec) {
    return {
      grade: "fail", found: NOTHING_FOUND,
      summary: "No DMARC record.",
      action: "Publish a TXT record at _dmarc.<domain>. Start with: v=DMARC1; p=none; rua=mailto:dmarc@<domain> — that reports without affecting delivery.",
    };
  }

  const policy = (/\bp\s*=\s*([a-z]+)/i.exec(rec)?.[1] ?? "").toLowerCase();
  const hasReporting = /\brua\s*=/i.test(rec);

  if (policy === "reject") {
    return { grade: "pass", found: rec, summary: "DMARC published, policy reject — the strongest setting.", action: hasReporting ? "" : "Consider adding rua= so you receive the reports." };
  }
  if (policy === "quarantine") {
    return { grade: "pass", found: rec, summary: "DMARC published, policy quarantine.", action: hasReporting ? "" : "Consider adding rua= so you receive the reports." };
  }
  if (policy === "none") {
    return {
      grade: "warn", found: rec,
      summary: "DMARC is in monitoring mode (p=none), so it protects nothing yet.",
      /* Deliberately not graded fail. p=none is the correct FIRST step and
         moving straight to reject without reading reports is how a company
         blocks its own invoices. */
      action: "This is the right place to start. Read the reports for a few weeks, then move to p=quarantine.",
    };
  }
  return {
    grade: "warn", found: rec,
    summary: `DMARC record has an unrecognised policy${policy ? ` (p=${policy})` : ""}.`,
    action: "The p= value should be none, quarantine or reject.",
  };
}

/* ── MX ────────────────────────────────────────────────────────────────
   Not about sending — about whether a reply can come back. */
export function gradeMx(hosts: readonly string[]): Check {
  if (hosts.length === 0) {
    return {
      grade: "fail", found: NOTHING_FOUND,
      summary: "No MX record — this domain cannot receive mail.",
      action: "Nobody can reply to anything sent from here. Publish MX records before using it as a sender.",
    };
  }
  return { grade: "pass", found: hosts.join(", "), summary: `${hosts.length} mail server${hosts.length === 1 ? "" : "s"} configured.`, action: "" };
}

export interface DomainHealth {
  domain: string;
  spf: Check; dkim: Check; dmarc: Check; mx: Check;
  /** The worst of the four — what the badge shows. */
  overall: Grade;
  /** Whether this domain should be used for outreach at all. */
  safeToSend: boolean;
  checkedAt: number;
}

const WORST: Grade[] = ["fail", "warn", "unknown", "pass"];

export function overallGrade(checks: readonly Check[]): Grade {
  for (const g of WORST) if (checks.some((c) => c.grade === g)) return g;
  return "unknown";
}

/**
 * Whether to let a campaign run from this domain.
 *
 * A FAIL on SPF, DKIM or MX blocks it. Not to be officious: sending
 * unauthenticated mail in volume is the fastest way to get a domain
 * filtered, and the damage lands on every ordinary quotation the company
 * sends afterwards, not only on the campaign. DMARC failing alone does not
 * block — a domain with good SPF and DKIM and no DMARC still authenticates.
 */
export function safeToSend(h: { spf: Check; dkim: Check; mx: Check }): boolean {
  return h.spf.grade !== "fail" && h.dkim.grade !== "fail" && h.mx.grade !== "fail";
}

export function buildHealth(
  domain: string,
  input: { spfTxt: string[]; dkim: Record<string, string | null>; dmarcTxt: string[]; mx: string[] },
  now = Date.now(),
): DomainHealth {
  const spf = gradeSpf(input.spfTxt);
  const dkim = gradeDkim(input.dkim);
  const dmarc = gradeDmarc(input.dmarcTxt);
  const mx = gradeMx(input.mx);
  return {
    domain, spf, dkim, dmarc, mx,
    overall: overallGrade([spf, dkim, dmarc, mx]),
    safeToSend: safeToSend({ spf, dkim, mx }),
    checkedAt: now,
  };
}
