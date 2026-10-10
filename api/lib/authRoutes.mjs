/**
 * The `/auth/v1/*` surface, in the shape supabase-js expects.
 *
 * The browser keeps its existing client; only the URL it is pointed at
 * changes. That is the whole reason for matching GoTrue's paths and field
 * names rather than inventing better ones -- the migration's value is that
 * nothing else moved.
 */

import { AuthError, currentUser, refresh, signIn, signOut } from "./localAuth.mjs";
import { asService } from "./db.mjs";
import { verifyToken } from "./identity.mjs";

const json = (status, body) => ({ status, jsonBody: body });

/* GoTrue's error shape, which supabase-js reads to build the message the
   sign-in screen shows. `error_description` is the one it displays. */
const fail = (err) => json(err?.status ?? 500, {
  error: err instanceof AuthError ? "invalid_grant" : "server_error",
  error_description: err instanceof AuthError ? err.message : "Something went wrong.",
  message: err instanceof AuthError ? err.message : "Something went wrong.",
});

async function body(request) {
  try { return JSON.parse(await request.text()) ?? {}; } catch { return {}; }
}

const bearer = (request) => {
  const raw = String(request.headers?.get?.("authorization") ?? "");
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
};

/**
 * POST /auth/v1/token
 *
 * `grant_type` decides which: a password, or a refresh token. Both run as
 * SERVICE, because checking a password necessarily reads a column that no
 * browser-facing role is granted -- and must not be.
 */
export async function handleToken(request, options = {}) {
  try {
    const url = new URL(request.url ?? "https://x/");
    const grant = url.searchParams.get("grant_type") ?? "password";
    const b = await body(request);
    const ua = request.headers?.get?.("user-agent") ?? null;

    if (grant === "refresh_token") {
      return json(200, await asService((c) => refresh(c, b.refresh_token, ua)));
    }
    if (grant !== "password") {
      return json(400, { error: "unsupported_grant_type", error_description: "Unsupported grant type." });
    }
    return json(200, await asService((c) => signIn(c, b.email, b.password, ua)));
  } catch (err) {
    if (!(err instanceof AuthError)) options.log?.("sign-in failed:", err?.stack ?? err);
    return fail(err);
  }
}

/** GET /auth/v1/user — who the bearer token says you are. */
export async function handleUser(request, options = {}) {
  try {
    const token = bearer(request);
    if (!token) return json(401, { error: "unauthorized", message: "Not signed in." });
    const verified = await verifyToken(token, options);
    return json(200, await asService((c) => currentUser(c, verified.subject)));
  } catch (err) {
    if (err?.status === 401 || err?.name === "AuthError") {
      return json(401, { error: "unauthorized", message: "Not signed in." });
    }
    options.log?.("user lookup failed:", err?.stack ?? err);
    return json(401, { error: "unauthorized", message: "Not signed in." });
  }
}

/** POST /auth/v1/logout — retire the refresh token, if one was sent. */
export async function handleLogout(request, options = {}) {
  try {
    const b = await body(request);
    await asService((c) => signOut(c, b.refresh_token));
  } catch (err) {
    /* Signing out is not allowed to fail in a way the browser must handle:
       it has already discarded the session locally by the time this
       returns, and a 500 here would leave a confusing error on a screen
       the person is walking away from. */
    options.log?.("sign-out failed:", err?.stack ?? err);
  }
  return { status: 204 };
}
