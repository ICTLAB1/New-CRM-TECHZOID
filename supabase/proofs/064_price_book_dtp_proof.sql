/*
 * THE TEST THE DTP EXISTS TO PASS — twice over:
 *
 *   1. The buying price is now READ, not guessed. The file states what we
 *      buy at; the CRM used to reconstruct it from a percentage an Admin
 *      typed against the list price, which on the November 2026 Microsoft
 *      workbook was wrong on nearly every line — the real ratio runs from
 *      70% to 100% and one typed number cannot be all of them.
 *
 *   2. It is STILL COST, and a salesperson still cannot reach it. Adding a
 *      cost column to a price book is exactly the change that quietly
 *      opens the door this schema was built to keep shut, so every route
 *      is checked again with the new column in place.
 *
 * Every check RAISES if the rule is broken, so a pass is silence and a
 * failure cannot be mistaken for one.
 *
 *   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/proofs/064_price_book_dtp_proof.sql
 *
 * Run it on a throwaway copy of the schema, never on the live database:
 * it writes a fixture.
 */
\set ON_ERROR_STOP on

set request.jwt.claim.role = 'service_role';

insert into auth.users(id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-0000000000d1', 'dadmin@t', '{"name":"D Admin"}'::jsonb),
  ('a0000000-0000-0000-0000-0000000000d2', 'dsales@t', '{"name":"D Sales"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles(id, name, email, role) values
  ('a0000000-0000-0000-0000-0000000000d1', 'D Admin', 'dadmin@t', 'Admin'),
  ('a0000000-0000-0000-0000-0000000000d2', 'D Sales', 'dsales@t', 'Sales')
on conflict (id) do update set role = excluded.role;

insert into public.companies(id, name) values
  ('c0000000-0000-0000-0000-0000000000d1', 'DTP Test Co')
on conflict (id) do nothing;

insert into public.company_members(company_id, user_id, role) values
  ('c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'Admin'),
  ('c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d2', 'Sales')
on conflict (company_id, user_id) do update set role = excluded.role;

/* Loaded through the real function, so the write path is proved too.
   One line WITH a DTP and one WITHOUT, because the fallback matters as
   much as the column: an older list carries no DTP at all. */
begin;
  set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000d1';
  set local request.jwt.claim.role = 'authenticated';
  set local role authenticated;

  do $$
  begin
    perform public.price_list_commit(
      'c0000000-0000-0000-0000-0000000000d1', 'Microsoft', 2026, 11,
      $j$[
        {"sku":"WITH-DTP","productName":"Exchange Online Archiving","licenceType":"P1Y","resellerPrice":2079,"dtp":1663.20,"currency":"INR"},
        {"sku":"NO-DTP","productName":"Older Line","licenceType":"P1Y","resellerPrice":1000,"currency":"INR"}
      ]$j$::jsonb,
      'NCE', 0, '{}'::jsonb, 'test.xlsx', 'sha', true);
  end $$;
commit;

/* ── 1. the DTP was stored as the file stated it ─────────────────────── */
do $$
declare
  v numeric;
begin
  select dtp into v from public.price_list_items
   where company_id = 'c0000000-0000-0000-0000-0000000000d1' and sku = 'WITH-DTP';
  if v is null then raise exception 'the DTP was not stored at all'; end if;
  if v <> 1663.20 then raise exception 'the DTP stored as %, expected 1663.20', v; end if;

  /* AND THE LIST PRICE IS STILL THE LIST PRICE. Reading the DTP over the
     top of reseller_price would drop every floor in the book by 20%. */
  select reseller_price into v from public.price_list_items
   where company_id = 'c0000000-0000-0000-0000-0000000000d1' and sku = 'WITH-DTP';
  if v <> 2079 then raise exception 'the list price became %, expected 2079', v; end if;

  select dtp into v from public.price_list_items
   where company_id = 'c0000000-0000-0000-0000-0000000000d1' and sku = 'NO-DTP';
  /* NULL, NOT ZERO. Zero would claim the line is free and show an Admin a
     100% margin on it. */
  if v is not null then raise exception 'a line with no DTP stored % instead of null', v; end if;
end $$;

/* ── 2. the buying price is read, and falls back when it cannot be ───── */
begin;
  set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000d1';
  set local request.jwt.claim.role = 'authenticated';
  set local role authenticated;

  do $$
  declare
    r record;
  begin
    /* A deliberately WRONG typed percentage. The line that states its DTP
       must ignore it; the line that does not must use it. That is the
       whole of the change in one assertion. */
    select * into r from public.price_book_search_costed(
      'c0000000-0000-0000-0000-0000000000d1', 'WITH-DTP', null, 10, 50);
    if r.buying_price <> 1663.20 then
      raise exception 'the stated DTP was ignored: we pay % rather than 1663.20', r.buying_price;
    end if;
    if r.dtp <> 1663.20 then raise exception 'the costed search did not return the DTP'; end if;

    select * into r from public.price_book_search_costed(
      'c0000000-0000-0000-0000-0000000000d1', 'NO-DTP', null, 10, 50);
    if r.buying_price <> 500 then
      raise exception 'the fallback did not apply: % rather than 500 at 50%%', r.buying_price;
    end if;
    if r.dtp is not null then raise exception 'a line with no DTP returned one'; end if;
  end $$;
rollback;

/* ── 3. and none of it reaches a salesperson ─────────────────────────── */
begin;
  set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000d2';
  set local request.jwt.claim.role = 'authenticated';
  set local role authenticated;

  do $$
  declare
    n int;
    cols text[];
  begin
    /* THE DOOR BUILT FOR THEM carries no dtp column. Its return type is
       the door, so this is checked by name and not by hoping. */
    select array_agg(u.name order by u.i) into cols
      from pg_proc p,
           unnest(p.proallargtypes, p.proargmodes, p.proargnames)
             with ordinality as u(typ, mode, name, i)
     where p.proname = 'price_book_search' and u.mode = 't';
    if cols is null then raise exception 'price_book_search was not found to inspect'; end if;
    if 'dtp' = any(cols) then
      raise exception 'price_book_search returns the DTP: %', array_to_string(cols, ', ');
    end if;
    if 'reseller_price' = any(cols) then
      raise exception 'price_book_search returns the reseller price: %', array_to_string(cols, ', ');
    end if;

    /* The costed door refuses them by name. */
    begin
      perform public.price_book_search_costed(
        'c0000000-0000-0000-0000-0000000000d1', 'WITH-DTP', null, 10, 0);
      raise exception 'a Sales user read the costed search';
    exception when others then
      if sqlerrm <> 'cost prices are for Admin and Manager only' then raise; end if;
    end;

    /* And the table itself, which is what a hand-written /rest query
       would reach for. */
    select count(*) into n from public.price_list_items where dtp is not null;
    if n <> 0 then raise exception 'a Sales user read % DTPs off the table', n; end if;

    /* Nor through the function that does the cost arithmetic. */
    begin
      perform public.buying_price(1663.20, 2079, 20);
      raise exception 'a Sales user called buying_price directly';
    exception when insufficient_privilege then null;
    end;
  end $$;
rollback;

/* ── clean up, so the proof can be run again ─────────────────────────── */

delete from public.price_lists where company_id = 'c0000000-0000-0000-0000-0000000000d1';

reset request.jwt.claim.role;

select 'price book: the DTP is read from the file, and Sales still cannot see it' as proof;
