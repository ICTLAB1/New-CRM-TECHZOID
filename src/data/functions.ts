import { apiBase, getToken } from "./backend";

/**
 * Where a server function lives, and the token to call it with.
 *
 * ON AZURE THE OLD ADDRESSES ARE DEAD. Netlify served these at
 * `/.netlify/functions/<name>`; on Azure Static Web Apps that path is just a
 * static file that does not exist (405), and the same functions answer at
 * `/api/<name>` through the bridge in api/src/functions/netlifyBridge.mjs.
 * Every screen asks here instead of hard-coding either path.
 *
 * AND THE TOKEN IS WHICHEVER SIGN-IN IS LIVE. Asking Supabase directly
 * returned nothing once sign-in moved to Microsoft, which every screen then
 * reported as "Your session has ended" while the user was plainly signed in.
 */
export function fnPath(name: string): string {
  const base = apiBase();
  return base ? `${base.replace(/\/+$/, "")}/${name}` : `/.netlify/functions/${name}`;
}

/** The same, as a full address — for values pasted into other services. */
export function fnUrl(name: string): string {
  const origin = typeof window === "undefined" ? "https://crm.ttpldelhi.com" : window.location.origin;
  return origin + fnPath(name);
}

/** The signed-in person's token for a function call, or null. */
export async function fnToken(): Promise<string | null> {
  try {
    return (await getToken()()) ?? null;
  } catch {
    return null;
  }
}
