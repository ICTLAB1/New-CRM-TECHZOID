import { formatNumber, mayWhatsApp, splitNumber, whatsAppNumberOf } from "../integrations/interakt";
import { splitFragments } from "./paste";

/**
 * Who a WhatsApp broadcast may go to, and who it may not — with the reason.
 *
 * NOBODY IS DROPPED SILENTLY, which is the whole point of returning two
 * lists instead of one. A sender who ticks two hundred customers and sees
 * "sending to 94" with no explanation assumes the CRM is broken. A sender
 * who sees "94 going, 106 have not agreed to WhatsApp, 12 have no number"
 * knows exactly what to do about it, and the ones who have not agreed are
 * a list worth having: it is the work that makes the next broadcast
 * bigger.
 *
 * THE TWO REASONS ARE NOT THE SAME PROBLEM. A missing number is a data
 * entry job somebody can do this afternoon. Missing consent is a
 * conversation with the customer, and no amount of work in the CRM fixes
 * it — which is why they are counted apart rather than lumped into one
 * "cannot be messaged" figure.
 *
 * CONSENT IS META'S RULE, NOT A PREFERENCE. A business may not write first
 * to somebody who has not opted in. The server refuses them whatever this
 * returns, so including them here would only mean a list of failures
 * arriving after the send instead of a clear exclusion before it.
 */

export interface AudienceCustomer {
  id: string;
  company?: string;
  contact?: string;
  phone?: string;
  whatsappPhone?: string;
  whatsappOptIn?: boolean;
}

export interface WhatsAppRecipient {
  id: string;
  /** What to call them on screen: the person if we have one, else the firm. */
  label: string;
  /** The number the message will actually go to, as it will be dialled. */
  number: string;
}

export interface WhatsAppExclusion {
  id: string;
  label: string;
  /** `no-consent` is a conversation with the customer; `no-number` is a
   *  field somebody can fill in this afternoon. */
  reason: "no-consent" | "no-number";
}

export interface WhatsAppAudience {
  recipients: WhatsAppRecipient[];
  excluded: WhatsAppExclusion[];
}

const labelOf = (c: AudienceCustomer): string =>
  String(c.contact ?? "").trim() || String(c.company ?? "").trim() || "(no name)";

export function whatsappAudience(customers: readonly AudienceCustomer[]): WhatsAppAudience {
  const recipients: WhatsAppRecipient[] = [];
  const excluded: WhatsAppExclusion[] = [];

  for (const c of customers ?? []) {
    if (!c?.id) continue;
    const label = labelOf(c);
    const number = whatsAppNumberOf(c);

    /* CONSENT IS ASKED ABOUT FIRST, and the order matters for what the
       sender is told. Somebody who never agreed is not a missing-number
       problem even when their number is also missing: filling it in would
       change nothing, and a list that sent them to the wrong queue would
       have somebody chasing phone numbers for people who must not be
       messaged anyway. */
    if (c.whatsappOptIn !== true) {
      excluded.push({ id: c.id, label, reason: "no-consent" });
      continue;
    }
    if (!number) {
      excluded.push({ id: c.id, label, reason: "no-number" });
      continue;
    }

    recipients.push({ id: c.id, label, number: formatNumber(number) });
  }

  return { recipients, excluded };
}

/** How the two exclusions read on screen, counted separately. */
export function audienceSummary(audience: WhatsAppAudience): string {
  const noConsent = audience.excluded.filter((e) => e.reason === "no-consent").length;
  const noNumber = audience.excluded.filter((e) => e.reason === "no-number").length;
  const parts = [`${audience.recipients.length} will be messaged`];
  if (noConsent) parts.push(`${noConsent} ${noConsent === 1 ? "has" : "have"} not agreed to WhatsApp`);
  if (noNumber) parts.push(`${noNumber} ${noNumber === 1 ? "has" : "have"} no number on file`);
  return `${parts.join(", ")}.`;
}

/** The guard the screen uses: `mayWhatsApp` by another name, re-exported so
 *  a caller does not have to know which integration file it lives in. */
export const canBeMessaged = mayWhatsApp;


/* ── a list somebody pasted ────────────────────────────────────────── */

export interface PastedNumber {
  /** What to call them, when the paste offered a name. */
  label: string;
  /** As it will be dialled: "+91 9810012345". */
  number: string;
}

export interface PastedNumbers {
  numbers: PastedNumber[];
  /** Lines that held no usable number. Shown, never swallowed. */
  unreadable: string[];
  /** Numbers that appeared more than once. Counted, not repeated. */
  duplicates: string[];
}

/**
 * Read a pasted list of phone numbers, with names where they were offered.
 *
 * THE SAME RULE AS THE EMAIL PASTE, and the same splitter: a line is a
 * record. Tab, comma, semicolon and pipe separate columns within a line;
 * the line break separates people. That is what makes
 * "Anoop Samdani⇥9810012345" one contact rather than a number and an
 * orphaned name, which is the exact fault the email paste had and which
 * took a morning to find.
 *
 * WHAT IT WILL NOT DO IS INVENT CONSENT. A pasted number has no record in
 * the CRM and therefore no opt-in on file, so nothing here marks one as
 * agreed. The screen asks the sender to say so, and records who said it —
 * see the note on the broadcast endpoint. Meta does not check opt-in when
 * a message is sent; the recipients enforce it, by blocking, and the cost
 * lands on the one number the company has.
 */
export function readPastedNumbers(text: string): PastedNumbers {
  const numbers: PastedNumber[] = [];
  const unreadable: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const fragment of splitFragments(text)) {
    /* EVERY number on the line, not the first one. `splitFragments` keeps a
       line whole when it holds no email address, which is every line here —
       so "9810012345, 9820099887" arrives as one fragment and taking a
       single match would drop the second person without a word. That is the
       same silent loss the email paste was reported for, and the reason this
       list reports what it could not read at all. */
    const found = [...fragment.matchAll(/\+?[0-9][0-9()\s.\-]{7,}[0-9]/g)];
    const usable = found
      .map((m) => ({ raw: m[0], split: splitNumber(m[0]) }))
      .filter((f) => f.split);

    if (!usable.length) {
      if (/[a-z0-9]/i.test(fragment)) unreadable.push(fragment.slice(0, 120));
      continue;
    }

    /* A NAME ONLY WHERE IT CAN BE THE RIGHT ONE. One number on the line
       means whatever else is there belongs to that person. Several numbers
       mean the leftover text cannot be attributed to any of them — "Anoop
       and Davinder, 98100…, 98200…" would greet both of them as Anoop — so
       the name is left off rather than guessed at. */
    const nameable = usable.length === 1;
    let label = "";
    if (nameable) {
      label = fragment
        .replace(usable[0]!.raw, "")
        .replace(/[<>"\'|]/g, "")
        .replace(/^[\s\-–—*•.)]+/, "")
        .replace(/[\s,;:]+$/, "")
        .trim();
    }

    for (const { split } of usable) {
      const number = formatNumber(split);
      if (seen.has(number)) {
        duplicates.push(number);
        continue;
      }
      seen.add(number);
      numbers.push({ label, number });
    }
  }

  return { numbers, unreadable, duplicates };
}
