-- Purchase orders: what the company buys, rather than what it sells.
--
-- SCHEMA CHANGE: adds one table with the same shape and the same four
-- policies as `quotes`. Nothing else is touched and no data is deleted.
-- Safe to re-run.
--
-- Its own table rather than a flag on `quotes`, because the two face
-- opposite directions: a quotation is issued BY the company TO a customer,
-- a purchase order is issued BY the company TO a supplier. Mixing them
-- would put suppliers in the sales pipeline and count money the company
-- owes as money it is owed, on every dashboard and report.
--
-- `customer_id` is nullable and means something different here: it is set
-- only when the goods are drop-shipped to an end customer, so a purchase
-- order can be traced to the sale it was raised for. Most orders ship to
-- the company's own address and leave it null.

create table if not exists public.purchase_orders (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  customer_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The same rule as every other per-record table: you can touch a row if you
-- own it, or if you are Admin/Manager.
do $$
begin
  execute 'alter table public.purchase_orders enable row level security';

  execute 'drop policy if exists "purchase_orders_select" on public.purchase_orders';
  execute 'create policy "purchase_orders_select" on public.purchase_orders for select
    using (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "purchase_orders_insert" on public.purchase_orders';
  execute 'create policy "purchase_orders_insert" on public.purchase_orders for insert
    with check (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "purchase_orders_update" on public.purchase_orders';
  execute 'create policy "purchase_orders_update" on public.purchase_orders for update
    using (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "purchase_orders_delete" on public.purchase_orders';
  execute 'create policy "purchase_orders_delete" on public.purchase_orders for delete
    using (owner_id = auth.uid() or public.is_privileged())';
end $$;

create index if not exists purchase_orders_owner_idx on public.purchase_orders (owner_id);

-- Live sync, same as every other table the app subscribes to.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'purchase_orders'
  ) then
    alter publication supabase_realtime add table public.purchase_orders;
  end if;
end $$;
