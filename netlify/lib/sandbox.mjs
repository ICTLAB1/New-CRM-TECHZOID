/**
 * Sandbox (sandbox.co.in) — GSTIN and PAN verification against the
 * government registers.
 *
 * WHERE THE CREDENTIALS LIVE. SANDBOX_API_KEY and SANDBOX_API_SECRET are
 * Netlify environment variables and are read only here, on the server. They
 * are never prefixed VITE_, because anything with that prefix is compiled
 * into the JavaScript every visitor downloads — a paid verification API key
 * published on the internet is somebody else's free API key. The browser
 * calls our own function; the function calls Sandbox.
 *
 * ── IF A CALL COMES BACK 404 OR 400, READ THIS ──────────────────────────
 * The three constants below are the whole contract with the provider. They
 * were written from Sandbox's published API and could NOT be confirmed by
 * calling it — the machine this was built on has no route to
 * api.sandbox.co.in. Everything downstream (the parsing, the UI, the tests)
 * is independent of them and does not need touching.
 *
 * So: check a path against the live docs at https://docs.sandbox.co.in,
 * change it here, redeploy. "Test connection" on the Integrations screen
 * reports the provider's own status code and message, which is what tells
 * you which of these is wrong.
 * ────────────────────────────────────────────────────────────────────────
 */

const BASE = process.env.SANDBOX_API_BASE || "https://api.sandbox.co.in";

/** Sandbox versions its API through a header rather than the path. */
const API_VERSION = process.env.SANDBOX_API_VERSION || "1.0";

const ROUTES = {
  authenticate: "/authenticate",
  /** GSTIN → the public register entry. A GET, with the number in the query. */
  gstin: (gstin) => `/gst/compliance/public/gstin/search?gstin=${encodeURIComponent(gstin)}`,
  /** PAN → a POST, because it carries the consent flag and a stated reason. */
  pan: "/kyc/pan/verify",
};

/**
 * The access token, cached for the life of this process.
 *
 * Sandbox issues a token good for about a day, so re-authenticating on
 * every verification would be one wasted round trip per check. A serverless
 * process is short-lived and this cache dies with it — that is fine, it
 * saves the calls within one warm process and nothing depends on it
 * surviving. Deliberately not stored in the database: it is derived from
 * the secret, and the tables the app can read are the wrong place for that.
 */
let cached = { token: "", expiresAt: 0 };

/* Re-authenticate a few minutes early rather than discover expiry mid-call. */
const SKEW_MS = 5 * 60 * 1000;
const DEFAULT_LIFETIME_MS = 23 * 60 * 60 * 1000;

export function credentialsPresent() {
  return !!(process.env.SANDBOX_API_KEY && process.env.SANDBOX_API_SECRET);
}

/** Seconds until the cached token is refreshed, for diagnostics. 0 = none held. */
export const cachedTokenLife = () => (cached.token ? Math.max(0, Math.round((cached.expiresAt - Date.now()) / 1000)) : 0);

/** Clear the cache — used when a call comes back 401 with a token we thought good. */
const forgetToken = () => { cached = { token: "", expiresAt: 0 }; };

/** A JWT's own expiry, when it carries one. Falls back to a day. */
export function expiryOf(token) {
  try {
    const [, payload] = String(token).split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    if (claims?.exp) return Number(claims.exp) * 1000;
  } catch { /* not a JWT, or not one we can read — the default stands */ }
  return Date.now() + DEFAULT_LIFETIME_MS;
}

async function authenticate() {
  if (cached.token && Date.now() < cached.expiresAt - SKEW_MS) return cached.token;

  const resp = await fetch(BASE + ROUTES.authenticate, {
    method: "POST",
    headers: {
      "x-api-key": process.env.SANDBOX_API_KEY,
      "x-api-secret": process.env.SANDBOX_API_SECRET,
      "x-api-version": API_VERSION,
      "Content-Type": "application/json",
    },
  });

  const body = await resp.json().catch(() => null);
  const token = body?.access_token || body?.data?.access_token || body?.token;
  if (!resp.ok || !token) {
    /* The provider's own words go to the function log, never to the browser:
       an auth failure body can name the account. */
    console.error("sandbox authenticate failed", resp.status, JSON.stringify(body)?.slice(0, 400));
    const message = resp.status === 401 || resp.status === 403
      ? "Sandbox rejected the API key. Check SANDBOX_API_KEY and SANDBOX_API_SECRET in Netlify."
      : `Sandbox would not issue a token (HTTP ${resp.status}).`;
    return { error: message, status: resp.status };
  }

  cached = { token, expiresAt: expiryOf(token) };
  return token;
}

/**
 * One call to Sandbox, authenticated.
 *
 * @returns {{ok: true, body: unknown} | {ok: false, error: string, status: number}}
 * `error` is written for a salesperson and is safe to show them.
 */
async function call(path, { method = "GET", body } = {}, retryOn401 = true) {
  const token = await authenticate();
  if (typeof token !== "string") return { ok: false, error: token.error, status: token.status };

  let resp;
  try {
    resp = await fetch(BASE + path, {
      method,
      headers: {
        /* Sandbox takes the raw token here — NOT "Bearer <token>". */
        Authorization: token,
        "x-api-key": process.env.SANDBOX_API_KEY,
        "x-api-version": API_VERSION,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    console.error("sandbox request failed:", err?.message ?? err);
    return { ok: false, error: "Could not reach the verification service. Try again in a moment.", status: 502 };
  }

  const payload = await resp.json().catch(() => null);

  if (resp.status === 401 && retryOn401) {
    /* The cached token was accepted when it was issued and is not now.
       Worth exactly one more attempt with a fresh one. */
    forgetToken();
    return call(path, { method, body }, false);
  }

  if (!resp.ok) {
    console.error("sandbox call failed", path.split("?")[0], resp.status, JSON.stringify(payload)?.slice(0, 400));
    return { ok: false, error: providerMessage(resp.status, payload), status: resp.status };
  }
  return { ok: true, body: payload };
}

/**
 * What to tell the person who pressed Verify.
 *
 * "Not found" is the interesting one and it is NOT an error in the app's
 * sense: the register answered, and its answer was that no such
 * registration exists. That is a real result about the number they typed.
 */
export function providerMessage(status, payload) {
  const said = String(payload?.message || payload?.error || payload?.detail || "").trim();
  if (status === 404) return "The register has no entry for that number.";
  if (status === 422 || status === 400) return said || "The register would not accept that number — check it for a typo.";
  if (status === 429) return "The verification service is rate-limiting us. Try again in a minute.";
  if (status === 401 || status === 403) return "Sandbox rejected our credentials. Ask an admin to check them in Netlify.";
  if (status >= 500) return "The verification service is having trouble. Try again shortly.";
  return said || `The verification service answered ${status}.`;
}

/** Look a GSTIN up in the public register. */
export function verifyGstin(gstin) {
  return call(ROUTES.gstin(String(gstin).trim().toUpperCase()));
}

/**
 * Verify a PAN.
 *
 * `consent` is passed through from the person who ticked the box, never
 * defaulted here — the whole point of recording consent is that somebody
 * actually gave it.
 */
export function verifyPan({ pan, name = "", consent, reason }) {
  return call(ROUTES.pan, {
    method: "POST",
    body: {
      "@entity": "in.co.sandbox.kyc.pan_verification.request",
      pan: String(pan).trim().toUpperCase(),
      name_as_per_pan: name,
      date_of_birth: "",
      consent: consent ? "Y" : "N",
      reason,
    },
  });
}

/** Prove the credentials work, without spending a verification. */
export async function testConnection() {
  if (!credentialsPresent()) {
    return { ok: false, error: "SANDBOX_API_KEY and SANDBOX_API_SECRET are not set in Netlify." };
  }
  forgetToken();
  const token = await authenticate();
  if (typeof token !== "string") return { ok: false, error: token.error };
  return { ok: true, tokenLifeSeconds: cachedTokenLife() };
}
