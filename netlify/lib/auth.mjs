import { service } from "../../api/lib/serviceClient.mjs";
import { callerOf } from "../../api/lib/identity.mjs";

/**
 * Who is calling.
 *
 * Every function that touches data or spends money verifies the caller's
 * session server-side. `ai-proxy` shipped without this in v1 while calling a
 * paid API: anyone who guessed the URL could run up the bill.
 *
 * THIS FILE IS THE WHOLE OF WHAT CHANGED when the twenty-six functions moved
 * off Supabase. `adminClient()` returns the service client, which composes
 * the same query descriptions and hands them to the translator instead of to
 * PostgREST; `signedInUser()` verifies the bearer token itself instead of
 * asking Supabase Auth about it. No handler can tell the difference, because
 * the builder is the same builder and a verified caller still has an `id`.
 */

/**
 * A client that BYPASSES ROW-LEVEL SECURITY, for the trusted server jobs.
 *
 * Named `adminClient` because twenty-six files call it that. What it means
 * has not changed: this is the service role, it sees everything, and it is
 * never the right tool for work done on behalf of somebody who presented a
 * token — that is what the policies are for.
 */
export function adminClient() {
  return service();
}

function bearer(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

/**
 * The signed-in user, or null.
 *
 * Null for a missing token AND for a bad one. That is deliberate and it is
 * the same answer Supabase gave: every caller here treats null as "not
 * signed in" and refuses, so an unverifiable token is refused too. The
 * distinction that matters — anonymous versus forged — belongs to the query
 * endpoints, where anonymous is a legitimate caller with a legitimate empty
 * answer. Here there is no such thing as a legitimate anonymous admin.
 */
export async function signedInUser(event) {
  try {
    const caller = await callerOf(bearer(event) ? `Bearer ${bearer(event)}` : "");
    if (!caller) return null;
    return { id: caller.userId, email: caller.claims?.email ?? null };
  } catch (err) {
    console.error("session lookup failed:", err?.message ?? err);
    return null;
  }
}

/**
 * The signed-in user together with their CRM role.
 *
 * The role is read from `profiles` server-side, never taken from the request:
 * a client claiming to be an admin is just a client.
 */
export async function signedInProfile(event) {
  const user = await signedInUser(event);
  if (!user) return null;
  try {
    const { data } = await adminClient().from("profiles").select("id, name, email, role, designation, phone").eq("id", user.id).single();
    return { user, profile: data ?? null, role: data?.role ?? "Sales" };
  } catch {
    return { user, profile: null, role: "Sales" };
  }
}

export const isAdmin = (role) => role === "Admin";
