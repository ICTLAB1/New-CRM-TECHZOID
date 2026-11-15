-- The product catalog's buying prices, out of reach of the people who sell.
--
-- SCHEMA CHANGE: adds one table, MOVES the cost figures out of the settings
-- row into it, and leaves the catalog itself where it is. No product is
-- deleted and no selling price is touched. Safe to re-run: the copy is
-- `on conflict do nothing`, so a second run cannot overwrite a cost with
-- the zero the first run left behind.
--
-- WHAT WAS WRONG. The catalog lives in `settings.data.productCatalog`, and
-- every member of the company may read the settings row — that is what
-- settings_select_member says, and it has to, because the row also holds
-- the company's letterhead, the document template and the numbering the
-- whole app needs. Each product in that array carried `costPrice` and a
-- `vendorPrices` list. So every salesperson's browser was downloading what
-- the company pays each distributor for every SKU, on every page load.
-- Nothing in the UI showed it to them; the API handed it over on request,
-- which is the only thing that counts.
--
-- This is the same hole the price book was built to close for its own
-- data — see 056_price_book.sql, where cost lives in a table a Sales user
-- cannot select from, and the uncosted search is a separate function. The
-- catalog is the older, parallel list and was never moved.
--
-- WHY A SEPARATE TABLE RATHER THAN A POLICY. Row-level security decides
-- rows, not keys inside a jsonb document; there is no way to hand the same
-- settings row to two people with one field missing. The cost has to live
-- somewhere a policy can refuse.

create table if not exists public.catalog_costs (
  company_id uuid not null references public.companies (id) on delete cascade,
  /* The catalog product's own id, as the settings array carries it. Not
     the SKU: a catalog may hold the same SKU on two terms, and the id is
     what the browser already has in hand when it needs the cost. */
  product_id text not null,
  cost numeric(14, 4) not null default 0,
  /* What each distributor charges, and until when — see
     src/domain/catalog/vendors.ts. The shape is the app's; this table only
     keeps it out of the settings row. */
  vendor_prices jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (company_id, product_id)
);

do $$
begin
  execute 'alter table public.catalog_costs enable row level security';

  /* ADMIN AND MANAGER ONLY, on every command. is_privileged_in() is the
     same answer the price book's tables use, so there is one definition of
     "may see what we pay" in the schema rather than two that can drift. */
  execute 'drop policy if exists catalog_costs_select on public.catalog_costs';
  execute 'create policy catalog_costs_select on public.catalog_costs for select
    to authenticated
    using (public.is_privileged_in(company_id))';

  execute 'drop policy if exists catalog_costs_insert on public.catalog_costs';
  execute 'create policy catalog_costs_insert on public.catalog_costs for insert
    to authenticated
    with check (public.is_privileged_in(company_id))';

  execute 'drop policy if exists catalog_costs_update on public.catalog_costs';
  execute 'create policy catalog_costs_update on public.catalog_costs for update
    to authenticated
    using (public.is_privileged_in(company_id))
    with check (public.is_privileged_in(company_id))';

  execute 'drop policy if exists catalog_costs_delete on public.catalog_costs';
  execute 'create policy catalog_costs_delete on public.catalog_costs for delete
    to authenticated
    using (public.is_privileged_in(company_id))';
end $$;

/* ── the row that belongs to nobody ──────────────────────────────────
   One settings row predates 033_companies.sql and carries no company at
   all, and settings_select_member hands it to ANY signed-in user:
   `company_id is null or public.is_member(company_id)`. So a catalog left
   in it leaks further than the one this migration is closing — not just to
   a company's own salespeople but to every account on the system.

   It cannot be keyed by company, because it has none, and its figures are
   not this migration's to throw away. They go here instead: RLS on, no
   policy at all, and the grant taken back from both browser roles. There
   is no query any client can write that reaches this table. Whoever needs
   the numbers back reads them with the service role and files them under a
   company. */
create table if not exists public.catalog_costs_orphaned (
  settings_id text not null,
  product_id text not null,
  cost numeric(14, 4) not null default 0,
  vendor_prices jsonb not null default '[]'::jsonb,
  moved_at timestamptz not null default now(),
  primary key (settings_id, product_id)
);
alter table public.catalog_costs_orphaned enable row level security;
revoke all on table public.catalog_costs_orphaned from anon;
revoke all on table public.catalog_costs_orphaned from authenticated;

grant select, insert, update, delete on table public.catalog_costs to authenticated;

/* Named, not inherited. Supabase's default privileges DID hand `anon` a
   grant on this table the moment it was created, and `revoke from public`
   would not take it back, because anon is a real role holding a real
   grant. The policies above admit only `authenticated`, so an anon request
   gets nothing either way — but a grant nobody revoked is a grant waiting
   for a policy someone widens. */
revoke all on table public.catalog_costs from anon;

/* ── the move ────────────────────────────────────────────────────────
   Copy first, strip second, in this one transaction. A failure between
   them would otherwise lose the numbers outright. */

insert into public.catalog_costs (company_id, product_id, cost, vendor_prices)
select
  s.company_id,
  item ->> 'id',
  coalesce(nullif(item ->> 'costPrice', '')::numeric, 0),
  case when jsonb_typeof(item -> 'vendorPrices') = 'array'
       then item -> 'vendorPrices' else '[]'::jsonb end
from public.settings s
cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
where s.company_id is not null
  and jsonb_typeof(s.data -> 'productCatalog') = 'array'
  and coalesce(item ->> 'id', '') <> ''
  /* Nothing to protect in a product with no cost on it, and skipping those
     keeps a re-run from writing a row of zeros over a real figure. */
  and (coalesce(nullif(item ->> 'costPrice', '')::numeric, 0) <> 0
       or jsonb_array_length(coalesce(nullif(item -> 'vendorPrices', 'null'::jsonb), '[]'::jsonb)) > 0)
on conflict (company_id, product_id) do nothing;

insert into public.catalog_costs_orphaned (settings_id, product_id, cost, vendor_prices)
select
  s.id,
  item ->> 'id',
  coalesce(nullif(item ->> 'costPrice', '')::numeric, 0),
  case when jsonb_typeof(item -> 'vendorPrices') = 'array'
       then item -> 'vendorPrices' else '[]'::jsonb end
from public.settings s
cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
where s.company_id is null
  and jsonb_typeof(s.data -> 'productCatalog') = 'array'
  and coalesce(item ->> 'id', '') <> ''
  and (coalesce(nullif(item ->> 'costPrice', '')::numeric, 0) <> 0
       or jsonb_array_length(coalesce(nullif(item -> 'vendorPrices', 'null'::jsonb), '[]'::jsonb)) > 0)
on conflict (settings_id, product_id) do nothing;

/* And out of the settings row. `costPrice` is set to 0 rather than removed:
   every client in the field expects the key to be there, and a missing
   number reads as NaN on a screen somebody is using right now. The browser
   fills the real figure back in for whoever is allowed it — see
   src/data/catalogCosts.ts. */
update public.settings s
set data = jsonb_set(
  s.data,
  '{productCatalog}',
  (
    select coalesce(
      jsonb_agg((item - 'vendorPrices') || jsonb_build_object('costPrice', 0) order by ord),
      '[]'::jsonb
    )
    from jsonb_array_elements(s.data -> 'productCatalog') with ordinality as t(item, ord)
  )
)
where jsonb_typeof(s.data -> 'productCatalog') = 'array'
  and exists (
    select 1
    from jsonb_array_elements(s.data -> 'productCatalog') as item
    where coalesce(nullif(item ->> 'costPrice', '')::numeric, 0) <> 0
       or jsonb_typeof(item -> 'vendorPrices') = 'array'
  );

/* Both halves of the move are above, in one transaction: a company's
   costs into catalog_costs, the company-less row's into the table no client
   can reach, and only then the strip. */
