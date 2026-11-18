/**
 * The daily cap on company-profile emails, as the screens need to know it.
 *
 * THE LIMIT ITSELF IS THE SERVER'S — netlify/lib/profileSendLimit.mjs — and
 * nothing here enforces anything. A browser cannot be the place a sending
 * limit lives: the endpoint is reachable without one, a long list arrives
 * in pieces that each look small, and two people sending at once would each
 * see an allowance the other was spending.
 *
 * What this is for is telling somebody BEFORE they press Send, rather than
 * after four of their hundred have gone. The numbers are repeated here and
 * sendLimit.test.ts fails if either side is changed without the other, the
 * same arrangement the WhatsApp template names are under.
 *
 * WHY THERE IS A LIMIT AT ALL, in one line, because the screens have to say
 * it: the domain's reputation that carries this company's quotations and
 * invoices is the same reputation a mailshot spends, a sudden jump in
 * volume is what gets a business filtered as spam, and it takes weeks to
 * undo.
 */

/** Low on purpose: a starting number for a domain with no bulk history. */
export const DEFAULT_DAILY_CAP = 40;

/** The field exists to be raised as a domain warms up, not switched off. */
export const MAX_DAILY_CAP = 300;

/** What this company allows itself, clamped the way the server clamps it. */
export function dailyCapFrom(settings: Record<string, unknown> | undefined): number {
  const profile = (settings?.["profile"] ?? {}) as Record<string, unknown>;
  const raw = profile["dailySendLimit"] ?? settings?.["profileDailySendLimit"];
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_CAP;
  return Math.min(n, MAX_DAILY_CAP);
}

/**
 * What to tell somebody who has chosen more people than a day allows.
 *
 * It does not refuse — the server decides what goes — and it does not
 * pretend to know how many have already gone today. It says what the limit
 * is and what will happen, which is enough to choose a shorter list or
 * carry on and finish tomorrow.
 */
export function overCapNotice(chosen: number, cap: number): string {
  if (chosen <= cap) return "";
  return `You have chosen ${chosen} people and the daily limit is ${cap}. `
    + `The first of them go out today and the rest are held — they are listed as not sent, by name, `
    + `so you can finish the list tomorrow. The limit protects your domain: a sudden jump in volume is `
    + `what gets a business's mail filtered as spam, and it takes weeks to recover.`;
}
