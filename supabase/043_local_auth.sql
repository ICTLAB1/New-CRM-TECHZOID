-- Sign-in without an identity provider.
--
-- WHY. The data, the files and the API are on Azure. The password check was
-- the last call still made to Supabase, and Supabase is paused -- so nobody
-- can get in to a CRM that is otherwise entirely here. This gives the API
-- what it needs to check a password itself.
--
-- The shape is Supabase's on purpose. `auth.users` keeps the column names
-- GoTrue used, and the tokens the API issues carry `sub` and
-- `role: authenticated` -- because all 89 policies read `auth.uid()` and
-- `auth.role()`, and those read exactly those claims. Nothing downstream
-- learns that the issuer changed.
--
-- Ported from techzoid-oms, where this design is already running.

-- ── the password, and the two reasons an account may not sign in ──────
--
-- `encrypted_password` is bcrypt, which is what Supabase stored too. That
-- is why the format matters: a hash copied out of GoTrue verifies here
-- unchanged, so nobody has to choose a new password just because the
-- server did.
alter table auth.users add column if not exists encrypted_password text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;

-- ── refresh tokens ────────────────────────────────────────────────────
--
-- Stored as a SHA-256 of the token, never the token. A refresh token is a
-- password that lasts a fortnight; a database backup that leaks them is a
-- fortnight of silent access to every account.
--
-- `revoked_at` rather than a delete, so a rotated token can be recognised
-- as used rather than merely absent -- the difference between "this is an
-- old token" and "this token was never issued" is what makes replay
-- visible at all.
create table if not exists auth.refresh_tokens (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  token_hash  bytea not null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  user_agent  text
);

create unique index if not exists refresh_tokens_hash_idx on auth.refresh_tokens (token_hash);
create index if not exists refresh_tokens_user_idx on auth.refresh_tokens (user_id) where revoked_at is null;

-- ── password recovery ─────────────────────────────────────────────────
create table if not exists auth.recovery_tokens (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  token_hash  bytea not null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create unique index if not exists recovery_tokens_hash_idx on auth.recovery_tokens (token_hash);

-- ── who may read any of this ──────────────────────────────────────────
--
-- Nobody, from a browser. These tables are the API tier's alone: the anon
-- and authenticated roles are not granted on them at all, so even a flaw
-- in the translator cannot reach a password hash through /api/q, which
-- runs as those roles and only ever sees what they are granted.
revoke all on auth.refresh_tokens from public;
revoke all on auth.recovery_tokens from public;
