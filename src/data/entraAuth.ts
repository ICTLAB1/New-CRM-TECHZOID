import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import { isInstalledApp } from "./offline";

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
      /* Installed on a phone's home screen, the sign-in has to survive the
         app being closed — that is what lets it open with no network. In
         an ordinary browser tab it stays per-tab, as before. */
      cacheLocation: isInstalledApp() ? "localStorage" : "sessionStorage",
      /* `storeAuthStateInCookie` is deliberately absent: MSAL v5 removed it,
         and it existed for browsers this application does not support. */
    },
  });
  /* Coming back from Microsoft's sign-in page, the result arrives here:
     remember who signed in so every later call finds them. */
  ready = app.initialize().then(() => app!.handleRedirectPromise().then((result) => {
    clearStaleInteraction(settings.clientId);
    if (result?.account) app!.setActiveAccount(result.account);
  }).catch((err) => {
    /* A FAILED RETURN MUST NOT POISON EVERY LATER CALL. This promise is
       shared, so a rejection here (an expired or replayed code — AADSTS70008
       — after a reload, a back button, a slow return) used to make every
       later sign-in attempt fail with the same old error, leaving no way out
       but clearing the address bar by hand. Drop the stale code from the URL
       and carry on signed out: the next click starts a fresh sign-in. */
    console.warn("Microsoft sign-in return could not be completed:", err);
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }));
  await ready;
  return app;
}

/**
 * THE ACCOUNT IN THIS CRM'S TENANT, when MSAL holds more than one.
 *
 * Staff are B2B guests: one sign-in leaves MSAL with two accounts for the
 * same person — their home tenant's and the guest one in the tenant this app
 * lives in. They carry different object ids, and only the guest one is what
 * the API sees. Taking "the first account" picked the home one some of the
 * time, which is why "your account isn't set up yet" came and went.
 */
/* Exported for its test: which account is chosen decides whether sign-in
   works at all, and the rule is easier to get wrong than it looks. */
export function activeAccount(msal: IPublicClientApplication): AccountInfo | null {
  const tenant = entraSettings()?.tenantId?.toLowerCase();
  const all = msal.getAllAccounts();
  const active = msal.getActiveAccount();
  if (!tenant) return active ?? all[0] ?? null;
  if (active?.tenantId?.toLowerCase() === tenant) return active;

  /* AN ACCOUNT FROM ANOTHER DIRECTORY IS WORSE THAN NO ACCOUNT, and this
     used to fall back to one (`active ?? all[0]`). Sign-in moved to the
     company's own directory in 047, and every browser that signed in before
     that still has the old ttpldelhi guest account cached. Handing it back
     produces a token the API rejects — wrong issuer, wrong audience — which
     surfaces as "your account isn't set up yet" on a profile that is
     perfectly fine. Returning null instead means "signed out", so the next
     click starts a real sign-in to the directory that can actually issue a
     token this API accepts. */
  return all.find((a) => a.tenantId?.toLowerCase() === tenant) ?? null;
}

/** The `oid` claim of an access token — the id the API links profiles by. */
export function tokenObjectId(token: string | null): string {
  if (!token) return "";
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return String((JSON.parse(json) as { oid?: string }).oid ?? "");
  } catch {
    return "";
  }
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
/**
 * Drop a "sign-in in progress" marker that no sign-in is behind.
 *
 * MSAL writes one before leaving for Microsoft and removes it on the way
 * back — but only its OWN: a marker carrying another app's client id is
 * never cleared. When sign-in moved to a new app registration (October
 * 2026), browsers that had been mid-sign-in with the old one kept its
 * marker for ever, and every click on "Sign in" failed with
 * interaction_in_progress. A back button or a closed tab during sign-in
 * leaves the same thing behind. By the time this runs the redirect has been
 * handled (client() awaits it), so any marker still there is stale.
 */
function clearStaleInteraction(clientId: string, force = false): void {
  for (const store of [globalThis.sessionStorage, globalThis.localStorage]) {
    try {
      if (!store) continue;
      for (const key of Object.keys(store)) {
        if (!key.endsWith("interaction.status")) continue;
        let owner = "";
        try { owner = (JSON.parse(store.getItem(key) ?? "{}") as { clientId?: string }).clientId ?? ""; } catch { /* unreadable: stale */ }
        if (force || owner !== clientId) store.removeItem(key);
      }
    } catch { /* storage unavailable */ }
  }
}

export async function entraSignIn(): Promise<void> {
  const settings = entraSettings();
  if (!settings) throw new Error("Microsoft sign-in is not configured.");
  const msal = await client(settings);
  clearStaleInteraction(settings.clientId);
  const request = {
    scopes: [settings.apiScope],
    /* Ask every time which account to use. Without this, somebody on a
       shared machine is silently signed in as whoever used it last. */
    prompt: "select_account",
  };
  try {
    await msal.loginRedirect(request);
  } catch (err) {
    /* Still "in progress" with no sign-in behind it (a tab closed half way
       through): clear it and go once more, rather than a dead button. */
    if (String((err as { errorCode?: string })?.errorCode ?? err).includes("interaction_in_progress")) {
      clearStaleInteraction(settings.clientId, true);
      await msal.loginRedirect(request);
      return;
    }
    throw err;
  }
}

export async function entraSignOut(): Promise<void> {
  const settings = entraSettings();
  if (!settings) return;
  const msal = await client(settings);
  /* EVERY cached account, not just the usable one. Signing out is what
     somebody does when the CRM will not let them in, and the thing most
     likely to be wrong is a stale account left over from the old directory
     — which `activeAccount` now refuses to return, so passing it here would
     log out nothing and leave the browser in exactly the state that sent
     them to this screen. */
  const accounts = msal.getAllAccounts();
  for (const account of accounts.slice(0, -1)) {
    try {
      await msal.clearCache({ account });
    } catch (err) {
      console.warn("could not clear a cached Microsoft account:", err);
    }
  }
  await msal.logoutRedirect({ account: accounts[accounts.length - 1] ?? undefined });
}

/** Who is signed in, or null. */
export async function entraAccount(): Promise<{ id: string; email: string; name: string } | null> {
  const settings = entraSettings();
  if (!settings) return null;
  const msal = await client(settings);
  const account = activeAccount(msal);
  if (!account) return null;
  /* The object id the API will see is the one in the access token; for a
     guest that differs from the home account's. Prefer it. */
  const oid = tokenObjectId(await entraToken());
  return {
    /* Entra's object id. NOT this CRM's user id — the API translates it.
       Nothing in the browser should use this to decide what anybody owns. */
    id: oid || String(account.localAccountId ?? account.homeAccountId ?? ""),
    email: String(account.username ?? ""),
    name: String(account.name ?? account.username ?? ""),
  };
}

/** Drop the client. For tests, and after a configuration change. */
export function forgetEntra(): void {
  app = null;
  ready = null;
}
