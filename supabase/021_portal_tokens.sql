-- 021 — the link a customer follows to see their own quotes.
--
-- WHAT THIS OPENS. Everything else in this CRM is behind a sign-in. This is
-- not: a customer follows a link out of an email and sees their documents
-- with no account and no password. That is the point of it — a purchase
-- manager will not create an account to look at a quotation — and it is also
-- the whole of the risk, so the design is deliberately narrow:
--
--   · The link is a random 32-byte secret. It is NEVER STORED. Only its
--     SHA-256 is, so this table leaking does not hand anybody a working link,
--     and no server log can ever contain one.
--   · One link is one customer. There is no link that sees two customers,
--     and no link that can be edited into one.
--   · It expires, and it can be revoked the moment somebody leaves a job.
--   · The `anon` key cannot read this table, or the documents behind it, at
--     all — RLS here grants nothing to anon, and the portal endpoint runs on
--     the server with the service role. A customer's browser never talks to
--     the database.
--
-- SCHEMA CHANGE: one table, two indexes, four policies. Nothing existing is
-- touched. Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.portal_tokens (
  id uuid primary key default gen_random_uuid(),

  -- Whose documents this link shows. Cascade: deleting a customer must not
  -- leave a live link pointing at a hole.
  customer_id text not null references public.customers (id) on delete cascade,

  -- SHA-256 of the secret, lowercase hex, 64 characters. The secret itself
  -- exists in exactly one place: the link the salesperson copied.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  -- Who it was issued to, for the salesperson's own benefit — "Ravi in
  -- purchasing" — so revoking the right one later is possible. Never shown
  -- to the customer.
  label text not null default '',

  -- Always set. A portal link with no expiry is a credential with no end,
  -- and these get forwarded inside customer companies.
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  -- Whether the customer ever actually opened it. A quote that was never
  -- looked at and a quote that was read four times are different sales
  -- situations, and this is the cheapest possible way to tell them apart.
  last_seen_at timestamptz,
  view_count integer not null default 0
);

-- The portal endpoint's only lookup: hash → row. Unique already indexes it;
-- this one is for the staff-facing list on a customer.
create index if not exists portal_tokens_customer_idx
  on public.portal_tokens (customer_id, created_at desc);

alter table public.portal_tokens enable row level security;

-- Who may manage a customer's links is exactly who may manage the customer:
-- the owner, or an Admin/Manager. Expressed by looking at the customer row
-- rather than duplicating the rule, so the two cannot drift apart.
create or replace function public.may_manage_customer(p_customer_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer_id
      and (c.owner_id = auth.uid() or public.is_privileged())
  );
$$;

revoke all on function public.may_manage_customer(text) from public;
grant execute on function public.may_manage_customer(text) to authenticated;

-- Note what is absent from all four: any grant to `anon`. `to authenticated`
-- is not decoration — without it a policy is evaluated for anon too, and
-- auth.uid() being null there is a thinner defence than simply not applying.
drop policy if exists "portal_tokens_select" on public.portal_tokens;
create policy "portal_tokens_select" on public.portal_tokens for select
  to authenticated
  using (public.may_manage_customer(customer_id));

drop policy if exists "portal_tokens_insert" on public.portal_tokens;
create policy "portal_tokens_insert" on public.portal_tokens for insert
  to authenticated
  with check (public.may_manage_customer(customer_id) and created_by = auth.uid());

-- UPDATE exists for one reason: revoking.
--
-- The `with check` here is NOT what stops a link being repointed, and it is
-- worth saying so, because the first version of this file claimed it was and
-- a test proved otherwise. A policy sees only the row being written, so an
-- Admin — who satisfies may_manage_customer() for every customer — passed
-- both halves while moving a live link from one account to another. RLS
-- cannot express "this column may not change"; a trigger can, and does,
-- immediately below.
drop policy if exists "portal_tokens_update" on public.portal_tokens;
create policy "portal_tokens_update" on public.portal_tokens for update
  to authenticated
  using (public.may_manage_customer(customer_id))
  with check (public.may_manage_customer(customer_id));

-- What a link points at is decided once, when it is issued.
--
-- A link that is already in a customer's inbox must keep meaning what it
-- meant when it was sent. Repointing one is not an operation anybody needs:
-- the way to show a different customer their documents is to issue that
-- customer their own link. Pinning the secret too means a row cannot be
-- turned into a link somebody already knows.
--
-- Enforced in a trigger rather than a policy so it holds for the SERVICE
-- ROLE as well — which is the role the portal endpoint itself runs as, and
-- which bypasses RLS entirely.
create or replace function public.portal_tokens_pin_identity()
returns trigger
language plpgsql
as $$
begin
  if new.customer_id is distinct from old.customer_id
     or new.token_hash is distinct from old.token_hash
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A portal link cannot be repointed. Revoke it and issue a new one.';
  end if;
  return new;
end;
$$;

drop trigger if exists portal_tokens_pin_identity on public.portal_tokens;
create trigger portal_tokens_pin_identity
  before update on public.portal_tokens
  for each row execute function public.portal_tokens_pin_identity();

drop policy if exists "portal_tokens_delete" on public.portal_tokens;
create policy "portal_tokens_delete" on public.portal_tokens for delete
  to authenticated
  using (public.may_manage_customer(customer_id));

-- Belt and braces over RLS: anon holds no table privilege here at all, so a
-- future policy written without `to authenticated` still cannot expose it.
revoke all on table public.portal_tokens from anon;
