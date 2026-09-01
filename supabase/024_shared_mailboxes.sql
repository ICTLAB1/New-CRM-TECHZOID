-- 024 — letting somebody send from a mailbox they did not connect.
--
-- THE GAP THIS CLOSES. 023 tied a mailbox to the person whose Microsoft
-- account granted the OAuth, which is correct — Graph sends as them. But it
-- means only that one person can see or use it, and a shared sales@ or
-- procurement@ exists precisely so several people can. Without this, one
-- person connects the shared inbox and nobody else can send from it.
--
-- WHAT A GRANT IS AND IS NOT. It says "this person may SEND from this
-- mailbox". It does not hand over the refresh token, which stays unreadable
-- to everyone but the owner and Admins (023's narrow select policy, and the
-- token-free view). The actual send happens server-side with the service
-- role, which checks the grant before it uses anybody's token.
--
-- SCHEMA CHANGE: one table, one view replaced. Nothing existing is touched.
-- Safe to re-run.

create table if not exists public.email_account_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists email_account_grants_key
  on public.email_account_grants (account_id, profile_id);
create index if not exists email_account_grants_profile_idx
  on public.email_account_grants (profile_id);

alter table public.email_account_grants enable row level security;

-- WHO MAY GRANT: the mailbox's owner, or an Admin/Manager. Deliberately NOT
-- anyone already granted — otherwise one grant spreads through the company
-- without the owner ever knowing, and "who can send as procurement@" stops
-- having an answer.
create or replace function public.may_manage_email_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.email_accounts a
    where a.id = p_account_id
      and (a.connected_by = auth.uid() or public.is_privileged())
  );
$$;

-- Revoked from anon BY NAME. `revoke ... from public` leaves Supabase's
-- default grant to the real role `anon` in place — the mistake 019 exists to
-- close and 021 repeated.
revoke all on function public.may_manage_email_account(uuid) from public, anon;
grant execute on function public.may_manage_email_account(uuid) to authenticated;

drop policy if exists "email_account_grants_read" on public.email_account_grants;
create policy "email_account_grants_read" on public.email_account_grants for select
  to authenticated
  using (profile_id = auth.uid() or public.may_manage_email_account(account_id));

drop policy if exists "email_account_grants_write" on public.email_account_grants;
create policy "email_account_grants_write" on public.email_account_grants for all
  to authenticated
  using (public.may_manage_email_account(account_id))
  with check (public.may_manage_email_account(account_id));

revoke all on table public.email_account_grants from anon;

-- ── the sender list a person actually sees ────────────────────────────
-- Replaces 023's view: same columns, plus mailboxes granted to the caller.
-- Still `security_invoker`, so email_accounts' own policy applies underneath
-- — and still no refresh_token column, because Postgres has no column-level
-- RLS and a view is the only way to hand out some columns and not others.
-- THE FUNCTION FIRST. my_sending_accounts() returns `setof
-- email_accounts_safe`, which makes it depend on the view — so dropping the
-- view while it exists fails with "other objects depend on it" and the
-- migration stops being safe to re-run. Every other migration in this repo
-- is; found by running this one twice.
drop function if exists public.my_sending_accounts();
drop view if exists public.email_accounts_safe;
create view public.email_accounts_safe
with (security_invoker = true) as
select a.id, a.domain_id, a.email, a.display_name, a.provider,
       a.connected_by, a.status, a.status_detail, a.last_ok_at,
       a.daily_limit, a.hourly_limit, a.is_default, a.disabled_at,
       a.created_at, a.updated_at,
       d.domain, d.spf_status, d.dkim_status, d.dmarc_status, d.mx_status,
       d.health_checked_at,
       (a.connected_by = auth.uid()) as is_mine
from public.email_accounts a
left join public.email_domains d on d.id = a.domain_id;

grant select on public.email_accounts_safe to authenticated;
revoke all on public.email_accounts_safe from anon;

-- WHY A FUNCTION RATHER THAN WIDENING THE POLICY. Letting `email_accounts`
-- be selected by anyone holding a grant would expose the refresh_token
-- column to them too — RLS is per row, not per column. This returns only the
-- safe columns and is the one thing a granted user calls.
create or replace function public.my_sending_accounts()
returns setof public.email_accounts_safe
language sql
stable
security definer
set search_path = public
as $$
  select v.*
  from public.email_accounts_safe v
  where v.disabled_at is null
    and (
      v.connected_by = auth.uid()
      or public.is_privileged()
      or exists (select 1 from public.email_account_grants g
                 where g.account_id = v.id and g.profile_id = auth.uid())
    );
$$;

revoke all on function public.my_sending_accounts() from public, anon;
grant execute on function public.my_sending_accounts() to authenticated;
