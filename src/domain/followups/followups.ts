import { addDays, fmtDate, TODAY } from "../dates";

/**
 * Following up a quotation that has been sent.
 *
 * Two ways, and they are deliberately different things:
 *
 *   MANUAL — a salesperson picks a tone, reads what it says, edits it and
 *   presses send. It goes out now, from their own mailbox, and they saw it.
 *
 *   AUTOMATIC — a sequence armed when the quotation is sent, which goes out
 *   on its own days later with nobody watching. That is a message to a
 *   customer that this company did not read before it left, so everything
 *   below is built around one rule: an automatic follow-up may only ever
 *   restate what the quotation already says.
 *
 * WHAT AN AUTOMATIC FOLLOW-UP MUST NOT DO, and why each is a real risk:
 *
 *   - It must not claim a reply has not arrived. Nothing here can read a
 *     mailbox — the app has Mail.Send, not Mail.Read — so "we haven't heard
 *     back" is a guess, and it is embarrassing on the day it is wrong.
 *   - It must not invent urgency, discounts or deadlines. The only date it
 *     may name is the validity already printed on the document.
 *   - It must not outlive the quotation. A chaser arriving after validity
 *     has run out asks the customer to accept something that has expired.
 *
 * The schedule is stored as one row per step with the message already
 * written, so what is queued is exactly what was previewed. Nothing is
 * re-templated later by something that cannot be seen from the app.
 */

/** A step is a number of days after the quotation went out, and a tone. The
 *  tone is what decides the words; the days decide when. */
export interface FollowUpStep {
  afterDays: number;
  tone: FollowUpTone;
}

export type FollowUpTone = "nudge" | "check" | "final";

/**
 * Three, spread out, ending inside a 30-day validity.
 *
 * Chosen against the terms this company actually quotes: clause 1 of the
 * domestic terms makes a quotation valid for 30 days, so a fourth chaser at
 * day 21 would be pushing a document with a week left, and anything past day
 * 30 would be chasing one that has lapsed.
 */
export const DEFAULT_FOLLOWUP_STEPS: readonly FollowUpStep[] = [
  { afterDays: 3, tone: "nudge" },
  { afterDays: 7, tone: "check" },
  { afterDays: 14, tone: "final" },
];

/** Bounds on a cadence somebody types into Settings. A same-day chaser reads
 *  as a mistake; past 60 days the quotation is long dead. */
export const MIN_STEP_DAYS = 1;
export const MAX_STEP_DAYS = 60;
export const MAX_STEPS = 5;

export type FollowUpState = "scheduled" | "sent" | "failed" | "cancelled";

/**
 * How a follow-up reaches the customer.
 *
 * Email carries the words we wrote. WhatsApp carries a template approved by
 * Meta in advance, because a chaser sent days later is outside the 24-hour
 * window where free-form messages are allowed — so the row holds a template
 * name and its placeholder values instead of a message.
 */
export type FollowUpChannel = "email" | "whatsapp";

export interface FollowUp {
  id: string;
  /** Which document this chases, and who owns it. */
  docType: string;
  docId: string;
  docNumber: string;
  customerId?: string;
  customerName?: string;
  ownerId: string;
  /** 1-based, so a person reading a list sees "2 of 3" rather than "1 of 3"
   *  for the second one. */
  step: number;
  steps: number;
  tone: FollowUpTone;
  /** The date it should go out — a plain YYYY-MM-DD, because the thing being
   *  scheduled is a day's work, not an instant. */
  dueOn: string;
  state: FollowUpState;
  channel: FollowUpChannel;
  to: string;
  /** "<country code> <national number>", split when the row was queued so
   *  the sender needs no opinion about phone numbers. */
  toPhone?: string;
  templateName?: string;
  templateValues?: string[];
  cc?: string;
  replyTo?: string;
  subject: string;
  /** Both versions, written when the sequence was armed. */
  message: string;
  html?: string;
  sentAt?: string;
  /* WHAT HAPPENED TO THE MESSAGE, as opposed to what this CRM did with it.
     Kept apart from `state` deliberately: `state` drives the scheduler, and
     nothing a delivery report says may change what gets sent next. */
  deliveryState?: "sent" | "delivered" | "read" | "failed";
  deliveryDetail?: string;
  /** Why it did not go, in words a salesperson can act on. */
  error?: string;
}

/* ── planning ──────────────────────────────────────────────────────── */

/**
 * The days a sequence would land on.
 *
 * `validUntil` is a ceiling, not a suggestion: a step falling AFTER the last
 * valid day is dropped rather than moved, because moving it would make the
 * sequence say something the person arming it did not choose. Dropping can
 * leave nothing at all, and that is the honest answer — a quotation valid
 * for two days has no room to be chased.
 *
 * The last valid day itself is kept. A chaser that says "this expires today"
 * is the most useful one in the sequence, and the scheduler agrees about
 * that boundary — see stopReason, which does not call a quotation expired
 * until its validity is behind it.
 */
export function planFollowUps(
  sentOn: string,
  steps: readonly FollowUpStep[] = DEFAULT_FOLLOWUP_STEPS,
  validUntil?: string | null,
): Array<{ step: number; tone: FollowUpTone; dueOn: string }> {
  const planned = steps
    .filter((s) => Number.isFinite(s.afterDays) && s.afterDays >= MIN_STEP_DAYS)
    .slice(0, MAX_STEPS)
    .map((s) => ({ tone: s.tone, dueOn: addDays(sentOn, Math.round(s.afterDays)) }))
    .filter((s) => !validUntil || s.dueOn <= validUntil)
    /* Two steps on one day would send the customer two emails in a morning.
       Whichever was configured first wins. */
    .filter((s, i, all) => all.findIndex((o) => o.dueOn === s.dueOn) === i)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  return planned.map((s, i) => ({ ...s, step: i + 1 }));
}

/** What is due to go out, oldest first. A missed day still goes: the
 *  scheduler having been down is not a reason to skip a customer. */
export function dueFollowUps(rows: readonly FollowUp[], today: string = TODAY()): FollowUp[] {
  return rows
    .filter((r) => r.state === "scheduled" && r.dueOn <= today)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.step - b.step);
}

/** Statuses that record a DECISION about the document. Each one is a reason
 *  a chaser would be worse than silence. */
const DECIDED: Record<string, string> = {
  Accepted: "the customer accepted it",
  Rejected: "the customer turned it down",
  Expired: "it has expired",
  Cancelled: "it has been cancelled",
  Paid: "it has been paid",
};

/**
 * Statuses that mean nobody has decided anything yet.
 *
 * "Draft" IS IN THIS LIST, and that is not an oversight. Emailing a
 * quotation from this CRM does not set its status to Sent — that field is
 * set by hand, and plenty of documents are emailed and never touched again.
 * Treating Draft as a reason to stop meant a sequence armed at the moment
 * the email actually left would cancel itself the next morning, on the
 * strength of a field nobody had got round to updating. The send is the
 * better evidence, and it is the evidence we have.
 */
const UNDECIDED = new Set(["", "Draft", "Sent", "Issued"]);

/**
 * Whether a document has stopped being worth chasing.
 *
 * Validity is checked before the status and beats it: a quotation still
 * marked Sent whose last valid day is behind it has expired, whatever the
 * row says. Beyond that, only a decision stops a sequence — and a status
 * this does not recognise stops it too, because guessing wrong here means
 * emailing a customer about something already settled.
 */
export function stopReason(
  doc: { status?: string; validUntil?: string },
  today: string = TODAY(),
): string | null {
  if (doc.validUntil && doc.validUntil < today) return "it has expired";
  const status = doc.status ?? "";
  if (DECIDED[status]) return DECIDED[status];
  if (UNDECIDED.has(status)) return null;
  return `its status is now ${status}`;
}

/** A line for the person who armed it: what is still coming, and when. */
export function describeSchedule(rows: readonly FollowUp[], today: string = TODAY()): string {
  const waiting = rows.filter((r) => r.state === "scheduled");
  const sent = rows.filter((r) => r.state === "sent").length;
  if (!rows.length) return "No follow-ups scheduled.";
  if (!waiting.length) {
    return sent
      ? `${sent} follow-up${sent === 1 ? "" : "s"} sent. Nothing further scheduled.`
      : "No follow-ups scheduled.";
  }
  const next = waiting.reduce((a, b) => (a.dueOn <= b.dueOn ? a : b));
  const when = next.dueOn <= today ? "due today" : `on ${fmtDate(next.dueOn)}`;
  const tail = sent ? `, ${sent} already sent` : "";
  return `${waiting.length} follow-up${waiting.length === 1 ? "" : "s"} scheduled — next ${when}${tail}.`;
}

/* ── what each one says ────────────────────────────────────────────── */

export interface FollowUpFacts {
  /** "Quotation", "Proforma invoice". */
  label: string;
  number: string;
  /** The date printed on the document, already formatted. Deliberately the
   *  document's own date rather than the day it was emailed: that is the
   *  date the customer is looking at, and it is the one on the attachment. */
  date: string;
  /** Formatted, or null where the document carries no validity. */
  validUntil: string | null;
  /** The person being written to, where the document names one. */
  contact?: string;
  /** Who is writing. */
  senderName: string;
}

/**
 * The body of one follow-up.
 *
 * Written to be read on a phone by somebody who has a hundred other emails:
 * short, no chasing language, and every fact in it is one the customer can
 * check against the attachment they already have.
 *
 * The three tones are three different asks, not three volumes of the same
 * ask. A chaser that only says "just following up" three times gives the
 * customer nothing new to reply to.
 */
export function followUpBody(tone: FollowUpTone, f: FollowUpFacts): string {
  const greeting = f.contact ? `Dear ${f.contact},` : "";
  const validity = f.validUntil ? `It is valid until ${f.validUntil}.` : "";

  /* NOT "you haven't replied". Nothing here can see the mailbox, and a
     quotation answered by phone, or by a reply sitting in someone's inbox,
     would make that sentence false in front of a customer. */
  const middle: Record<FollowUpTone, string[]> = {
    nudge: [
      `I wanted to make sure ${f.label} ${f.number}, dated ${f.date}, reached you.`,
      validity,
      "If anything in it needs changing — quantities, specification or the commercial terms — tell me and I will send a revision.",
    ],
    check: [
      `Following up on ${f.label} ${f.number} of ${f.date}.`,
      "If it would help to go through it on a call, or you need a revised version for a different quantity or specification, I can turn that around quickly.",
      validity,
    ],
    final: [
      `A last note on ${f.label} ${f.number}, dated ${f.date}.`,
      f.validUntil
        ? `It is valid until ${f.validUntil}; after that the prices need re-confirming with the manufacturer or distributor, so tell me before then if you would like it held or re-issued.`
        : "Tell me if you would like it re-issued with current pricing.",
      "If this is not going ahead, a line saying so is genuinely useful — it means I stop chasing and you stop hearing from me.",
    ],
  };

  return [
    greeting,
    greeting ? "" : "",
    ...middle[tone].filter(Boolean).flatMap((line, i, all) => (i === all.length - 1 ? [line] : [line, ""])),
    "",
    "Best regards,",
    f.senderName,
  ]
    .filter((line, i, all) => !(line === "" && (i === 0 || all[i - 1] === "")))
    .join("\n");
}

/** The subject line. Keeps the document number in it so the follow-up
 *  threads with the original in most mail clients rather than arriving as an
 *  unrelated message. */
export function followUpSubject(tone: FollowUpTone, f: Pick<FollowUpFacts, "label" | "number">): string {
  const stem = `${f.label} ${f.number}`;
  return tone === "final" ? `${stem} — before it expires` : `Following up: ${stem}`;
}

/** How the three read in a list, so somebody choosing one knows what they
 *  are about to send. */
export const TONE_LABELS: Record<FollowUpTone, { name: string; what: string }> = {
  nudge: { name: "Gentle nudge", what: "Checks it arrived, and offers a revision." },
  check: { name: "Checking in", what: "Offers a call or a revised version." },
  final: { name: "Before it expires", what: "Names the validity date, and asks for a yes or a no." },
};

/* ── the cadence somebody configures ───────────────────────────────── */

/** Read a stored cadence, falling back to the shipped one. Anything
 *  unusable is discarded rather than guessed at — a cadence half-read is a
 *  customer emailed on a day nobody chose. */
export function readSteps(stored: unknown): readonly FollowUpStep[] {
  if (!Array.isArray(stored)) return DEFAULT_FOLLOWUP_STEPS;
  const steps = stored
    .map((row) => {
      const r = row as { afterDays?: unknown; tone?: unknown };
      const days = Math.round(Number(r.afterDays));
      const tone = r.tone === "nudge" || r.tone === "check" || r.tone === "final" ? r.tone : "check";
      return Number.isFinite(days) && days >= MIN_STEP_DAYS && days <= MAX_STEP_DAYS
        ? { afterDays: days, tone }
        : null;
    })
    .filter((s): s is FollowUpStep => s !== null)
    .sort((a, b) => a.afterDays - b.afterDays)
    .slice(0, MAX_STEPS);
  return steps.length ? steps : DEFAULT_FOLLOWUP_STEPS;
}

/**
 * Whether the workspace offers to arm a sequence when a quotation is sent.
 *
 * On unless it has been switched off, which is safe only because it is not
 * the last word: the send dialog shows the tick box and the actual dates
 * every single time, so no sequence is ever armed without the person sending
 * seeing what it will do and being able to untick it.
 */
export const autoFollowUpsOn = (settings: Record<string, unknown>): boolean =>
  settings["autoFollowUps"] !== false;
