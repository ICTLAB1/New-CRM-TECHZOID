import { isEligible } from "./verify";
import { checkReadiness, type Recipient, type ReadinessRow } from "./personalise";

/**
 * Who a campaign may write to, and how fast.
 *
 * This is the module that decides whether an email is sent at all. Everything
 * else in the outreach feature is presentation; this is the part that can put
 * the company's sending domain on a blocklist, or write to somebody who
 * explicitly asked not to be written to. It is deliberately the dullest code
 * in the feature: no cleverness, no shortcuts, and a reason attached to every
 * exclusion so a screen can say why rather than showing a smaller number than
 * the salesperson expected.
 *
 * THE RULES, IN THE ORDER THEY ARE APPLIED. The order is not cosmetic — a
 * person can fail several at once, and the first reason is the one shown, so
 * the most important reason has to come first.
 *
 *   1. SUPPRESSED. They unsubscribed, complained, or hard-bounced. There is
 *      no override, no "but this is a different campaign", and no way to
 *      express one in this API. It is first because it is the only rule with
 *      a legal edge to it.
 *   2. QUARANTINED. The import flagged them and a person has not cleared it.
 *   3. NOT ELIGIBLE. Verification says the address is invalid or disposable.
 *      Role addresses (procurement@, it@) stay eligible on purpose — in this
 *      business they are frequently the correct person to write to.
 *   4. ALREADY WRITTEN TO by this campaign. The database enforces this too
 *      (outreach_sends_once_key); this catches it earlier, where it can be
 *      explained instead of raising.
 *   5. MISSING DATA the template needs. "Hello ," is worse than not sending.
 *
 * WHAT THIS MODULE DOES NOT DO. It never sends, never touches the network,
 * and never reads the clock except through the `now` it is handed. That is
 * what makes the rules testable to the minute, and the tests are the point:
 * a throttle nobody can prove is just a comment.
 */

/* ── who is excluded, and why ──────────────────────────────────────── */

export const EXCLUSIONS = [
  "suppressed",
  "quarantined",
  "unverified",
  "already-sent",
  "missing-data",
] as const;

export type Exclusion = (typeof EXCLUSIONS)[number];

/** Shown to a salesperson, so it says what to do rather than naming a state. */
export const EXCLUSION_LABELS: Readonly<Record<Exclusion, string>> = {
  suppressed: "On the suppression list — never contact",
  quarantined: "Quarantined at import — review before sending",
  unverified: "Address failed verification",
  "already-sent": "Already written to by this campaign",
  "missing-data": "Missing details the template needs",
};

export interface Candidate {
  id: string;
  email: string;
  /** Everything the template might interpolate, already built by valuesFor. */
  values: Recipient["values"];
  quarantined?: boolean;
  verificationStatus?: string;
}

export interface Excluded {
  id: string;
  email: string;
  reason: Exclusion;
  /** For "missing-data", which fields. Empty for every other reason. */
  missing: string[];
}

export interface Audience {
  /** In the order given. The sender walks this list. */
  send: Recipient[];
  excluded: Excluded[];
  /** Variables the template uses that this CRM cannot supply — a typo,
   *  almost always. Reported once for the campaign, not per person. */
  unknownVariables: string[];
}

export interface AudienceInput {
  candidates: readonly Candidate[];
  parts: { subject: string; body: string };
  /** Lower-cased addresses. Built from outreach_suppressions. */
  suppressed?: ReadonlySet<string>;
  /** Lower-cased addresses this campaign has already queued or sent. */
  alreadySent?: ReadonlySet<string>;
  /** Send even where the template's variables cannot be filled. Off by
   *  default and surfaced in the UI as a deliberate choice, because the
   *  failure it allows is a visible hole in a stranger's inbox. */
  allowMissing?: boolean;
}

const lower = (s: string) => s.trim().toLowerCase();

/**
 * Split a prospect list into who will be written to and who will not.
 *
 * Every candidate comes out in exactly one of the two lists. That total is
 * what lets a screen say "400 imported, 372 will be sent, 28 excluded" and
 * have the arithmetic hold — a count that does not add up is how people stop
 * trusting a tool.
 */
export function buildAudience(input: AudienceInput): Audience {
  const suppressed = input.suppressed ?? new Set<string>();
  const already = input.alreadySent ?? new Set<string>();

  const excluded: Excluded[] = [];
  const surviving: Candidate[] = [];

  for (const c of input.candidates) {
    const email = lower(c.email);

    if (!email || suppressed.has(email)) {
      excluded.push({ id: c.id, email: c.email, reason: "suppressed", missing: [] });
      continue;
    }
    if (c.quarantined) {
      excluded.push({ id: c.id, email: c.email, reason: "quarantined", missing: [] });
      continue;
    }
    if (!isEligible(c.verificationStatus ?? "Unknown")) {
      excluded.push({ id: c.id, email: c.email, reason: "unverified", missing: [] });
      continue;
    }
    if (already.has(email)) {
      excluded.push({ id: c.id, email: c.email, reason: "already-sent", missing: [] });
      continue;
    }
    surviving.push(c);
  }

  /* Personalisation is checked last, on the survivors only. Telling somebody
     their industry field is blank is noise when the address is suppressed. */
  const readiness = checkReadiness(
    input.parts,
    surviving.map((c) => ({ id: c.id, email: c.email, values: c.values })),
  );

  const blockedById = new Map<string, ReadinessRow>(readiness.blocked.map((b) => [b.id, b]));

  const send: Recipient[] = input.allowMissing
    ? surviving.map((c) => ({ id: c.id, email: c.email, values: c.values }))
    : readiness.ready;

  if (!input.allowMissing) {
    for (const b of readiness.blocked) {
      excluded.push({ id: b.id, email: b.email, reason: "missing-data", missing: [...b.missing] });
    }
  }

  /* Order the exclusions the way the rules are written, so the screen groups
     naturally without having to sort by a string. */
  const rank = (r: Exclusion) => EXCLUSIONS.indexOf(r);
  excluded.sort((a, b) => rank(a.reason) - rank(b.reason) || a.email.localeCompare(b.email));

  void blockedById;
  return { send, excluded, unknownVariables: readiness.unknown };
}

/** A one-line summary for the launch screen. Counts always add up. */
export function audienceSummary(a: Audience): { total: number; sending: number; excluded: number } {
  return { total: a.send.length + a.excluded.length, sending: a.send.length, excluded: a.excluded.length };
}

/** Grouped counts, for "28 excluded" to be expandable into why. */
export function excludedByReason(a: Audience): Array<{ reason: Exclusion; label: string; count: number }> {
  return EXCLUSIONS
    .map((reason) => ({
      reason,
      label: EXCLUSION_LABELS[reason],
      count: a.excluded.filter((e) => e.reason === reason).length,
    }))
    .filter((r) => r.count > 0);
}

/* ── how fast, and when ────────────────────────────────────────────── */

export interface Schedule {
  /** Most messages in any one calendar day, in the campaign's timezone. */
  dailyCap: number;
  /** Seconds between two messages. */
  minGapSeconds: number;
  /** Inclusive start hour, exclusive end hour, local time. */
  sendFromHour: number;
  sendToHour: number;
  /** ISO weekdays: 1 = Monday .. 7 = Sunday. */
  sendDays: readonly number[];
  timezone: string;
}

export const DEFAULT_SCHEDULE: Schedule = {
  /* Fifty a day from one mailbox is unremarkable to a mail provider. Two
     hundred from a domain with no sending history is not, and the damage
     from getting that wrong lands on the quotation email this company runs
     its business on — the same mailbox, the same domain. The default is
     chosen to protect that, not to make a campaign finish quickly. */
  dailyCap: 50,
  minGapSeconds: 90,
  sendFromHour: 9,
  sendToHour: 18,
  sendDays: [1, 2, 3, 4, 5],
  timezone: "Asia/Kolkata",
};

/** The campaign's local wall clock: weekday (ISO), hour, and calendar date. */
export function localParts(now: Date, timezone: string): { weekday: number; hour: number; date: string } {
  /* Intl rather than an offset constant: India is UTC+5:30, and a campaign
     that a UAE colleague runs is not. Anything that hard-codes an offset is
     wrong twice a year somewhere. */
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
  const DAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    weekday: DAYS[String(parts.weekday)] ?? 1,
    hour: Number(parts.hour),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export type HoldReason = "outside-hours" | "not-a-sending-day" | "daily-cap" | "too-soon";

export const HOLD_LABELS: Readonly<Record<HoldReason, string>> = {
  "outside-hours": "Outside sending hours",
  "not-a-sending-day": "Not a sending day",
  "daily-cap": "Today's limit reached",
  "too-soon": "Spacing out the next message",
};

export interface SendWindow {
  /** How many may go out right now. Zero is normal, not an error. */
  allowed: number;
  /** Why it is zero. Absent when allowed > 0. */
  hold?: HoldReason;
}

/**
 * How many messages this campaign may send at this instant.
 *
 * Called at the top of every run. Returning 0 with a reason is the common
 * case — a scheduled sender that wakes every few minutes spends most of its
 * life outside the window or waiting out the gap, and that is working
 * correctly rather than failing.
 */
export function sendWindow(args: {
  now: Date;
  schedule: Schedule;
  /** How many this campaign has already sent today, campaign-local. */
  sentToday: number;
  /** When the campaign last sent anything, or null if it never has. */
  lastSentAt: Date | null;
  /** Upper bound for one run, so a run cannot outlive its time budget. */
  batchLimit: number;
}): SendWindow {
  const { weekday, hour } = localParts(args.now, args.schedule.timezone);

  if (!args.schedule.sendDays.includes(weekday)) return { allowed: 0, hold: "not-a-sending-day" };
  if (hour < args.schedule.sendFromHour || hour >= args.schedule.sendToHour) {
    return { allowed: 0, hold: "outside-hours" };
  }

  const remaining = args.schedule.dailyCap - args.sentToday;
  if (remaining <= 0) return { allowed: 0, hold: "daily-cap" };

  /* THE GAP IS AN ALLOWANCE, NOT A GATE, and that distinction was a bug.
     Treating it as a gate meant a run either sent nothing or sent its whole
     batch back to back — the spacing held between runs and not within one,
     so "90 seconds between messages" was true of the first message of a run
     and false of the rest.
     
     Elapsed time earns sends: at ninety seconds apart, five minutes of
     waiting has earned three. That paces correctly however often the sender
     happens to run, which matters because it now runs both on a schedule and
     immediately after a launch. */
  let earned = args.batchLimit;
  if (args.lastSentAt) {
    const waited = (args.now.getTime() - args.lastSentAt.getTime()) / 1000;
    earned = Math.floor(waited / Math.max(1, args.schedule.minGapSeconds));
    if (earned < 1) return { allowed: 0, hold: "too-soon" };
  }

  return { allowed: Math.max(0, Math.min(remaining, args.batchLimit, earned)) };
}

/**
 * When a campaign with this much left will finish, roughly.
 *
 * Shown before launch, because "this will take nine working days" is the
 * single most useful thing to know about a 400-person campaign and the least
 * obvious. Deliberately counts whole days only — a promise of an hour and a
 * half would be false the moment somebody pauses it.
 */
export function workingDaysNeeded(remaining: number, schedule: Schedule): number {
  const perDay = Math.max(1, Math.min(schedule.dailyCap, perHourCeiling(schedule)));
  return Math.ceil(remaining / perDay);
}

/** The cap the gap imposes, whatever the daily cap says. */
export function perHourCeiling(schedule: Schedule): number {
  const hours = Math.max(0, schedule.sendToHour - schedule.sendFromHour);
  return Math.floor((hours * 3600) / Math.max(1, schedule.minGapSeconds));
}
