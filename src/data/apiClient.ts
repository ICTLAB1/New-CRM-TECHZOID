import type { Db } from "./db";
import { createPgClient } from "./pgClient";

/**
 * The client that talks to the API tier, ready and NOT switched on.
 *
 * `store()` still binds to Supabase. This exists so the cutover is a
 * one-line change in one place rather than an afternoon of edits under time
 * pressure, and so the endpoints can be pointed at a real deployment and
 * tried before anything depends on them.
 *
 * WHERE THE TOKEN COMES FROM, AND WHY IT IS FETCHED EVERY TIME. Access
 * tokens expire — an hour, typically — and the identity library refreshes
 * them in the background. A token captured once when the client was built
 * would work beautifully all morning and start returning 401 to somebody
 * who has not touched anything. So `getToken` is called per request and asks
 * for the current session each time.
 *
 * AND WHY IT IS AN INDIRECTION. Today the session is Supabase's; after the
 * Entra ID step it is MSAL's. Everything else in this file, and everything
 * downstream of it, stays as it is — only `tokenSource` changes.
 */

export type TokenSource = () => Promise<string | null>;

/**
 * The signed-in person's access token, or null when nobody is signed in.
 *
 * Null is a legitimate answer, not a failure: the registration form and the
 * customer portal are meant to be reachable without signing in, and they run
 * as `anon` where the policies show them nothing they should not see.
 */
export const supabaseToken: TokenSource = async () => {
  const { getSupabase, isSupabaseConfigured } = await import("./supabase");
  if (!isSupabaseConfigured()) return null;
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    /* A session that cannot be read is nobody signed in. Throwing here would
       take down the public pages, which need no session at all. */
    return null;
  }
};

/**
 * Build a client pointed at the API tier.
 *
 * @param endpoint Where the Functions app lives. The default is same-origin,
 *   which is what Static Web Apps gives you: the SPA and `/api` are served
 *   from one hostname, so there is no CORS to configure and no third-party
 *   cookie to worry about. A different origin would need both.
 */
export function createApiClient(
  endpoint = "/api",
  getToken: TokenSource = supabaseToken,
): Db {
  return createPgClient({ endpoint, getToken });
}
