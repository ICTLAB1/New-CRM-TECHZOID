import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Supabase is not configured. Copy .env.example to .env and fill in " +
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from " +
      "Supabase Dashboard -> Project Settings -> API.",
  );
}

/** The anon key is safe to ship: it has no power on its own. Every access
 *  decision is made by the Row Level Security policies in supabase/. */
export const supabase: SupabaseClient = createClient(url, anonKey);
