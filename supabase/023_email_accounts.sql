-- 023 — many mailboxes, across many domains.
--
-- WHAT WAS WRONG. `ms_mail_accounts` is keyed `user_id primary key`: one
-- mailbox per person, full stop. A company selling licensing from India and
-- the UAE sends as sales@company.in, sales@company.ae, procurement@ and
-- it@ — shared inboxes that several people send from, and one person who
-- sends from more than one. None of that fits one row per user.
--
-- BACKWARD COMPATIBILITY IS THE WHOLE DESIGN. `ms_mail_accounts` is NOT
-- dropped and NOT altered. Mailboxes already connected keep working through
-- the existing code on the existing table while this one fills up beside it.
-- A migration that invalidates every live OAuth token is a migration that
-- silently stops every quotation email in the company, and the first anyone
-- knows is a customer asking where their quote went.
--
-- Existing rows are copied in below, so nobody has to reconnect.
--
-- SCHEMA CHANGE: two new tables. Nothing existing is touched. Safe to re-run.

create extension if not exists pgcrypto;

-- ── a sending domain ──────────────────────────────────────────────────
create table if not exists public.email_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  label text not null default '',

  -- §10. Filled by the domain-health check, never typed in by hand: these
  -- are facts about DNS, and a stale hand-entered "yes we have DKIM" is
  -- worse than no answer at all.
  spf_status text not null default 'unknown'
    check (spf_status in ('unknown','pass','warn','fail')),
  dkim_status text not null default 'unknown'
    check (dkim_status in ('unknown','pass','warn','fail')),
  dmarc_status text not null default 'unknown'
    check (dmarc_status in ('unknown','pass','warn','fail')),
  mx_status text not null default 'unknown'
    check (mx_status in ('unknown','pass','warn','fail')),
  -- What the lookup actually saw, so the screen can explain a WARN rather
  -- than just colour it amber.
  health_detail jsonb not null default '{}'::jsonb,
  health_checked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_domains_key on public.email_domains (lower(domain));

-- ── a mailbox somebody can send from ──────────────────────────────────
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid references public.email_domains (id) on delete set null,

  email text not null,
  display_name text not null default '',
  provider text not null default 'microsoft' check (provider in ('microsoft','smtp','resend')),

  -- WHO OWNS THE CONSENT. The person whose Microsoft account granted the
  -- OAuth. Graph sends as them, so this is not decoration — it is whose
  -- mailbox is actually being used and who must reconnect when it expires.
  connected_by uuid not null references public.profiles (id) on delete cascade,

  -- The refresh token. Never readable by any client: there is no select
  -- policy that returns it (see the view below), and the server holds the
  -- service role. Encryption at rest is Azure/Supabase disk-level today; an
  -- application-level envelope goes here when the key management for it
  -- exists, and pretending otherwise in a comment would be worse than the
  -- gap itself.
  refresh_token text,

  -- 'ok' | 'expired' | 'revoked' | 'error'. Set by the sender when a refresh
  -- fails, so Settings can say "reconnect this one" instead of every send
  -- failing quietly.
  status text not null default 'ok' check (status in ('ok','expired','revoked','error')),
  status_detail text not null default '',
  last_ok_at timestamptz,

  -- §11. Sending safety, per mailbox rather than global: Microsoft's own
  -- limits are per mailbox, so a shared sales@ and one person's inbox
  -- cannot sensibly share a budget.
  daily_limit integer not null default 200 check (daily_limit >= 0),
  hourly_limit integer not null default 30 check (hourly_limit >= 0),

  -- Exactly one default sender, enforced by the partial index below.
  is_default boolean not null default false,
  -- Withdrawn without being deleted, so the audit log still resolves it.
  disabled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_accounts_key on public.email_accounts (lower(email));
create index if not exists email_accounts_domain_idx on public.email_accounts (domain_id);
create index if not exists email_accounts_owner_idx  on public.email_accounts (connected_by);

-- ONE DEFAULT, ENFORCED BY THE DATABASE. Doing this in the application means
-- two people setting a default at once leaves two, and then "which mailbox
-- did that go out from" has no answer.
create unique index if not exists email_accounts_one_default
  on public.email_accounts ((true)) where is_default and disabled_at is null;

-- ── carry the existing connections over ───────────────────────────────
-- Nobody reconnects. The old table keeps working; this simply mirrors what
-- is already in it so the new screens show the same mailboxes.
insert into public.email_accounts (email, display_name, connected_by, refresh_token, provider, last_ok_at)
select m.ms_email, m.ms_display_name, m.user_id, m.refresh_token, 'microsoft', m.connected_at
from public.ms_mail_accounts m
where m.ms_email <> ''
  and not exists (select 1 from public.email_accounts a where lower(a.email) = lower(m.ms_email))
on conflict do nothing;

-- Give each carried-over mailbox its domain.
insert into public.email_domains (domain)
select distinct lower(split_part(a.email, '@', 2))
from public.email_accounts a
where split_part(a.email, '@', 2) <> ''
on conflict do nothing;

update public.email_accounts a
set domain_id = d.id
from public.email_domains d
where a.domain_id is null
  and lower(split_part(a.email, '@', 2)) = lower(d.domain);

-- ── who may see what ──────────────────────────────────────────────────
alter table public.email_domains  enable row level security;
alter table public.email_accounts enable row level security;

-- Domains and their health are a shared operational picture: a salesperson
-- choosing a sender needs to know the domain's DKIM is failing. No secrets
-- live here.
drop policy if exists "email_domains_read" on public.email_domains;
create policy "email_domains_read" on public.email_domains for select
  to authenticated using (true);

drop policy if exists "email_domains_write" on public.email_domains;
create policy "email_domains_write" on public.email_domains for all
  to authenticated
  using (public.is_privileged()) with check (public.is_privileged());

-- THE REFRESH TOKEN IS THE REASON THIS POLICY IS NARROW. Postgres has no
-- column-level RLS, so any select policy here exposes every column to
-- whoever it admits. Rather than let the whole team read each other's
-- tokens, the table itself is readable only by the mailbox's own owner and
-- by Admins/Managers — and the app reads the token-free VIEW below instead.
drop policy if exists "email_accounts_read_own" on public.email_accounts;
create policy "email_accounts_read_own" on public.email_accounts for select
  to authenticated
  using (connected_by = auth.uid() or public.is_privileged());

drop policy if exists "email_accounts_manage_own" on public.email_accounts;
create policy "email_accounts_manage_own" on public.email_accounts for all
  to authenticated
  using (connected_by = auth.uid() or public.is_privileged())
  with check (connected_by = auth.uid() or public.is_privileged());

-- ── what the app actually reads ───────────────────────────────────────
-- Every column except the secret. `security_invoker` makes the view run as
-- the caller, so the policies above still apply — without it a view is a
-- hole straight through RLS.
create or replace view public.email_accounts_safe
with (security_invoker = true) as
select a.id, a.domain_id, a.email, a.display_name, a.provider,
       a.connected_by, a.status, a.status_detail, a.last_ok_at,
       a.daily_limit, a.hourly_limit, a.is_default, a.disabled_at,
       a.created_at, a.updated_at,
       d.domain,
       d.spf_status, d.dkim_status, d.dmarc_status, d.mx_status,
       d.health_checked_at
from public.email_accounts a
left join public.email_domains d on d.id = a.domain_id;

grant select on public.email_accounts_safe to authenticated;

revoke all on table public.email_accounts from anon;
revoke all on table public.email_domains  from anon;
revoke all on public.email_accounts_safe  from anon;
