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
    .select("id, name, email, role, designation")
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
