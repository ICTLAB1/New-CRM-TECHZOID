import { createClient } from "@supabase/supabase-js";

/**
 * Who is calling.
 *
 * Every function that touches data or spends money verifies the caller's
 * Supabase session server-side. `ai-proxy` shipped without this in v1 while
 * calling a paid API: anyone who guessed the URL could run up the bill.
 */

export function adminClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function bearer(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

/** The signed-in user, or null. */
export async function signedInUser(event) {
  const token = bearer(event);
  if (!token) return null;
  try {
    const { data, error } = await adminClient().auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
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
    const { data } = await adminClient().from("profiles").select("id, name, email, role, designation").eq("id", user.id).single();
    return { user, profile: data ?? null, role: data?.role ?? "Sales" };
  } catch {
    return { user, profile: null, role: "Sales" };
  }
}

export const isAdmin = (role) => role === "Admin";
