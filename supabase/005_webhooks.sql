-- Outbound webhooks: notify the company's own website when a deal moves.
--
-- SCHEMA CHANGE: adds two tables and one function. Nothing else is touched,
-- and no existing table, column or policy changes. Safe to re-run.
--
-- The endpoint URL and the on/off switch live in the existing `settings`
-- row (settings.data.webhook), read by everyone signed in and written only
-- by an Admin/Manager — exactly like every other document/company setting.
-- The SIGNING SECRET does not: it is what proves a delivery genuinely came
-- from this CRM, so it must never be readable by a client, only by the
-- Netlify function that signs deliveries (via the service role, which
-- bypasses RLS). It lives in its own table with no client-facing policy at
-- all, and is shown to an admin exactly once, at the moment it is
-- generated — the same "masked hint, never a value" rule already used for
-- the Microsoft OAuth secret on the diagnostics screen.

create table if not exists public.webhook_secrets (
  id text primary key default 'main',
  secret text not null default '',
  rotated_at timestamptz not null default now()
);

-- No policy grants any access. Not even an Admin's own client can select
-- from this table — only the service role, which bypasses RLS, and the
-- regenerate function below (security definer, itself gated to an Admin).
alter table public.webhook_secrets enable row level security;

-- A short, readable history of what was sent, so an admin can tell whether
-- their website is actually receiving events without needing server logs.
-- Written only by the service role (the delivery function); never carries
-- the signing secret or the destination's response body, only what is safe
-- to show on a settings screen.
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  event_kind text not null,
  status text not null default 'pending' check (status in ('delivered', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

alter table public.webhook_deliveries enable row level security;

drop policy if exists "webhook_deliveries_select_privileged" on public.webhook_deliveries;
create policy "webhook_deliveries_select_privileged" on public.webhook_deliveries for select
  using (public.is_privileged());

create index if not exists webhook_deliveries_created_idx on public.webhook_deliveries (created_at desc);

-- pgcrypto supplies gen_random_bytes(), used below for a secret with real
-- entropy — gen_random_uuid() alone is not built for this (it does not
-- promise cryptographic randomness, and 16 bytes formatted as a UUID
-- carries version/variant bits that are not part of the secret).
create extension if not exists pgcrypto;

-- Generates a brand-new signing secret, stores it, and returns the
-- PLAINTEXT once — this is the only moment it is ever readable, by anyone,
-- including the admin who just generated it. Calling it again immediately
-- invalidates the previous secret, exactly like rotating an API key
-- anywhere else: the old one stops working the moment a new one exists.
-- `extensions` is in the search path as well as `public` because Supabase
-- installs pgcrypto there rather than into public, and gen_random_bytes()
-- below lives in it.
create or replace function public.regenerate_webhook_secret()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can regenerate the webhook signing secret';
  end if;

  v_secret := encode(gen_random_bytes(32), 'hex');

  insert into public.webhook_secrets (id, secret, rotated_at)
  values ('main', v_secret, now())
  on conflict (id) do update set secret = excluded.secret, rotated_at = excluded.rotated_at;

  return v_secret;
end;
$$;
