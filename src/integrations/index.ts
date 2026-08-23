import { demoApi, netlifyApi, type IntegrationsApi } from "./api";

/**
 * Which implementation the app runs on.
 *
 * With Supabase configured, the real one. Without it — a preview build, a
 * screenshot run, someone opening the repo to look — the demo one, which
 * refuses every outward-facing action and says why. There is no third mode
 * where a button looks like it worked and did nothing.
 */
export const integrations: IntegrationsApi =
  import.meta.env.VITE_SUPABASE_URL ? netlifyApi() : demoApi();

export type { IntegrationsApi } from "./api";
