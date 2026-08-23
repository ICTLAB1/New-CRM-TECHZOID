import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client, created on first use rather than on import.
 *
 * Creating it at module scope meant that merely importing anything in this
 * folder threw when the environment wasn't configured — which took the whole
 * preview build down, including the screens that never touch a database.
 * Nothing here connects until something actually asks for the client.
 *
 * The anon key is safe to ship: it has no power on its own. Every access
 * decision is made by the Row Level Security policies in supabase/.
 */

let client: SupabaseClient | null = null;

export const isSupabaseConfigured = (): boolean =>
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env and fill in " +
        "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from " +
        "Supabase Dashboard -> Project Settings -> API.",
    );
  }
  client = createClient(url, anonKey);
  return client;
}
