import { normalisePhone } from "./phone";
import type { FollowUpTone } from "../followups/followups";

/**
 * WhatsApp follow-ups through Interakt's WhatsApp Business Cloud API.
 *
 * WHY TEMPLATES AND NOT PLAIN TEXT. A follow-up goes out days after the last
 * contact, which puts it outside Meta's 24-hour customer-service window. Out
 * there a business may only send a template it has submitted and had
 * approved in advance. That is not Interakt's rule, it is Meta's, and there
 * is no way around it — a free-form message sent to a cold thread is simply
 * refused.
 *
 * So this file is small on purpose: it decides WHICH approved template to
 * use and WHAT to put in its placeholders. The words themselves live in
 * Meta's template library, not here, and cannot be changed by a deploy.
 *
 * THE MANUAL WHATSAPP BUTTON IS UNAFFECTED. That sends free-form text
 * through the existing provider, from a person who is looking at the screen,
 * usually inside the 24-hour window. Automation is the part that has to be
 * on the compliant path.
 */

/**
 * Every template takes the same three placeholders, and that is a decision.
 *
 * Meta approves each template separately and rejects a send whose variable
 * count does not match, so three templates with three different shapes is
 * three ways to be broken on a Sunday. One shape means one thing to get
 * right, and the settings screen only has to collect three names.
 *
 *   {{1}}  who is being written to
 *   {{2}}  the quotation number
 *   {{3}}  a date — the validity where the message is about running out,
 *          otherwise the date on the document
 */
export interface TemplateSend {
  templateName: string;
  bodyValues: [string, string, string];
}

/** Which stored setting holds each tone's approved template name. */
export const TEMPLATE_SETTING: Record<FollowUpTone, string> = {
  nudge: "waTemplateNudge",
  check: "waTemplateCheck",
  final: "waTemplateFinal",
};

/** What to call them if nobody has entered anything. These are only
 *  suggestions for the names to register with Meta — a template that does
 *  not exist under this exact name is refused at send time. */
export const DEFAULT_TEMPLATE_NAMES: Record<FollowUpTone, string> = {
  nudge: "quotation_followup_nudge",
  check: "quotation_followup_check",
  final: "quotation_followup_final",
};

export interface TemplateFacts {
  /** The person, then the company, then nothing — see `addressee`. */
  contact?: string;
  company?: string;
  number: string;
  /** Formatted for reading. */
  date: string;
  /** Formatted, or null where the document carries no validity. */
  validUntil: string | null;
}

/**
 * A placeholder may never be empty.
 *
 * Meta refuses a send whose variable is blank, so "Dear ," is not the
 * failure mode here — a message that never arrives is. The company name
 * stands in for a missing contact, and "there" for a customer we know
 * nothing about, which reads as an ordinary greeting rather than as a gap.
 */
export function addressee(facts: Pick<TemplateFacts, "contact" | "company">): string {
  return (facts.contact ?? "").trim() || (facts.company ?? "").trim() || "there";
}

/**
 * The template to send for one follow-up.
 *
 * The "final" tone is the one that names an expiry date. A quotation with no
 * validity has no expiry to name, so it falls back to the "check" template
 * rather than sending a message with a date invented for it.
 */
export function templateFor(
  tone: FollowUpTone,
  facts: TemplateFacts,
  names: Partial<Record<FollowUpTone, string>> = {},
): TemplateSend {
  const useTone: FollowUpTone = tone === "final" && !facts.validUntil ? "check" : tone;
  const date = useTone === "final" ? (facts.validUntil ?? facts.date) : facts.date;
  return {
    templateName: (names[useTone] ?? "").trim() || DEFAULT_TEMPLATE_NAMES[useTone],
    bodyValues: [addressee(facts), facts.number, date],
  };
}

/**
 * Interakt wants the country code and the national number apart, which is
 * not how anybody types a phone number into a CRM.
 *
 * Splitting it wrongly does not fail loudly — it sends somebody else's
 * message to a real stranger — so the rule is narrow: known country codes
 * are matched longest-first, and anything unrecognised is refused rather
 * than guessed at.
 */
const COUNTRY_CODES = ["971", "977", "880", "94", "91", "92", "65", "60", "44", "1"];

export function splitNumber(
  raw: string | null | undefined,
  defaultCountryCode = "91",
): { countryCode: string; phoneNumber: string } | null {
  const digits = normalisePhone(raw, defaultCountryCode);

  /* SOMEBODY WHO TYPED A + HAS ALREADY TOLD US THE COUNTRY. The list below
     exists to GUESS a country for a bare ten-digit number, which is the
     common case in an Indian office. It was also being used as the set of
     countries the CRM would accept at all — so a perfectly good Nigerian
     number, typed in full as +234…, was reported as something that could
     not be read. Thirteen of them at once, in a paste that was entirely
     valid.

     An explicitly international number is accepted whatever its country,
     and the few digits of its country code are not split out, because
     doing that needs a table of every country's code and getting it wrong
     silently moves a digit from the country to the number. The server
     normalises on digits alone and never needed the split. */
  const explicit = String(raw ?? "").trim().startsWith("+");
  const plausible = /^\d{10,15}$/.test(digits) || (explicit && /^\d{8,15}$/.test(digits));
  if (!plausible) return null;

  for (const code of COUNTRY_CODES) {
    if (!digits.startsWith(code)) continue;
    const rest = digits.slice(code.length);
    /* A national number is never shorter than six digits; a "match" that
       leaves three is the country code being read out of the middle of
       somebody's number. */
    if (rest.length < 6) continue;
    return { countryCode: "+" + code, phoneNumber: rest };
  }

  /* Known to be international, country not one this list splits. An empty
     `countryCode` says exactly that — see `formatNumber`, which is how it
     should be shown. */
  if (explicit) return { countryCode: "", phoneNumber: digits };

  return null;
}

/**
 * A split number as a person should read it.
 *
 * WHY A FUNCTION AND NOT A TEMPLATE STRING AT EACH SITE. With the country
 * code split out it is "+91 9810012345"; without, the whole thing is the
 * number and the plus belongs in front of it. Four screens were building
 * this by hand, and every one of them would have printed a leading space
 * and no plus — " 2348032034059" — the first time a number arrived from a
 * country the list does not split.
 */
export const formatNumber = (
  split: { countryCode: string; phoneNumber: string } | null,
): string => {
  if (!split) return "";
  return split.countryCode ? `${split.countryCode} ${split.phoneNumber}` : `+${split.phoneNumber}`;
};

/**
 * The number a WhatsApp message to this customer would actually go to.
 *
 * THEIR WHATSAPP FIELD FIRST, their ordinary phone when that is blank —
 * which is the rule the server already followed, in whatsappConsent.mjs.
 * This did not: it read `phone` alone, so a customer who had given a
 * separate WhatsApp number and no landline showed on screen as having no
 * WhatsApp at all, while the server would have messaged them perfectly
 * well. One screen saying "no number" about somebody the sender can see is
 * reachable is the kind of disagreement nobody reports as a bug; they just
 * stop trusting the screen.
 */
export const whatsAppNumberOf = (
  customer: { phone?: string; whatsappPhone?: string },
): { countryCode: string; phoneNumber: string } | null =>
  splitNumber(customer.whatsappPhone) ?? splitNumber(customer.phone);

/** Whether this customer may be messaged at all. Meta requires opt-in
 *  before a business writes first, and an unticked box is not consent. */
export const mayWhatsApp = (
  customer: { whatsappOptIn?: boolean; phone?: string; whatsappPhone?: string },
): boolean => customer.whatsappOptIn === true && !!whatsAppNumberOf(customer);
