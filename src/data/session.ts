import { getSupabase, isSupabaseConfigured } from "./supabase";
import type { Session } from "@supabase/supabase-js";

/**
 * Who is signed in.
 *
 * The session comes from Supabase; the ROLE comes from the `profiles` table,
 * never from the client. A role read from anywhere else is a claim, not a
 * fact — and every policy in the database checks the table, so a client that
 * believed otherwise would simply get empty results.
 */

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Their own job title, for the signature on email they send. */
  designation?: string;
  /** Their own mobile. The company number in Settings stays the fallback. */
  phone?: string;
}

/** One definition of "is there a server behind this", used by the app to
 *  decide between the live workspace and the preview fixtures. */
export const isConfigured = isSupabaseConfigured;

export async function currentSession(): Promise<Session | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session ?? null;
}

export function onSessionChange(handler: (session: Session | null) => void): () => void {
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => handler(session));
  return () => data.subscription.unsubscribe();
}

/**
 * The signed-in person's profile row.
 *
 * A sign-in with no profile row is a real state — the trigger that creates it
 * can fail, or an account can be made in the Supabase dashboard directly. It
 * returns null rather than inventing a role, and the caller says so.
 */
export async function loadProfile(session: Session): Promise<SignedInUser | null> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, name, email, role, designation, phone")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    name: (data.name as string) || (session.user.email ?? "").split("@")[0] || "You",
    email: (data.email as string) || session.user.email || "",
    role: (data.role as string) || "Sales",
    /* Their job title. Selected above but previously dropped here, which
       left every outgoing email with no title under the sender's name however
       carefully it had been set on their profile. */
    designation: (data.designation as string) || "",
    /* Their own mobile, so a customer replying to a quotation reaches the
       person who sent it rather than the switchboard. */
    phone: (data.phone as string) || "",
  };
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(readableAuthError(error.message));
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin,
  });
  if (error) throw new Error(readableAuthError(error.message));
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

/**
 * Supabase's auth messages are written for a developer.
 *
 * Deliberately vague about WHICH half was wrong: telling someone the email
 * exists but the password is wrong is how an attacker enumerates accounts.
 */
export function readableAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match an account.";
  if (m.includes("email not confirmed")) return "That account hasn't been confirmed yet. Ask an admin to confirm it.";
  if (m.includes("rate") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("network") || m.includes("fetch")) return "Couldn't reach the server. Check your connection.";
  return "Couldn't sign in. Try again, or ask an admin to reset your password.";
}

/**
 * Set your own job title and mobile number.
 *
 * WHY THIS IS NOT THE ADMIN ENDPOINT. Team management goes through
 * admin-users.mjs behind an Admin check, because handing out roles and
 * resetting passwords is an administrator's job. A job title is not: it is
 * the line under your own name at the foot of email you send, and the person
 * who knows it is you. Routing it through the admin function would mean every
 * salesperson had to ask somebody else to type their own title in.
 *
 * It is safe as a direct write because profiles_update_self_or_admin already
 * governs it: `using (auth.uid() = id or is_admin())` limits the row to your
 * own, and the `with check` clause refuses any change that would alter the
 * role of a non-admin. So the worst this can do is change your own details.
 * Proven against a real Postgres with that policy loaded: a Sales user's
 * update of their own phone succeeded, the same statement aimed at a
 * colleague's row changed nothing, and `set role = 'Admin'` on their own row
 * was rejected outright by the policy.
 */
export async function setMyDetails(patch: { designation?: string; phone?: string }): Promise<void> {
  const session = await currentSession();
  if (!session) throw new Error("You're signed out. Sign in again and retry.");

  /* Only what was passed, so saving a phone number does not blank a job
     title somebody set on another screen a moment ago. */
  const update: Record<string, string> = {};
  if (patch.designation !== undefined) update.designation = patch.designation.trim();
  if (patch.phone !== undefined) update.phone = patch.phone.trim();
  if (!Object.keys(update).length) return;

  const { error } = await getSupabase().from("profiles").update(update).eq("id", session.user.id);
  if (error) throw new Error("Couldn't save your details. Try again in a moment.");
}
