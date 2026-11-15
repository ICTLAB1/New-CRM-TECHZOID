/*
 * THE TEST 058 EXISTS TO PASS: a salesperson calling the API directly
 * cannot get the product catalog's buying price, and nor can anybody at
 * another company.
 *
 * Not "cannot see it on the catalog screen". api/lib/query.mjs lets a
 * browser compose its own query over any table — it picks the table, the
 * columns, the filters and the order, and row-level security is the only
 * thing that decides whether anything comes back. The catalog used to carry
 * `costPrice` and `vendorPrices` inside settings.data.productCatalog, and
 * settings_select_member hands that row to every member of the company. So
 * the figures went down the wire on every page load, to everybody.
 *
 * This file runs the migration over a catalog shaped like the live one, then
 * asks for the cost by every route a browser has, under each role the API
 * tier can stamp on a request (set local role authenticated,
 * request.jwt.claim.sub). Every check RAISES if the rule is broken, so a
 * pass is silence and a failure cannot be mistaken for one.
 *
 *   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/proofs/058_catalog_costs_proof.sql
 *
 * Run it on a throwaway copy of the schema, never on the live database: it
 * writes a fixture and it runs the migration.
 */
\set ON_ERROR_STOP on

/* ── the fixture ────────────────────────────────────────────────────── */

/* The service role is how the CRM's own server-side jobs write, and
   profiles carries a trigger (041) that refuses a role change from anyone
   but an Admin or the service role. */
set request.jwt.claim.role = 'service_role';

insert into auth.users(id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-000000000001', 'cc-admin@t',   '{"name":"Admin"}'::jsonb),
  ('b0000000-0000-0000-0000-000000000002', 'cc-manager@t', '{"name":"Manager"}'::jsonb),
  ('b0000000-0000-0000-0000-000000000003', 'cc-sales@t',   '{"name":"Sales"}'::jsonb),
  ('b0000000-0000-0000-0000-000000000004', 'cc-rival@t',   '{"name":"Rival"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles(id, name, email, role) values
  ('b0000000-0000-0000-0000-000000000001', 'Admin',   'cc-admin@t',   'Admin'),
  ('b0000000-0000-0000-0000-000000000002', 'Manager', 'cc-manager@t', 'Manager'),
  ('b0000000-0000-0000-0000-000000000003', 'Sales',   'cc-sales@t',   'Sales'),
  ('b0000000-0000-0000-0000-000000000004', 'Rival',   'cc-rival@t',   'Admin')
on conflict (id) do update set role = excluded.role;

insert into public.companies(id, name) values
  ('c8000000-0000-0000-0000-00000000000a', 'Catalog Cost Test Co'),
  ('c8000000-0000-0000-0000-00000000000b', 'Rival Reseller Ltd')
on conflict (id) do nothing;

insert into public.company_members(company_id, user_id, role) values
  ('c8000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 'Admin'),
  ('c8000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000002', 'Manager'),
  ('c8000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000003', 'Sales'),
  ('c8000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000004', 'Admin')
on conflict (company_id, user_id) do update set role = excluded.role;

/* A catalog in the shape the live one is in before the migration: the cost
   on the product, a vendor list on some of them, and the selling price and
   the GST rate alongside — those must survive untouched.

   p1  a real cost and two distributors
   p2  a real cost, no vendor list at all
   p3  nothing to protect: zero cost, no vendors
   p4  no id, which no screen produces but a bad import can */
insert into public.settings(id, company_id, data) values
  ('cc-test-a', 'c8000000-0000-0000-0000-00000000000a', jsonb_build_object(
    'companyName', 'Catalog Cost Test Co',
    'productCatalog', jsonb_build_array(
      jsonb_build_object(
        'id', 'p1', 'sku', 'M365-E3', 'name', 'Microsoft 365 E3',
        'price', 2400, 'gstRate', 18, 'costPrice', 1826.4,
        'vendorPrices', jsonb_build_array(
          jsonb_build_object('vendor', 'Ingram',  'cost', 1826.4, 'until', '2026-12-31'),
          jsonb_build_object('vendor', 'Redington', 'cost', 1850.0, 'until', '2026-12-31'))),
      jsonb_build_object(
        'id', 'p2', 'sku', 'VISIO-P2', 'name', 'Visio Plan 2',
        'price', 1200, 'gstRate', 18, 'costPrice', 940.5),
      jsonb_build_object(
        'id', 'p3', 'sku', 'FREEBIE', 'name', 'Deployment hour',
        'price', 0, 'gstRate', 18, 'costPrice', 0),
      jsonb_build_object(
        'id', '', 'sku', 'ORPHAN-SKU', 'name', 'Row with no id',
        'price', 100, 'gstRate', 18, 'costPrice', 99))))
on conflict (id) do update set company_id = excluded.company_id, data = excluded.data;

insert into public.settings(id, company_id, data) values
  ('cc-test-b', 'c8000000-0000-0000-0000-00000000000b', jsonb_build_object(
    'companyName', 'Rival Reseller Ltd',
    'productCatalog', jsonb_build_array(
      jsonb_build_object('id', 'p1', 'sku', 'M365-E3', 'name', 'Microsoft 365 E3',
                         'price', 2300, 'gstRate', 18, 'costPrice', 5555.25))))
on conflict (id) do update set company_id = excluded.company_id, data = excluded.data;

/* The row that belongs to nobody: settings_select_member hands this one to
   every signed-in account on the system, whatever company they are in. */
insert into public.settings(id, company_id, data) values
  ('cc-test-orphan', null, jsonb_build_object(
    'companyName', 'Before companies existed',
    'productCatalog', jsonb_build_array(
      jsonb_build_object('id', 'p9', 'sku', 'OLD-SKU', 'name', 'From 2024',
                         'price', 1000, 'gstRate', 18, 'costPrice', 777.75))))
on conflict (id) do update set company_id = excluded.company_id, data = excluded.data;

/* ── the migration, over that fixture ───────────────────────────────── */

\ir ../058_catalog_costs.sql

/* ── 1. the move took the figures out and lost none of them ─────────── */

do $$
declare
  n int;
  c numeric;
  v int;
  ids text;
begin
  /* The costs are in the new table. */
  select count(*) into n from public.catalog_costs
   where company_id = 'c8000000-0000-0000-0000-00000000000a';
  if n <> 2 then
    raise exception 'wanted 2 costed products for company A, got %', n;
  end if;

  select cost, jsonb_array_length(vendor_prices) into c, v from public.catalog_costs
   where company_id = 'c8000000-0000-0000-0000-00000000000a' and product_id = 'p1';
  if c <> 1826.4 then raise exception 'p1 cost arrived as %, not 1826.4', c; end if;
  if v <> 2 then raise exception 'p1 kept % vendor prices, not 2', v; end if;

  select cost, jsonb_array_length(vendor_prices) into c, v from public.catalog_costs
   where company_id = 'c8000000-0000-0000-0000-00000000000a' and product_id = 'p2';
  if c <> 940.5 then raise exception 'p2 cost arrived as %, not 940.5', c; end if;
  if v <> 0 then raise exception 'p2 invented % vendor prices', v; end if;

  /* p3 has nothing to protect and p4 has no id to key a row on. Neither
     belongs in the table, and a row of zeros for p3 would be worse than
     nothing: the second run would then have no way to tell a real zero
     from a cost it had already moved. */
  select count(*) into n from public.catalog_costs
   where company_id = 'c8000000-0000-0000-0000-00000000000a'
     and product_id in ('p3', '');
  if n <> 0 then raise exception 'costless products made % rows', n; end if;

  /* Nothing left behind in the settings row. */
  select count(*) into n
    from public.settings s
    cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
   where s.id = 'cc-test-a'
     and coalesce(nullif(item ->> 'costPrice', '')::numeric, 0) <> 0;
  if n <> 0 then raise exception 'COST STILL IN THE SETTINGS ROW: % products', n; end if;

  select count(*) into n
    from public.settings s
    cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
   where s.id = 'cc-test-a' and item ? 'vendorPrices';
  if n <> 0 then raise exception 'VENDOR PRICES STILL IN THE SETTINGS ROW: % products', n; end if;

  /* And nothing else about the catalog changed: same products, same order,
     selling price and GST rate intact. A migration that protected the cost
     by mangling the catalog would be a worse bug than the one it fixed. */
  select string_agg(item ->> 'id', ',' order by ord), count(*) into ids, n
    from public.settings s
    cross join lateral jsonb_array_elements(s.data -> 'productCatalog')
      with ordinality as t(item, ord)
   where s.id = 'cc-test-a';
  if ids <> 'p1,p2,p3,' then raise exception 'catalog came back as [%]', ids; end if;

  select (item ->> 'price')::numeric into c
    from public.settings s
    cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
   where s.id = 'cc-test-a' and item ->> 'id' = 'p1';
  if c <> 2400 then raise exception 'p1 selling price came back as %', c; end if;

  if (select data ->> 'companyName' from public.settings where id = 'cc-test-a')
     <> 'Catalog Cost Test Co' then
    raise exception 'the rest of the settings row was damaged';
  end if;

  /* `costPrice` is zeroed rather than removed, because every browser in the
     field reads the key and a missing number renders as NaN. */
  select count(*) into n
    from public.settings s
    cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
   where s.id = 'cc-test-a' and item ->> 'id' in ('p1', 'p2', 'p3')
     and not (item ? 'costPrice');
  if n <> 0 then raise exception '% products lost the costPrice key', n; end if;

  /* The company-less row's figures went where no client can reach. */
  select count(*) into n
    from public.settings s
    cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
   where s.id = 'cc-test-orphan'
     and coalesce(nullif(item ->> 'costPrice', '')::numeric, 0) <> 0;
  if n <> 0 then raise exception 'COST LEFT IN THE ROW EVERYONE CAN READ'; end if;

  select cost into c from public.catalog_costs_orphaned
   where settings_id = 'cc-test-orphan' and product_id = 'p9';
  if c is distinct from 777.75 then
    raise exception 'the company-less cost was thrown away, not parked: %', c;
  end if;
end $$;

/* ── 2. running it twice does not overwrite a cost with the zero the
        first run left behind ──────────────────────────────────────────

   The strip zeroes costPrice in settings, so the second run reads a catalog
   whose costs are all zero and whose vendor lists are gone. Two guards
   stand between that and the real figures, and it is worth being exact
   about which does the work: the filter on the copy skips a product with
   nothing to protect, so a now-zeroed p1 is never even a candidate, and
   `on conflict do nothing` is the wall behind it. Remove the filter and the
   first run writes a row of zeros for the costless p3 — which section 1
   catches — and the second run would then have a zero of its own to
   overwrite p1 with. Gone silently is the worst shape a migration bug
   takes, so both guards stay. */

\ir ../058_catalog_costs.sql

do $$
declare
  c numeric;
  n int;
begin
  select cost into c from public.catalog_costs
   where company_id = 'c8000000-0000-0000-0000-00000000000a' and product_id = 'p1';
  if c <> 1826.4 then raise exception 'SECOND RUN OVERWROTE p1 WITH %', c; end if;

  select jsonb_array_length(vendor_prices) into n from public.catalog_costs
   where company_id = 'c8000000-0000-0000-0000-00000000000a' and product_id = 'p1';
  if n <> 2 then raise exception 'SECOND RUN DROPPED p1 VENDOR PRICES: % left', n; end if;

  select count(*) into n from public.catalog_costs
   where company_id = 'c8000000-0000-0000-0000-00000000000a';
  if n <> 2 then raise exception 'SECOND RUN CHANGED THE ROW COUNT TO %', n; end if;

  select cost into c from public.catalog_costs_orphaned
   where settings_id = 'cc-test-orphan' and product_id = 'p9';
  if c <> 777.75 then raise exception 'SECOND RUN OVERWROTE THE PARKED COST WITH %', c; end if;
end $$;

/* ── 3. THE SALESPERSON. Every route to the cost, as the API runs it ─── */

begin;
  set local role authenticated;
  set local "request.jwt.claim.sub"  = 'b0000000-0000-0000-0000-000000000003';
  set local "request.jwt.claim.role" = 'authenticated';

  do $$
  declare
    n int;
  begin
    /* a. The table itself. ?select=cost on catalog_costs is one HTTP
          request away for anyone signed in — the grant is there, so a zero
          here is the policy refusing and not a missing privilege. */
    select count(*) into n from public.catalog_costs;
    if n <> 0 then raise exception 'SALES READ % ROWS OF catalog_costs', n; end if;

    /* b. Their own company, named explicitly. */
    select count(*) into n from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000a';
    if n <> 0 then raise exception 'SALES READ THEIR COMPANY''S COSTS: % rows', n; end if;

    /* c. A filter on the cost. Even a refused row set leaks through a
          filter that can be binary-searched, so this must come back empty
          too, not merely column-less. */
    select count(*) into n from public.catalog_costs where cost > 0;
    if n <> 0 then raise exception 'SALES FILTERED ON cost AND GOT % ROWS', n; end if;

    select count(*) into n from public.catalog_costs where cost between 1800 and 1900;
    if n <> 0 then raise exception 'SALES BINARY-SEARCHED THE COST: % rows', n; end if;

    /* d. Through the vendor list, which is the same secret in another
          shape. */
    select count(*) into n from public.catalog_costs
     where vendor_prices @> '[{"vendor":"Ingram"}]'::jsonb;
    if n <> 0 then raise exception 'SALES READ THE DISTRIBUTOR LIST: % rows', n; end if;

    /* e. A join through a table they CAN read must not launder it. */
    select count(*) into n
      from public.settings s
      join public.catalog_costs cc on cc.company_id = s.company_id
     where s.id = 'cc-test-a';
    if n <> 0 then raise exception 'SALES LAUNDERED THE COST THROUGH settings: % rows', n; end if;

    /* f. An aggregate is a read. count() is allowed to be zero; sum() must
          not come back with a number. */
    if (select coalesce(sum(cost), -1) from public.catalog_costs) <> -1 then
      raise exception 'SALES SUMMED THE COST COLUMN';
    end if;

    /* g. The settings row they are entitled to, which is where the figures
          used to be. They may read the row — the letterhead and the
          numbering live in it — but not a cost. */
    select count(*) into n from public.settings where id = 'cc-test-a';
    if n <> 1 then raise exception 'sales lost their own settings row (% rows)', n; end if;

    select count(*) into n
      from public.settings s
      cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
     where s.company_id = 'c8000000-0000-0000-0000-00000000000a'
       and coalesce(nullif(item ->> 'costPrice', '')::numeric, 0) <> 0;
    if n <> 0 then raise exception 'SALES READ % COSTS OUT OF settings', n; end if;

    select count(*) into n
      from public.settings s
      cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
     where item ? 'vendorPrices';
    if n <> 0 then raise exception 'SALES READ % VENDOR LISTS OUT OF settings', n; end if;

    /* h. The company-less row, which their policy does hand them. */
    select count(*) into n
      from public.settings s
      cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
     where s.company_id is null
       and coalesce(nullif(item ->> 'costPrice', '')::numeric, 0) <> 0;
    if n <> 0 then raise exception 'SALES READ % COSTS OUT OF THE SHARED ROW', n; end if;
  end $$;

  /* i. The parked table has no policy and no grant, so this is a privilege
        error rather than an empty answer. Both would be safe; the error is
        what is actually configured, and a test that accepted either would
        not notice the grant coming back. */
  do $$
  begin
    perform count(*) from public.catalog_costs_orphaned;
    raise exception 'SALES REACHED catalog_costs_orphaned';
  exception when insufficient_privilege then null;
  end $$;

  /* j. Writing. A salesperson who can insert a cost can also read what
        they inserted, and a salesperson who can update one can move the
        margin report off true. */
  do $$
  begin
    insert into public.catalog_costs(company_id, product_id, cost)
    values ('c8000000-0000-0000-0000-00000000000a', 'p-sales', 1);
    raise exception 'SALES INSERTED A COST';
  exception when insufficient_privilege then null;
  end $$;

  do $$
  declare
    n int;
  begin
    update public.catalog_costs set cost = 1
     where company_id = 'c8000000-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'SALES UPDATED % COST ROWS', n; end if;

    delete from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'SALES DELETED % COST ROWS', n; end if;
  end $$;
rollback;

/* ── 4. ANOTHER COMPANY'S ADMIN. Privileged, and still none of theirs ── */

begin;
  set local role authenticated;
  set local "request.jwt.claim.sub"  = 'b0000000-0000-0000-0000-000000000004';
  set local "request.jwt.claim.role" = 'authenticated';

  do $$
  declare
    n int;
    c numeric;
  begin
    select count(*) into n from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000a';
    if n <> 0 then raise exception 'A RIVAL ADMIN READ % OF OUR COST ROWS', n; end if;

    select count(*) into n from public.catalog_costs;
    if n <> 1 then
      raise exception 'rival admin saw % rows, wanted only their own 1', n;
    end if;

    select cost into c from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000b' and product_id = 'p1';
    if c <> 5555.25 then
      raise exception 'rival admin cannot read their own cost: got %', c;
    end if;

    /* The shared row again, from outside the company this time. */
    select count(*) into n
      from public.settings s
      cross join lateral jsonb_array_elements(s.data -> 'productCatalog') as item
     where coalesce(nullif(item ->> 'costPrice', '')::numeric, 0) <> 0;
    if n <> 0 then raise exception 'A RIVAL READ % COSTS OUT OF settings', n; end if;
  end $$;
rollback;

/* ── 5. THE MANAGER AND THE ADMIN. The rule is not "nobody" ─────────── */

/* A protection that also hides the figures from the people who price the
   work is a regression, not a fix: the catalog screen and the margin strip
   in the quotation editor both need these numbers. */

begin;
  set local role authenticated;
  set local "request.jwt.claim.sub"  = 'b0000000-0000-0000-0000-000000000002';
  set local "request.jwt.claim.role" = 'authenticated';

  do $$
  declare
    n int;
    c numeric;
  begin
    select count(*) into n from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000a';
    if n <> 2 then raise exception 'manager saw % cost rows, wanted 2', n; end if;

    select cost into c from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000a' and product_id = 'p1';
    if c <> 1826.4 then raise exception 'manager got p1 cost %, wanted 1826.4', c; end if;

    select jsonb_array_length(vendor_prices) into n from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000a' and product_id = 'p1';
    if n <> 2 then raise exception 'manager got % vendor prices, wanted 2', n; end if;

    /* Not the other company's, though. */
    select count(*) into n from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000b';
    if n <> 0 then raise exception 'manager read the other company''s costs'; end if;
  end $$;
rollback;

begin;
  set local role authenticated;
  set local "request.jwt.claim.sub"  = 'b0000000-0000-0000-0000-000000000001';
  set local "request.jwt.claim.role" = 'authenticated';

  do $$
  declare
    n int;
    c numeric;
  begin
    select count(*) into n from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000a';
    if n <> 2 then raise exception 'admin saw % cost rows, wanted 2', n; end if;

    /* The admin is the one who edits the catalog, so the write has to go
       through — this is the path src/data/catalogCosts.ts takes when the
       catalog screen saves. */
    insert into public.catalog_costs(company_id, product_id, cost, vendor_prices)
    values ('c8000000-0000-0000-0000-00000000000a', 'p5', 120.5, '[]'::jsonb);

    update public.catalog_costs set cost = 1900
     where company_id = 'c8000000-0000-0000-0000-00000000000a' and product_id = 'p1';
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'admin could not update a cost (% rows)', n; end if;

    select cost into c from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000a' and product_id = 'p1';
    if c <> 1900 then raise exception 'admin''s update did not stick: %', c; end if;

    delete from public.catalog_costs
     where company_id = 'c8000000-0000-0000-0000-00000000000a' and product_id = 'p5';
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'admin could not delete a cost (% rows)', n; end if;

    /* And not into somebody else's company, even as an Admin of their
       own — the with-check is per company, not per role. */
    begin
      insert into public.catalog_costs(company_id, product_id, cost)
      values ('c8000000-0000-0000-0000-00000000000b', 'p-smuggled', 1);
      raise exception 'ADMIN WROTE A COST INTO ANOTHER COMPANY';
    exception when insufficient_privilege then null;
    end;
  end $$;

  /* Even an Admin has no business in the parked table from a browser: it is
     a holding pen for a row nobody owns, not a second catalog. */
  do $$
  begin
    perform count(*) from public.catalog_costs_orphaned;
    raise exception 'AN ADMIN REACHED catalog_costs_orphaned FROM A BROWSER';
  exception when insufficient_privilege then null;
  end $$;
rollback;

/* ── 6. and the table is actually protected, not merely policied ─────── */

do $$
declare
  on_ boolean;
  n int;
begin
  select relrowsecurity into on_ from pg_class
   where oid = 'public.catalog_costs'::regclass;
  if not on_ then raise exception 'ROW LEVEL SECURITY IS OFF ON catalog_costs'; end if;

  select relrowsecurity into on_ from pg_class
   where oid = 'public.catalog_costs_orphaned'::regclass;
  if not on_ then raise exception 'ROW LEVEL SECURITY IS OFF ON catalog_costs_orphaned'; end if;

  /* anon holds nothing. On Supabase, default privileges handed anon a grant
     on every new table in public and `revoke from public` did not take it
     back, which is why 058 names the role; after the move to Azure the
     bootstrap grants it nothing, so deleting that revoke would not break
     this check today. What the check is for is the grant APPEARING — from a
     restored default ACL, a managed-service setting, or a later migration
     that is generous with `to anon`. It was proven to catch one by adding
     it. */
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('catalog_costs', 'catalog_costs_orphaned')
     and grantee = 'anon';
  if n <> 0 then raise exception 'anon STILL HOLDS % GRANTS ON THE COST TABLES', n; end if;

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'catalog_costs_orphaned'
     and grantee = 'authenticated';
  if n <> 0 then raise exception 'authenticated HOLDS % GRANTS ON THE PARKED TABLE', n; end if;

  /* And the four policies are all gated on the same function, so there is
     one definition of "may see what we pay" rather than two that drift. */
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'catalog_costs'
     and coalesce(qual, '') || coalesce(with_check, '') like '%is_privileged_in%';
  if n <> 4 then
    raise exception 'wanted 4 policies gated on is_privileged_in, found %', n;
  end if;
end $$;

/* ── tidy up ────────────────────────────────────────────────────────── */

set role none;
set request.jwt.claim.role = 'service_role';
delete from public.catalog_costs where company_id in
  ('c8000000-0000-0000-0000-00000000000a', 'c8000000-0000-0000-0000-00000000000b');
delete from public.catalog_costs_orphaned where settings_id = 'cc-test-orphan';
delete from public.settings where id in ('cc-test-a', 'cc-test-b', 'cc-test-orphan');
/* keep_one_admin() (034) refuses to let a company lose its last Admin, and
   it fires on the cascade from `delete from companies` just as it does on a
   delete of the membership row — correctly: it cannot tell that the company
   itself is on its way out. So it is lifted for the teardown and put back,
   which also leaves the database as the proof found it. */
alter table public.company_members disable trigger company_members_keep_one_admin;
delete from public.companies where id in
  ('c8000000-0000-0000-0000-00000000000a', 'c8000000-0000-0000-0000-00000000000b');
alter table public.company_members enable trigger company_members_keep_one_admin;

\echo 'catalog cost proof: the buying price is out of Sales'' reach.'
