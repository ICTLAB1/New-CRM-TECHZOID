import { fail, guard, json, isOriginLocked } from "../lib/http.mjs";
import { adminClient, isAdmin, signedInProfile } from "../lib/auth.mjs";

/**
 * Microsoft 365 setup diagnostics.
 *
 * ADMIN ONLY, and it returns only whether each secret is PRESENT plus a
 * four-character masked hint — never a value. The hint exists so an admin can
 * tell "I pasted the right secret" from "I pasted the secret's ID", which is
 * the mistake this whole screen exists to catch.
 *
 * It also translates Microsoft's error codes, because AADSTS7000215 means
 * nothing to anyone the first time they see it.
 */

/** Four characters, never more, and never the beginning of the value. */
const hint = (value) => {
  if (!value) return null;
  const s = String(value);
  return s.length <= 8 ? "…" + s.slice(-2) : "…" + s.slice(-4);
};

const AADSTS = {
  AADSTS7000215: "The client secret is wrong. In Azure, copy the secret's VALUE, not its Secret ID — the Value is only shown once, right after you create it.",
  AADSTS700016: "Azure doesn't recognise the application ID. Check MS_CLIENT_ID against the app registration's Application (client) ID.",
  AADSTS50011: "The redirect URI doesn't match. Add exactly this URI to the app registration under Authentication → Web → Redirect URIs.",
  AADSTS900023: "The tenant ID isn't valid. Use the Directory (tenant) ID from the app registration's overview, or leave MS_TENANT_ID unset to use 'common'.",
  AADSTS65001: "Nobody has consented yet. The first person to connect will be asked to approve the permissions.",
  AADSTS7000218: "Azure expected a client secret and didn't get one. Check MS_CLIENT_SECRET is set.",
  AADSTS50020: "That account isn't in this tenant. Either sign in with a work account from your own organisation, or set MS_TENANT_ID to 'common'.",
};

export function explain(code) {
  if (!code) return null;
  const match = String(code).match(/AADSTS\d+/);
  return match ? (AADSTS[match[0]] ?? null) : null;
}

export async function handler(event) {
  const stop = guard(event, "GET", "GET, OPTIONS");
  if (stop) return stop;

  const who = await signedInProfile(event);
  if (!who) return fail(event, 403, "Sign in required.", null, "GET, OPTIONS");
  if (!isAdmin(who.role)) {
    return fail(event, 403, "Only an admin can view the integration diagnostics.", null, "GET, OPTIONS");
  }

  const env = process.env;
  const secrets = {
    MS_CLIENT_ID: env.MS_CLIENT_ID,
    MS_CLIENT_SECRET: env.MS_CLIENT_SECRET,
    MS_TENANT_ID: env.MS_TENANT_ID,
    MS_REDIRECT_URI: env.MS_REDIRECT_URI,
    MS_STATE_SECRET: env.MS_STATE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY: env.RESEND_API_KEY,
  };

  const report = Object.fromEntries(
    Object.entries(secrets).map(([key, value]) => [key, { present: !!value, hint: hint(value) }]),
  );

  /* The redirect URI is the one value an admin must be able to read back
     exactly, because it has to be pasted into Azure character for character
     — and it is a public URL, not a secret. */
  report.MS_REDIRECT_URI.value = env.MS_REDIRECT_URI ?? null;

  const checks = [];
  if (!secrets.MS_CLIENT_ID) checks.push("MS_CLIENT_ID is missing.");
  if (!secrets.MS_CLIENT_SECRET) checks.push("MS_CLIENT_SECRET is missing.");
  if (!secrets.MS_REDIRECT_URI) checks.push("MS_REDIRECT_URI is missing.");
  if (secrets.MS_REDIRECT_URI && !/\/\.netlify\/functions\/ms-oauth-callback$/.test(secrets.MS_REDIRECT_URI)) {
    checks.push("MS_REDIRECT_URI must end with /.netlify/functions/ms-oauth-callback — that exact path is what Azure redirects to.");
  }
  if (!env.MS_STATE_SECRET) {
    checks.push("MS_STATE_SECRET isn't set, so the service role key is being used to sign OAuth state. It works, but a dedicated secret is better.");
  }
  if (!isOriginLocked()) {
    checks.push("ALLOWED_ORIGINS isn't set, so the functions accept any origin. Set it to https://crm.ttpldelhi.com.");
  }

  /* Is the table there? It is the one setup step that happens in Supabase
     rather than in Netlify, so it is also the one most often forgotten —
     and without it a connection authorises and then fails to save. */
  let table = { ready: false, error: null };
  try {
    const { error } = await adminClient().from("ms_mail_accounts").select("user_id", { count: "exact", head: true });
    if (error) {
      table = { ready: false, error: error.message };
      checks.push("The ms_mail_accounts table is missing. Run supabase/003_ms_mail_accounts.sql in the Supabase SQL editor.");
    } else {
      table = { ready: true, error: null };
    }
  } catch (err) {
    table = { ready: false, error: "Could not reach the database." };
    console.error("table check failed:", err?.message ?? err);
  }

  /* Ask Microsoft whether the credentials actually work, using the client
     credentials grant — it needs no user and proves the id/secret pair. */
  let live = { checked: false };
  if (secrets.MS_CLIENT_ID && secrets.MS_CLIENT_SECRET) {
    const tenant = secrets.MS_TENANT_ID || "common";
    try {
      const resp = await fetch("https://login.microsoftonline.com/" + encodeURIComponent(tenant) + "/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: secrets.MS_CLIENT_ID,
          client_secret: secrets.MS_CLIENT_SECRET,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }).toString(),
      });
      const result = await resp.json().catch(() => ({}));
      if (resp.ok) {
        live = { checked: true, ok: true, message: "Microsoft accepted the client ID and secret." };
      } else {
        const code = result?.error_codes?.[0] ? "AADSTS" + result.error_codes[0] : result?.error;
        live = {
          checked: true, ok: false, code: code ?? null,
          message: explain(code) ?? "Microsoft rejected the credentials. Check the client ID and secret.",
        };
      }
    } catch (err) {
      console.error("diagnostics live check failed:", err?.message ?? err);
      live = { checked: true, ok: false, message: "Could not reach Microsoft to check the credentials." };
    }
  }

  return json(event, 200, { secrets: report, checks, table, live }, "GET, OPTIONS");
}
