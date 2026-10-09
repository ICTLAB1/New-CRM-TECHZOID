import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
  type IPublicClientApplication,
} from "@azure/msal-browser";

/**
 * Signing in with the company's Microsoft account.
 *
 * WHAT THE REST OF THE APP SEES. A token, and an email. That is the whole
 * surface, because it is the whole surface Supabase Auth had here too —
 * `apiClient.ts` asks for a token per request and `session.ts` asks who is
 * signed in. Swapping the provider swaps this file and nothing downstream.
 *
 * THE TOKEN IS NOT THE ID TOKEN. MSAL hands back two things and it is easy
 * to send the wrong one: an ID token says who signed in and is meant for
 * this application to read, while an ACCESS token is addressed to the API
 * and is the only one the API will accept. Sending the id token produces a
 * 401 with an audience mismatch, which reads like a configuration problem
 * and is in fact this mistake. `acquireTokenSilent` is asked for a scope
 * belonging to the API for exactly that reason.
 *
 * AND THE USER ID IS NOT USED AS AN IDENTITY. Entra's object id is not the
 * id this CRM's rows are owned by; the API translates one into the other.
 * See `supabase/042_entra_identity.sql` for why nobody's id was rewritten.
 */

export interface EntraSettings {
  clientId: string;
  tenantId: string;
  /** The API's scope, e.g. `api://techzoid-crm/.default`. */
  apiScope: string;
  redirectUri?: string;
}

/** Read the settings, or null when Entra sign-in is not configured. */
export function entraSettings(env = import.meta.env): EntraSettings | null {
  const clientId = String(env.VITE_ENTRA_CLIENT_ID ?? "").trim();
  const tenantId = String(env.VITE_ENTRA_TENANT_ID ?? "").trim();
  const apiScope = String(env.VITE_ENTRA_API_SCOPE ?? "").trim();
  if (!clientId || !tenantId || !apiScope) return null;
  return {
    clientId, tenantId, apiScope,
    redirectUri: String(env.VITE_ENTRA_REDIRECT_URI ?? "").trim() || undefined,
  };
}

let app: IPublicClientApplication | null = null;
let ready: Promise<void> | null = null;

/**
 * The MSAL client, initialised once.
 *
 * `initialize()` must finish before anything else is called, and the promise
 * is kept rather than the result so that twenty simultaneous callers share
 * one initialisation instead of racing twenty.
 */
async function client(settings: EntraSettings): Promise<IPublicClientApplication> {
  if (app && ready) {
    await ready;
    return app;
  }
  app = new PublicClientApplication({
    auth: {
      clientId: settings.clientId,
      authority: `https://login.microsoftonline.com/${settings.tenantId}`,
      redirectUri: settings.redirectUri ?? window.location.origin,
    },
    cache: {
      /* sessionStorage, not localStorage. A token in localStorage outlives
         the browser being closed and is shared across every tab on the
         origin; this is a CRM with customer records in it and the shorter
         life is worth the extra sign-in. */
      cacheLocation: "sessionStorage",
      /* `storeAuthStateInCookie` is deliberately absent: MSAL v5 removed it,
         and it existed for browsers this application does not support. */
    },
  });
  /* Coming back from Microsoft's sign-in page, the result arrives here:
     remember who signed in so every later call finds them. */
  ready = app.initialize().then(() => app!.handleRedirectPromise().then((result) => {
    if (result?.account) app!.setActiveAccount(result.account);
  }));
  await ready;
  return app;
}

function activeAccount(msal: IPublicClientApplication): AccountInfo | null {
  return msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
}

/**
 * An access token for the API, or null when nobody is signed in.
 *
 * Silent first, always. MSAL renews from its own cache without a round trip
 * when it can, and only a genuinely expired session needs the user to see
 * anything — a popup on every request would be unusable and would be
 * blocked by the browser anyway.
 */
export async function entraToken(): Promise<string | null> {
  const settings = entraSettings();
  if (!settings) return null;

  const msal = await client(settings);
  const account = activeAccount(msal);
  if (!account) return null;

  try {
    const result = await msal.acquireTokenSilent({ scopes: [settings.apiScope], account });
    return result.accessToken || null;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      /* The session really has ended. Returning null rather than throwing a
         popup open from underneath whatever the user was doing — the app
         treats null as signed out and sends them to the sign-in screen,
         which is where a sign-in belongs. */
      return null;
    }
    console.error("could not get an access token:", err);
    return null;
  }
}

/**
 * Start an interactive sign-in.
 *
 * A FULL-PAGE REDIRECT, NOT A POPUP. Popups are blocked by phones, by many
 * office PCs and by embedded browsers, and the sign-in then fails with
 * `popup_window_error` before the user ever sees Microsoft's page. The page
 * leaves for Microsoft and comes back; `client()` picks the result up.
 */
export async function entraSignIn(): Promise<void> {
  const settings = entraSettings();
  if (!settings) throw new Error("Microsoft sign-in is not configured.");
  const msal = await client(settings);
  await msal.loginRedirect({
    scopes: [settings.apiScope],
    /* Ask every time which account to use. Without this, somebody on a
       shared machine is silently signed in as whoever used it last. */
    prompt: "select_account",
  });
}

export async function entraSignOut(): Promise<void> {
  const settings = entraSettings();
  if (!settings) return;
  const msal = await client(settings);
  const account = activeAccount(msal);
  await msal.logoutRedirect({ account: account ?? undefined });
}

/** Who is signed in, or null. */
export async function entraAccount(): Promise<{ id: string; email: string; name: string } | null> {
  const settings = entraSettings();
  if (!settings) return null;
  const msal = await client(settings);
  const account = activeAccount(msal);
  if (!account) return null;
  return {
    /* Entra's object id. NOT this CRM's user id — the API translates it.
       Nothing in the browser should use this to decide what anybody owns. */
    id: String(account.localAccountId ?? account.homeAccountId ?? ""),
    email: String(account.username ?? ""),
    name: String(account.name ?? account.username ?? ""),
  };
}

/** Drop the client. For tests, and after a configuration change. */
export function forgetEntra(): void {
  app = null;
  ready = null;
}
