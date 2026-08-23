import { demoApi, netlifyApi, type IntegrationsApi } from "./api";
import { isSupabaseConfigured } from "../data/supabase";

/**
 * Which implementation the app runs on.
 *
 * With Supabase configured, the real one. Without it — a preview build, a
 * screenshot run, someone opening the repo to look — the demo one, which
 * refuses every outward-facing action and says why. There is no third mode
 * where a button looks like it worked and did nothing.
 */
export const integrations: IntegrationsApi = isSupabaseConfigured() ? netlifyApi() : demoApi();

export type { IntegrationsApi } from "./api";
