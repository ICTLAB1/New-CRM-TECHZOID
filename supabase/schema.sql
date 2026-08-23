-- TechZoid CRM — Supabase schema (v2: per-owner data isolation)
-- Run this in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- If you previously ran the v1 schema (a single "workspace" blob table),
-- this replaces that design entirely -- drop the old table first:
drop table if exists public.workspace cascade;

-- ============================================================
-- 1) profiles — one row per teammate: name, role, e-mail.
--    Logins live in Supabase's built-in auth.users; this table
--    carries the CRM-specific info the app needs to display.
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'Sales' check (role in ('Admin', 'Manager', 'Sales')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated" on public.profiles for select
  using (auth.role() = 'authenticated');

-- ============================================================
-- Helper functions used by every policy below, so a Sales login
-- only ever sees rows it owns, while Admin/Manager see everything.
-- ============================================================
create or replace function public.is_privileged()
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('Admin', 'Manager')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  );
$$;

-- A user may edit their own profile, and an Admin may edit anyone's. The
-- `with check` clause is what stops a Sales user promoting themselves: a role
-- change is permitted only when the caller is an Admin, otherwise the role
-- being written must equal the role already on the caller's own row.
--
-- Without this clause any authenticated user could set role = 'Admin' on
-- themselves and gain the whole workspace. This matches the policy currently
-- live in production.
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin()
    or role = (select p.role from public.profiles p where p.id = auth.uid())
  );

create policy "profiles_insert_self" on public.profiles for insert
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), new.email, 'Sales')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 2) settings — one shared row (company info, bank details,
--    numbering, default terms, quotation templates). Everyone
--    signed in can read it; only Admin/Manager can change it.
-- ============================================================
create table if not exists public.settings (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.settings (id, data) values ('main', '{}'::jsonb) on conflict (id) do nothing;

alter table public.settings enable row level security;

create policy "settings_select_authenticated" on public.settings for select
  using (auth.role() = 'authenticated');

create policy "settings_update_privileged" on public.settings for update
  using (public.is_privileged()) with check (public.is_privileged());

-- ============================================================
-- 3) Per-record tables. Each row is owned by one salesperson
--    (owner_id). All the business fields (the same camelCase
--    shape the app already uses — billName, items, terms, etc.)
--    live in the `data` jsonb column, so almost none of the
--    app's existing logic needs to change — only who can see
--    which rows changes, and that's enforced by Postgres itself.
-- ============================================================
create table if not exists public.customers (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  customer_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  customer_id text,
  quote_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.challans (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  order_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proformas (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  customer_id text,
  quote_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same four policies (select/insert/update/delete), same rule, for every table above:
-- you can touch a row if you own it, or if you're Admin/Manager.
do $$
declare t text;
begin
  foreach t in array array['customers', 'quotes', 'orders', 'challans', 'proformas'] loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists "%1$s_select" on public.%1$I;', t);
    execute format('create policy "%1$s_select" on public.%1$I for select
      using (owner_id = auth.uid() or public.is_privileged());', t);

    execute format('drop policy if exists "%1$s_insert" on public.%1$I;', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert
      with check (owner_id = auth.uid() or public.is_privileged());', t);

    execute format('drop policy if exists "%1$s_update" on public.%1$I;', t);
    execute format('create policy "%1$s_update" on public.%1$I for update
      using (owner_id = auth.uid() or public.is_privileged());', t);

    execute format('drop policy if exists "%1$s_delete" on public.%1$I;', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete
      using (owner_id = auth.uid() or public.is_privileged());', t);
  end loop;
end $$;

-- Helpful indexes
create index if not exists customers_owner_idx on public.customers (owner_id);
create index if not exists quotes_owner_idx on public.quotes (owner_id);
create index if not exists orders_owner_idx on public.orders (owner_id);
create index if not exists challans_owner_idx on public.challans (owner_id);
create index if not exists proformas_owner_idx on public.proformas (owner_id);

-- ============================================================
-- Live sync: without this, teammates' changes only appear after
-- a manual refresh. This adds every table the app subscribes to
-- onto Supabase's realtime publication (respects RLS automatically).
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['customers', 'quotes', 'orders', 'challans', 'proformas', 'settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;

