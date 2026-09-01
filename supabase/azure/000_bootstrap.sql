-- Azure Database for PostgreSQL — bootstrap.
--
-- WHAT THIS IS FOR. Every migration in this repo was written against
-- Supabase, which supplies three things plain Postgres does not: the roles
-- `anon` / `authenticated` / `service_role`, an `auth` schema whose `uid()`
-- returns the signed-in user from a JWT claim, and a `storage` schema.
-- 89 row-level-security policies and 99 calls to auth.uid() depend on them.
--
-- THE WHOLE POINT OF THIS FILE is that those 22 migrations then run on Azure
-- **completely unchanged**. Rewriting 99 call sites by hand would be 99
-- chances to get an authorization rule subtly wrong, on the exact code that
-- decides who can read whose customers. Supplying the four things they
-- expect is a far smaller, far more reviewable surface.
--
-- HOW auth.uid() KNOWS WHO IS ASKING. Supabase's PostgREST sets a per-request
-- setting from the JWT. On Azure the API tier does the same thing explicitly:
-- it opens a transaction and issues
--
--     set local request.jwt.claim.sub  = '<the user id>';
--     set local request.jwt.claim.role = 'authenticated';
--     set local role authenticated;
--
-- before running the caller's query. `set local` is scoped to the
-- transaction, so a pooled connection cannot leak one user's identity into
-- the next request — which is the one mistake in this design that would be
-- catastrophic and silent.
--
-- Run this ONCE on a new Azure database, before schema.sql.

-- ── roles ─────────────────────────────────────────────────────────────
-- NOLOGIN on purpose: nothing connects as these. The API tier connects as
-- its own login role and switches into them per transaction.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- BYPASSRLS is what makes this role dangerous and what makes the
    -- server-side functions possible. It must never be reachable from a
    -- browser; only the API tier's trusted paths switch into it.
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto;

grant usage on schema public to anon, authenticated, service_role;
-- ANON NEEDS THIS TOO, and it is easy to talk yourself out of. Every policy
-- keyed on ownership calls auth.uid(), including when the caller is anon —
-- that is how it evaluates to NULL and matches nothing. EXECUTE on the
-- function is not enough on its own: it is only reachable through USAGE on
-- the schema that holds it, so without this an anonymous request fails with
-- "permission denied for schema auth" instead of quietly seeing no rows.
-- Granting usage exposes no data; auth.users is granted separately, and to
-- service_role only.
grant usage on schema auth   to anon, authenticated, service_role;

-- ── who is asking ─────────────────────────────────────────────────────
-- Reads the setting the API tier stamps on the transaction. Returns NULL
-- when nothing is set, which every policy already treats as "nobody" — an
-- unauthenticated request therefore matches no row rather than all of them.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.email', true), '');
$$;

grant execute on function auth.uid(), auth.role(), auth.email()
  to anon, authenticated, service_role;

-- ── auth.users ────────────────────────────────────────────────────────
-- public.profiles has a foreign key to auth.users(id), and dropping that FK
-- would let a profile exist for a user who does not. With Entra ID as the
-- identity provider this table is the local mirror: one row per person who
-- has ever signed in, written by the API tier on first sign-in.
--
-- Deliberately thin. Entra holds the password, the MFA and the lifecycle;
-- copying any of that here would create a second source of truth for
-- identity, which is how accounts get orphaned when somebody leaves.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null default '',
  -- The Entra object id (the `oid` claim). Stable for the life of the
  -- account and does not change when somebody's email or name does.
  entra_object_id text unique,
  /* SUPABASE-SHAPED ON PURPOSE. schema.sql installs a handle_new_user()
     trigger that reads `new.raw_user_meta_data ->> 'name'` to seed a
     profile. Found by running the real schema against this shim, where the
     insert failed outright. Keeping the column means that trigger — and any
     other code written against Supabase's shape — runs unchanged, which is
     the entire premise of this file. The API tier fills it from the Entra
     token's name claim on first sign-in. */
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create index if not exists users_email_idx on auth.users (lower(email));

-- BYPASSRLS IS NOT A GRANT. `service_role` skips row-level security, but
-- table privileges are checked first and separately — so without this the
-- API tier cannot create the auth.users row on somebody's first Entra
-- sign-in, and every new user fails with "permission denied for table
-- users". Supabase grants this; found here by trying to provision a user
-- against the shim and watching it refuse.
grant select, insert, update, delete on auth.users to service_role;

-- `authenticated` deliberately gets NOTHING on auth.users. Names, emails and
-- roles that the app legitimately shows live in public.profiles, which has
-- its own policy. The identity table is not a directory.

-- ── storage ───────────────────────────────────────────────────────────
-- Migrations 010 and 011 create policies against storage.objects. Attachments
-- themselves move to Azure Blob Storage, so these tables exist to keep those
-- migrations runnable and to hold the metadata; the bytes live in Blob.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null default '',
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id) on delete cascade,
  name text not null,
  owner uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists objects_bucket_name_idx on storage.objects (bucket_id, name);
alter table storage.objects enable row level security;

-- Supabase's helper, used by the attachment policies to read the first path
-- segment as an owner id. Same semantics.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

grant usage on schema storage to authenticated, service_role;
grant execute on function storage.foldername(text) to authenticated, service_role;

-- Same reasoning as auth.users: migrations 010 and 011 write RLS policies
-- against storage.objects, and a policy is only consulted once the table
-- privilege has already been granted.
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
grant insert, update, delete on storage.buckets to service_role;

-- ── realtime ──────────────────────────────────────────────────────────
-- Twelve migrations add their table to this publication. Azure has no
-- Supabase Realtime, and the replacement (Azure Web PubSub, fed by logical
-- decoding or by the API tier) still wants to know WHICH tables matter — so
-- the publication is kept as the list of them rather than deleted.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ── default privileges ────────────────────────────────────────────────
-- Supabase grants these automatically, and several migrations REVOKE from
-- anon on the assumption that the grant exists. Reproducing it keeps those
-- revokes meaningful rather than silently redundant.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
