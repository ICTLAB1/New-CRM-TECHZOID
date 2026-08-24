-- Tax invoices: the document that actually asks a customer for money.
--
-- SCHEMA CHANGE: adds one table with the same shape and the same four
-- policies as `quotes`. Nothing else is touched and no data is deleted.
-- Safe to re-run.
--
-- Until now a sale left the CRM at the proforma: "Send for invoicing"
-- emailed accounts and nothing came back, so what had been invoiced, what
-- had been paid and what was overdue lived outside the system. This is
-- where that comes back in.
--
-- `quote_id` carries the proforma or quotation an invoice was raised from,
-- so a customer query can be traced back to what was agreed.

create table if not exists public.invoices (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  customer_id text,
  quote_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  execute 'alter table public.invoices enable row level security';

  execute 'drop policy if exists "invoices_select" on public.invoices';
  execute 'create policy "invoices_select" on public.invoices for select
    using (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "invoices_insert" on public.invoices';
  execute 'create policy "invoices_insert" on public.invoices for insert
    with check (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "invoices_update" on public.invoices';
  execute 'create policy "invoices_update" on public.invoices for update
    using (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "invoices_delete" on public.invoices';
  execute 'create policy "invoices_delete" on public.invoices for delete
    using (owner_id = auth.uid() or public.is_privileged())';
end $$;

create index if not exists invoices_owner_idx on public.invoices (owner_id);
create index if not exists invoices_customer_idx on public.invoices (customer_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoices'
  ) then
    alter publication supabase_realtime add table public.invoices;
  end if;
end $$;
