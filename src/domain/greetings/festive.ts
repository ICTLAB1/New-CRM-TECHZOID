/**
 * Festival greetings on a customer-facing email.
 *
 * WHY THIS IS A TABLE AND NOT AN `if`. A greeting is wrong the day after
 * the festival — "Happy Diwali" on a quotation in December reads as a
 * company that does not look at what it sends. So a greeting is declared
 * with the dates it is alive, and it stops on its own. Nobody has to
 * remember to take it out, and nothing has to be deployed on the 11th.
 *
 * WHY IT IS BY COUNTRY. Diwali is not a neutral pleasantry to send a
 * supplier in Hamburg. Each greeting names the countries it belongs to and
 * reaches nobody else.
 *
 * THE SENDER ALWAYS DECIDES. This answers "is there a greeting for this
 * customer today"; whether it actually goes is the agent's to say on the
 * send dialog, because the one case nobody can encode is the customer who
 * has just had bad news.
 */

export interface FestiveGreeting {
  id: string;
  /** Names the greeting on the opt-out, e.g. "Diwali greetings". */
  name: string;
  /** The bold line. */
  headline: string;
  /** The sentence under it. */
  line: string;
  /** Inclusive, both ends, as ISO dates. */
  from: string;
  until: string;
  /** Countries this belongs to, as the CRM spells them. */
  countries: string[];
  /** The artwork, served from this app's own public/ folder. Absent means
   *  the greeting goes as words. */
  banner?: {
    /** Path under the site root, no leading slash. */
    path: string;
    /** As drawn, so the markup can reserve the right shape. */
    width: number;
    height: number;
    /** THE WORDS ON THE ARTWORK, for the alt attribute and for the
     *  plain-text email. Outlook blocks images until the reader asks for
     *  them, and a text email has no images at all, so a banner with no
     *  words behind it is a greeting that silently does not happen. */
    alt: string;
    /** True when the artwork claims the document is attached, as this one
     *  does — "Festive Quotation Attached". Then it may only be used on an
     *  email that really has the attachment. */
    claimsAttachment?: boolean;
  };
}

/**
 * Diwali 2026 falls on 8 November. The window runs to the 10th, as asked:
 * greetings sent in the days around it are ordinary, and one sent on the
 * 11th is late.
 */
export const DIWALI_2026: FestiveGreeting = {
  id: "diwali-2026",
  name: "Diwali greetings",
  /* The words on the artwork, so the alt text, the plain-text email and the
     banner itself all say the same thing. A reader with images turned off
     must get the same greeting as one with them on. */
  headline: "Happy Diwali",
  line: "May this Festival of Lights bring success, prosperity and new opportunities.",
  from: "2026-10-01",
  until: "2026-11-10",
  countries: ["India"],
  banner: {
    path: "email/diwali-2026.jpg",
    width: 1199,
    height: 400,
    alt: "Happy Diwali — May this Festival of Lights bring success, prosperity and new opportunities.",
    /* It reads "Festive Quotation Attached". */
    claimsAttachment: true,
  },
};

export const FESTIVE_GREETINGS: readonly FestiveGreeting[] = [DIWALI_2026];

/**
 * BLANK COUNTS AS INDIA, which is the convention the rest of this CRM
 * already runs on — the tax engine reads a blank country as a domestic sale
 * (see applyCountry in domain/customers/customer.ts), and a customer record
 * typed in a hurry often has no country at all. Reading it differently here
 * would mean two meanings for one empty field.
 */
const sameCountry = (a: string, b: string): boolean => {
  const left = String(a ?? "").trim().toLowerCase() || "india";
  return left === String(b ?? "").trim().toLowerCase();
};

/** True while `today` falls inside the window, both ends included. */
export const greetingIsCurrent = (greeting: FestiveGreeting, today: string): boolean =>
  !!today && today >= greeting.from && today <= greeting.until;

/**
 * The greeting to offer for this customer today, if any.
 *
 * Returns null far more often than not, and that is the normal answer: no
 * festival today, or a customer this one does not belong to.
 */
export function greetingFor(
  { today, country }: { today: string; country?: string | null },
  greetings: readonly FestiveGreeting[] = FESTIVE_GREETINGS,
): FestiveGreeting | null {
  return greetings.find((g) =>
    greetingIsCurrent(g, today) && g.countries.some((c) => sameCountry(country ?? "", c))) ?? null;
}

/**
 * Where the artwork actually lives, as an absolute https URL.
 *
 * An email leaves the building, so a relative path in it resolves against
 * nothing. The origin is the one the agent has the CRM open on, which is by
 * definition a host that serves this image — except on a developer's
 * machine, where it would send the customer a picture on localhost. That
 * case falls back to the production site.
 */
export const PUBLIC_SITE = "https://crm.ttpldelhi.com";

export function bannerUrlFor(greeting: FestiveGreeting, origin?: string | null): string | null {
  if (!greeting.banner) return null;
  const clean = String(origin ?? "").trim().replace(/\/+$/, "");
  const usable = /^https:\/\//i.test(clean) && !/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(clean);
  return `${usable ? clean : PUBLIC_SITE}/${greeting.banner.path}`;
}
