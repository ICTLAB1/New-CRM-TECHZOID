/**
 * Telling somebody WHY the database would not take their change.
 *
 * Most save failures are ours to fix, not theirs: a dropped column, a bad
 * payload, a policy that should have let them through. Those get one plain
 * sentence, because the detail is for the log and a stack trace in a banner
 * helps nobody.
 *
 * A FEW ARE DELIBERATE RULES, raised in SQL with a sentence written for the
 * person who hit them — a quotation priced under the approved floor, the
 * last Admin being demoted. Those messages are the whole point of the rule.
 * Hiding them behind "couldn't be saved — please try again" turns a rule
 * into a glitch, and invites the salesperson to press the button again
 * forever. This is what the price-book floor does when a quotation is sent
 * below the minimum selling price: see supabase/056_price_book.sql.
 *
 * The convention those rules follow — check_violation, SQLSTATE 23514, with
 * a human sentence — is the one already used by supabase/034_last_admin.sql.
 */

/** Postgres's own wording for a column CHECK a table carries. Nobody outside
 *  this codebase can read it, so it falls back to the plain sentence. */
const BOILERPLATE = /violates check constraint|new row for relation/i;

export const GENERIC_SAVE_ERROR =
  "That change couldn't be saved. Your workspace has been reloaded — please try again.";

/**
 * The sentence to put in front of the person after a failed save.
 *
 * Returns the database's own words only where they were written to be read:
 * a deliberate refusal, not a constraint message or an internal failure.
 */
export function saveRefusal(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message.trim() : "";
  if (code !== "23514" || !message || BOILERPLATE.test(message)) return GENERIC_SAVE_ERROR;
  return message;
}
