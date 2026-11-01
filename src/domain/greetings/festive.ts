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
}

/**
 * Diwali 2026 falls on 8 November. The window runs to the 10th, as asked:
 * greetings sent in the days around it are ordinary, and one sent on the
 * 11th is late.
 */
export const DIWALI_2026: FestiveGreeting = {
  id: "diwali-2026",
  name: "Diwali greetings",
  headline: "Wishing you a very happy Diwali",
  line: "May the festival of lights bring prosperity and good health to you, your family and your team.",
  from: "2026-10-01",
  until: "2026-11-10",
  countries: ["India"],
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
