/**
 * Turning whatever went wrong into something a salesperson can act on.
 *
 * THE RULE: the user gets a sentence about their situation; the console gets
 * the technical detail. A Postgres error like
 *
 *   duplicate key value violates unique constraint "customers_pkey"
 *
 * tells a developer everything and the person in front of the customer
 * nothing — and worse, it names a table and a constraint, which is internal
 * structure leaking onto a screen somebody might photograph.
 *
 * `undefined` is the other failure this exists to stop: an error thrown as a
 * string, an object with no message, or a rejected promise carrying nothing
 * all end up rendered literally unless something catches them here.
 */

/** What the reader is told, and what the log gets. */
export interface Described {
  /** One sentence, in the second person, about what to do next. */
  message: string;
  /** The original, for `console.error`. Never rendered. */
  detail: string;
}

const OFFLINE = "You appear to be offline. Check your connection and try again.";
const GENERIC = "Something went wrong. We couldn't complete this action — please try again.";

/**
 * Known shapes, in the order they are worth recognising.
 *
 * Matched on the code or on a distinctive fragment rather than the whole
 * string: Postgres and PostgREST both reword their messages between
 * versions, and a match that depends on exact wording is one that quietly
 * stops matching after an upgrade.
 */
function known(detail: string, code: string): string | null {
  const d = detail.toLowerCase();

  /* PostgREST/Supabase auth and permission. "row-level security" is the one
     users hit by doing something they are not allowed to, so it says that
     rather than "permission denied for table customers". */
  if (code === "42501" || d.includes("row-level security") || d.includes("permission denied")) {
    return "You don't have permission to do that. Ask an admin if you think you should.";
  }
  if (code === "23505" || d.includes("duplicate key")) {
    return "That record already exists. Open it rather than creating a second one.";
  }
  if (code === "23503" || d.includes("foreign key")) {
    return "Something this is attached to is missing. Refresh the page and try again.";
  }
  if (code === "PGRST301" || d.includes("jwt expired") || d.includes("invalid token")) {
    return "Your session has expired. Sign in again to continue.";
  }
  if (d.includes("failed to fetch") || d.includes("networkerror") || d.includes("network request failed")) {
    return OFFLINE;
  }
  if (code === "429" || d.includes("too many requests")) {
    return "That's been tried a few times in a row. Wait a moment and try again.";
  }
  /* Storage, where the message is usually already fit to read. */
  if (d.includes("payload too large") || d.includes("exceeded the maximum")) {
    return "That file is too large to attach.";
  }
  return null;
}

/**
 * @param fallback what to say when nothing is recognised — pass one that
 * names the action ("Couldn't save that customer.") so the sentence is about
 * what the user was doing rather than about software in general.
 */
export function describeError(error: unknown, fallback: string = GENERIC): Described {
  const detail = detailOf(error);
  const code = String((error as { code?: unknown })?.code ?? "");

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { message: OFFLINE, detail };
  }

  return { message: known(detail, code) ?? fallback, detail };
}

/** Everything a throw site might have thrown, flattened to a string. */
function detailOf(error: unknown): string {
  if (!error) return "(no detail)";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || error.name;
  const obj = error as { message?: unknown; error_description?: unknown; error?: unknown; hint?: unknown };
  for (const value of [obj.message, obj.error_description, obj.error, obj.hint]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  try {
    return JSON.stringify(error).slice(0, 400);
  } catch {
    return String(error);
  }
}

/**
 * Report a failure: one line to the console for whoever has to fix it, one
 * sentence returned for whoever has to carry on working.
 */
export function reportError(where: string, error: unknown, fallback?: string): string {
  const { message, detail } = describeError(error, fallback);
  console.error(`${where}:`, detail, error);
  return message;
}
