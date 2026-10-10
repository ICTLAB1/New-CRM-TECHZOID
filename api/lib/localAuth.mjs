/**
 * Checking a password, here, instead of asking an identity provider.
 *
 * Ported from techzoid-oms. The response shapes are GoTrue's, because the
 * browser still runs supabase-js and it reads these fields by name -- so
 * the only frontend change is which URL it is pointed at.
 */

import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, issue } from "./token.mjs";

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

const sha256 = (s) => createHash("sha256").update(s).digest();
const opaque = () => randomBytes(32).toString("base64url");

/* A real bcrypt hash of a password nobody has, at the usual cost. An
   unknown address must cost the same as a known one -- skip the comparison
   and the sign-in form becomes a directory of who has an account, timed
   from the outside by anyone. */
const DECOY = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function session(user, accessToken, claims, refreshToken) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: ACCESS_TTL_SECONDS,
    expires_at: claims.exp,
    user: {
      id: user.id,
      email: user.email,
      user_metadata: user.raw_user_meta_data ?? {},
      created_at: user.created_at ? new Date(user.created_at).toISOString() : null,
    },
  };
}

async function startSession(client, user, userAgent) {
  const { token: access, claims } = issue(user.id, user.email);
  const refresh = opaque();
  await client.query(
    `insert into auth.refresh_tokens (user_id, token_hash, expires_at, user_agent)
     values ($1, $2, now() + ($3 || ' days')::interval, $4)`,
    [user.id, sha256(refresh), String(REFRESH_TTL_DAYS), userAgent ?? null],
  );
  return session(user, access, claims, refresh);
}

/** Email and password in, a session out. */
export async function signIn(client, email, password, userAgent) {
  const { rows } = await client.query(
    `select id, email, encrypted_password, raw_user_meta_data, created_at,
            banned_until, deleted_at
       from auth.users where lower(email) = lower($1) limit 1`,
    [String(email ?? "").trim()],
  );
  const user = rows[0];

  /* EXACTLY ONE comparison, against the real hash or the decoy. Two for a
     known user would put back the timing difference the decoy removes. */
  const ok = await bcrypt.compare(String(password ?? ""), user?.encrypted_password || DECOY);

  /* One sentence for every failure. "No such account" and "wrong password"
     must be indistinguishable, or the form answers a question it was not
     asked. */
  if (!user || !ok || user.deleted_at) throw new AuthError("Invalid login credentials.", 400);
  if (user.banned_until && new Date(user.banned_until) > new Date()) {
    throw new AuthError("This account is suspended.", 403);
  }
  return startSession(client, user, userAgent);
}

/**
 * Exchange a refresh token for a new session, retiring the one used.
 *
 * Rotation matters more than it looks: without it, a refresh token copied
 * off a shared machine keeps working for a fortnight beside the real one
 * and nothing ever notices.
 */
export async function refresh(client, token, userAgent) {
  if (!token) throw new AuthError("No refresh token.", 400);
  const { rows } = await client.query(
    `select t.id, t.expires_at, t.revoked_at,
            u.id as user_id, u.email, u.raw_user_meta_data, u.created_at,
            u.deleted_at, u.banned_until
       from auth.refresh_tokens t
       join auth.users u on u.id = t.user_id
      where t.token_hash = $1 limit 1`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at) <= new Date() || row.deleted_at) {
    throw new AuthError("Invalid refresh token.", 400);
  }
  await client.query(`update auth.refresh_tokens set revoked_at = now() where id = $1`, [row.id]);
  return startSession(client, {
    id: row.user_id, email: row.email,
    raw_user_meta_data: row.raw_user_meta_data, created_at: row.created_at,
  }, userAgent);
}

/** Retire one refresh token. Signing out twice is not an error. */
export async function signOut(client, token) {
  if (!token) return;
  await client.query(
    `update auth.refresh_tokens set revoked_at = now()
      where token_hash = $1 and revoked_at is null`,
    [sha256(token)],
  );
}

/** The signed-in person, for GET /auth/v1/user. */
export async function currentUser(client, userId) {
  const { rows } = await client.query(
    `select id, email, raw_user_meta_data, created_at
       from auth.users where id = $1 and deleted_at is null limit 1`,
    [userId],
  );
  const u = rows[0];
  if (!u) throw new AuthError("Not signed in.", 401);
  return {
    id: u.id, email: u.email,
    user_metadata: u.raw_user_meta_data ?? {},
    created_at: u.created_at ? new Date(u.created_at).toISOString() : null,
  };
}

/** Set somebody's password. Used by the admin tooling, not by the browser. */
export async function setPassword(client, userId, password) {
  if (String(password ?? "").length < 8) {
    throw new AuthError("That password is too short.", 400);
  }
  const hash = await bcrypt.hash(String(password), 10);
  await client.query(`update auth.users set encrypted_password = $2 where id = $1`, [userId, hash]);
  /* Every existing session ends. Changing a password that somebody else
     knows is pointless if their refresh token outlives the change. */
  await client.query(
    `update auth.refresh_tokens set revoked_at = now()
      where user_id = $1 and revoked_at is null`, [userId]);
}
