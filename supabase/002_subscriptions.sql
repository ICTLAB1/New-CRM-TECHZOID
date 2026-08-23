-- TechZoid CRM — Subscription & Renewal module migration
-- Run this in Supabase Dashboard -> SQL Editor AFTER the main schema.sql has been run.
-- Safe to re-run: uses IF NOT EXISTS throughout.

-- ============================================================
-- subscriptions — one row per licence/subscription sold.
--   Same owner-based RLS pattern as all other entity tables.
-- ============================================================
create table if not exists public.subscriptions (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  customer_id text,
  order_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Same four RLS policies as every other entity table
do $$
begin
  execute 'drop policy if exists "subscriptions_select" on public.subscriptions;';
  execute 'create policy "subscriptions_select" on public.subscriptions for select
    using (owner_id = auth.uid() or public.is_privileged());';

  execute 'drop policy if exists "subscriptions_insert" on public.subscriptions;';
  execute 'create policy "subscriptions_insert" on public.subscriptions for insert
    with check (owner_id = auth.uid() or public.is_privileged());';

  execute 'drop policy if exists "subscriptions_update" on public.subscriptions;';
  execute 'create policy "subscriptions_update" on public.subscriptions for update
    using (owner_id = auth.uid() or public.is_privileged());';

  execute 'drop policy if exists "subscriptions_delete" on public.subscriptions;';
  execute 'create policy "subscriptions_delete" on public.subscriptions for delete
    using (owner_id = auth.uid() or public.is_privileged());';
end $$;

create index if not exists subscriptions_owner_idx on public.subscriptions (owner_id);
create index if not exists subscriptions_customer_idx on public.subscriptions (customer_id);

-- Add to realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subscriptions'
  ) then
    alter publication supabase_realtime add table public.subscriptions;
  end if;
end $$;
