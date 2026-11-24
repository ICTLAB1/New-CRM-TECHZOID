/*
 * THE TEST THE VARIANT FILTERS EXIST TO PASS: a price book holding one
 * row per term, billing plan and segment can be narrowed to the one a
 * salesperson is actually quoting.
 *
 * WHY IT MATTERS. A Microsoft list used to import as 211 rows because the
 * importer threw away every term and billing variant as a duplicate. The
 * same workbook now loads 4,887 — which is right, and which made Browse
 * unusable: "Exchange online" returned a dozen rows differing only in
 * term and billing, with nothing to narrow them by. A filter that silently
 * returned nothing, or quietly ignored one of its arguments, would be
 * worse than no filter: the salesperson would conclude the product has no
 * floor and quote whatever they liked.
 *
 * Every check RAISES if the rule is broken, so a pass is silence and a
 * failure cannot be mistaken for one.
 *
 *   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/proofs/063_price_book_variants_proof.sql
 *
 * Run it on a throwaway copy of the schema, never on the live database:
 * it writes a fixture.
 */
\set ON_ERROR_STOP on

set request.jwt.claim.role = 'service_role';

insert into auth.users(id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-0000000000f1', 'vadmin@t', '{"name":"V Admin"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles(id, name, email, role) values
  ('a0000000-0000-0000-0000-0000000000f1', 'V Admin', 'vadmin@t', 'Admin')
on conflict (id) do update set role = excluded.role;

insert into public.companies(id, name) values
  ('c0000000-0000-0000-0000-0000000000f1', 'Variant Test Co')
on conflict (id) do nothing;

insert into public.company_members(company_id, user_id, role) values
  ('c0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'Admin')
on conflict (company_id, user_id) do update set role = excluded.role;

/* ── loaded THROUGH price_list_commit, not inserted behind it ─────────
   The billing plan is read out of the workbook by the upload endpoint and
   handed here as JSON. Inserting the rows directly would prove the filter
   and leave the write path — the part that actually dropped the billing
   plan on the floor before this change — untested. */
begin;
  set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000f1';
  set local request.jwt.claim.role = 'authenticated';
  set local role authenticated;

  do $$
  declare
    v_loaded int;
  begin
    select items_loaded into v_loaded from public.price_list_commit(
      'c0000000-0000-0000-0000-0000000000f1', 'Microsoft', 2026, 11,
      $j$[
        {"sku":"CFQ7:1:P1Y:Monthly","productName":"Exchange Online Archiving","category":"Commercial","licenceType":"P1Y","billingPlan":"Monthly","resellerPrice":3150,"currency":"INR"},
        {"sku":"CFQ7:1:P1Y:Annual","productName":"Exchange Online Archiving","category":"Commercial","licenceType":"P1Y","billingPlan":"Annual","resellerPrice":3000,"currency":"INR"},
        {"sku":"CFQ7:1:P1M:Monthly","productName":"Exchange Online Archiving","category":"Commercial","licenceType":"P1M","billingPlan":"Monthly","resellerPrice":300,"currency":"INR"},
        {"sku":"CFQ7:4:P1Y:Annual","productName":"Exchange Online Archiving","category":"Education","licenceType":"P1Y","billingPlan":"Annual","resellerPrice":900,"currency":"INR"}
      ]$j$::jsonb,
      'NCE', 0, '{}'::jsonb, 'test.xlsx', 'sha', true);

    if v_loaded <> 4 then raise exception 'loaded % rows, expected 4', v_loaded; end if;
  end $$;
commit;

/* ── the billing plan survived the load ──────────────────────────────── */
do $$
declare
  n int;
begin
  select count(*) into n
    from public.price_list_items
   where company_id = 'c0000000-0000-0000-0000-0000000000f1'
     and billing_plan is not null;
  /* It used to go into the SKU and nowhere else, which is why it could
     not be asked as a question. */
  if n <> 4 then raise exception 'the billing plan was not stored: % of 4 rows carry one', n; end if;
end $$;

/* ── the filters ─────────────────────────────────────────────────────── */
begin;
  set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000f1';
  set local request.jwt.claim.role = 'authenticated';
  set local role authenticated;

  do $$
  declare
    n int;
  begin
    /* Unfiltered: every variant. */
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-0000000000f1', 'Exchange', null, 200);
    if n <> 4 then raise exception 'unfiltered search returned %, expected 4', n; end if;

    /* By term. */
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-0000000000f1', 'Exchange', null, 200, 'P1M');
    if n <> 1 then raise exception 'term P1M returned %, expected 1', n; end if;

    /* By billing plan. */
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-0000000000f1', 'Exchange', null, 200, null, 'Annual');
    if n <> 2 then raise exception 'billing Annual returned %, expected 2', n; end if;

    /* By segment. */
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-0000000000f1', 'Exchange', null, 200, null, null, 'Education');
    if n <> 1 then raise exception 'segment Education returned %, expected 1', n; end if;

    /* All three together narrow to exactly one line. */
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-0000000000f1', 'Exchange', null, 200, 'P1Y', 'Annual', 'Commercial');
    if n <> 1 then raise exception 'all three filters returned %, expected 1', n; end if;

    /* THE ONE THAT WOULD BE SILENT. A <select> whose first option is
       "All" sends an empty string, not null. Read literally that is "rows
       whose term is the empty string" — no rows — and the salesperson sees
       an empty price book and concludes the upload failed. */
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-0000000000f1', 'Exchange', null, 200, '', '', '');
    if n <> 4 then raise exception 'empty-string filters returned %, expected 4 (they mean "any")', n; end if;

    /* Case is not the salesperson's problem. */
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-0000000000f1', 'Exchange', null, 200, 'p1m');
    if n <> 1 then raise exception 'lower-case term returned %, expected 1', n; end if;

    /* A filter naming something no row carries returns nothing, rather
       than everything — the failure mode that would quietly show a
       salesperson a floor belonging to a different term. */
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-0000000000f1', 'Exchange', null, 200, 'P3Y');
    if n <> 0 then raise exception 'term P3Y returned %, expected 0', n; end if;
  end $$;
rollback;

/* ── the dropdowns are built from the data ───────────────────────────── */
begin;
  set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000f1';
  set local request.jwt.claim.role = 'authenticated';
  set local role authenticated;

  do $$
  declare
    n int;
    v text;
  begin
    select count(*) into n from public.price_book_facets(
      'c0000000-0000-0000-0000-0000000000f1', null) where kind = 'term';
    if n <> 2 then raise exception 'facets offered % terms, expected 2 (P1Y, P1M)', n; end if;

    select count(*) into n from public.price_book_facets(
      'c0000000-0000-0000-0000-0000000000f1', null) where kind = 'billing';
    if n <> 2 then raise exception 'facets offered % billing plans, expected 2', n; end if;

    select count(*) into n from public.price_book_facets(
      'c0000000-0000-0000-0000-0000000000f1', null) where kind = 'segment';
    if n <> 2 then raise exception 'facets offered % segments, expected 2', n; end if;

    /* The commonest value first, so the dropdown opens on the one most
       rows carry. P1Y is on three of the four. */
    select value into v from public.price_book_facets(
      'c0000000-0000-0000-0000-0000000000f1', null) where kind = 'term' limit 1;
    if v <> 'P1Y' then raise exception 'facets led with term %, expected P1Y', v; end if;

    /* An OEM with nothing loaded offers nothing, rather than every other
       OEM's terms. */
    select count(*) into n from public.price_book_facets(
      'c0000000-0000-0000-0000-0000000000f1', 'Adobe');
    if n <> 0 then raise exception 'facets for an OEM with no list returned % rows', n; end if;
  end $$;
rollback;

/* ── clean up, so the proof can be run again ─────────────────────────── */

delete from public.price_lists where company_id = 'c0000000-0000-0000-0000-0000000000f1';

reset request.jwt.claim.role;

select 'price book: term, billing plan and segment each narrow the list' as proof;
