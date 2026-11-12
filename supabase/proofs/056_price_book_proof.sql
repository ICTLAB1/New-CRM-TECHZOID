/*
 * THE TEST THE PRICE BOOK EXISTS TO PASS: a salesperson calling the API
 * directly cannot get the buying price, the reseller price, the
 * distributor discount or the margin.
 *
 * Not "cannot see them in the UI". The CRM's /rest endpoint
 * (api/lib/query.mjs) lets a browser compose its own query over any table
 * — it picks the columns, the filters and the order, and row-level
 * security is what decides whether anything comes back. So the rule has to
 * hold against a hostile query, which is what this file runs: each block
 * takes the role and the identity the API tier stamps on a request
 * (set local role authenticated, request.jwt.claim.sub), then asks for the
 * cost by every route a browser has.
 *
 * Every check RAISES if the rule is broken, so a pass is silence and a
 * failure cannot be mistaken for one.
 *
 *   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/proofs/056_price_book_proof.sql
 *
 * Run it on a throwaway copy of the schema, never on the live database:
 * it writes a fixture.
 */
\set ON_ERROR_STOP on

/* ── the fixture ────────────────────────────────────────────────────── */

/* Written as the service role, which is how the CRM's own server-side jobs
   write. profiles carries a trigger (migration 041) that refuses a role
   change from anyone but an Admin or the service role, and a new row in
   auth.users makes a profile of its own, so setting up four roles here is
   an UPDATE to a row that already exists and needs that standing. */
set request.jwt.claim.role = 'service_role';

insert into auth.users(id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@t',    '{"name":"Admin"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000002', 'manager@t',  '{"name":"Manager"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000003', 'sales@t',    '{"name":"Sales"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000004', 'accounts@t', '{"name":"Accounts"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000005', 'rival@t',    '{"name":"Rival"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles(id, name, email, role) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin',    'admin@t',    'Admin'),
  ('a0000000-0000-0000-0000-000000000002', 'Manager',  'manager@t',  'Manager'),
  ('a0000000-0000-0000-0000-000000000003', 'Sales',    'sales@t',    'Sales'),
  /* 'Sales', not 'Accounts': profiles.role predates the Accounts role and
     its check constraint still allows only Admin, Manager and Sales. The
     price book reads the role from company_members, which does carry all
     four and is per-company, so this is the faithful shape of a real
     Accounts user today — and the proof is stronger for it, since the
     profiles row says Sales while the membership says Accounts. */
  ('a0000000-0000-0000-0000-000000000004', 'Accounts', 'accounts@t', 'Sales'),
  ('a0000000-0000-0000-0000-000000000005', 'Rival',    'rival@t',    'Admin')
on conflict (id) do update set role = excluded.role;

insert into public.companies(id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'Price Book Test Co'),
  ('c0000000-0000-0000-0000-00000000000b', 'Somebody Else Ltd')
on conflict (id) do nothing;

insert into public.company_members(company_id, user_id, role) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'Admin'),
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'Manager'),
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Sales'),
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', 'Accounts'),
  ('c0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000005', 'Admin')
on conflict (company_id, user_id) do update set role = excluded.role;

/* November's Microsoft list, active; October's, archived. */
insert into public.price_lists(id, company_id, oem, period_year, period_month, status, uploaded_by, row_count) values
  ('11111111-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'Microsoft', 2026, 11, 'active',   'a0000000-0000-0000-0000-000000000001', 3),
  ('11111111-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000a', 'Microsoft', 2026, 10, 'archived', 'a0000000-0000-0000-0000-000000000001', 1),
  ('11111111-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-00000000000a', 'Adobe',     2026, 11, 'active',   'a0000000-0000-0000-0000-000000000001', 1)
on conflict (id) do nothing;

insert into public.price_list_items(price_list_id, company_id, sku, product_name, category, licence_type, unit, reseller_price) values
  ('11111111-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'M365-E3', 'Microsoft 365 E3', 'Cloud',   'Annual', 'User', 1000.00),
  ('11111111-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'M365-E5', 'Microsoft 365 E5', 'Cloud',   'Annual', 'User', 2000.00),
  ('11111111-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'VISIO-P2', 'Visio Plan 2',    'Desktop', 'Annual', 'User',  500.00),
  ('11111111-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000a', 'M365-E3', 'Microsoft 365 E3', 'Cloud',   'Annual', 'User',  900.00),
  ('11111111-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-00000000000a', 'ACROBAT', 'Acrobat Pro',      'Desktop', 'Annual', 'User',  800.00)
on conflict (price_list_id, lower(sku)) do nothing;

/* Four rules, one at each level of specificity. */
insert into public.oem_margin_rules(company_id, oem, category, sku, min_margin_pct) values
  ('c0000000-0000-0000-0000-00000000000a', '*',         null,      null,      5),
  ('c0000000-0000-0000-0000-00000000000a', 'Microsoft', null,      null,      10),
  ('c0000000-0000-0000-0000-00000000000a', 'Microsoft', 'Cloud',   null,      15),
  ('c0000000-0000-0000-0000-00000000000a', 'Microsoft', 'Cloud',   'M365-E5', 20)
on conflict (company_id, lower(oem), coalesce(lower(category), ''), coalesce(lower(sku), '')) do nothing;

/* An approval the salesperson raised, decided by the Admin, carrying the
   distributor discount that was obtained. This row is the honeypot: it is
   the salesperson's OWN row, and it holds a cost secret. */
insert into public.discount_approvals(
  id, company_id, quote_id, quote_number, requested_by, reason, state,
  lines, decided_by, decided_at, decision_note, distributor_discount_pct, approved_lines) values
  ('dddddddd-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
   'quote_pb_1', 'TZ/Q/26-27/0001', 'a0000000-0000-0000-0000-000000000003',
   'Competitor quoted lower', 'approved',
   '[{"lineId":"l1","sku":"M365-E3","qty":10,"minPrice":1150,"requestedPrice":1050}]'::jsonb,
   'a0000000-0000-0000-0000-000000000001', now(), 'Approved to hold the account',
   3.25,
   '[{"lineId":"l1","approvedPrice":1080}]'::jsonb)
on conflict (id) do nothing;

/* ── 1. the margin rules resolve most-specific-first ────────────────── */

do $$
declare
  got numeric;
begin
  got := public.min_margin_pct('c0000000-0000-0000-0000-00000000000a', 'Microsoft', 'Cloud', 'M365-E5');
  if got <> 20 then raise exception 'SKU rule lost: wanted 20, got %', got; end if;

  got := public.min_margin_pct('c0000000-0000-0000-0000-00000000000a', 'Microsoft', 'Cloud', 'M365-E3');
  if got <> 15 then raise exception 'category rule lost: wanted 15, got %', got; end if;

  got := public.min_margin_pct('c0000000-0000-0000-0000-00000000000a', 'Microsoft', 'Desktop', 'VISIO-P2');
  if got <> 10 then raise exception 'OEM rule lost: wanted 10, got %', got; end if;

  /* No Adobe rule at all, so the company default applies. */
  got := public.min_margin_pct('c0000000-0000-0000-0000-00000000000a', 'Adobe', 'Desktop', 'ACROBAT');
  if got <> 5 then raise exception 'company default lost: wanted 5, got %', got; end if;

  /* An OEM nobody has configured, in a company with no default either:
     no rule means no margin, which puts the floor at the cost rather
     than below it. */
  got := coalesce(public.min_margin_pct('c0000000-0000-0000-0000-00000000000b', 'Kaspersky', null, 'X'), 0);
  if got <> 0 then raise exception 'unconfigured OEM did not fall back to zero: got %', got; end if;

  if public.min_selling_price(1000, 15) <> 1150.00 then
    raise exception 'minimum selling price arithmetic is wrong: %', public.min_selling_price(1000, 15);
  end if;
end $$;

/* ── 2. THE SALESPERSON. Every route to the cost, as the API runs it ── */

begin;
  set local role authenticated;
  set local "request.jwt.claim.sub"  = 'a0000000-0000-0000-0000-000000000003';
  set local "request.jwt.claim.role" = 'authenticated';

  /* a. The table the cost lives in. ?select=reseller_price on
        price_list_items is one HTTP request away for anyone signed in. */
  do $$
  declare
    n int;
  begin
    select count(*) into n from public.price_list_items;
    if n <> 0 then raise exception 'SALES READ % ROWS OF price_list_items', n; end if;

    select count(*) into n from public.price_list_items where reseller_price > 0;
    if n <> 0 then raise exception 'SALES FILTERED ON reseller_price AND GOT % ROWS', n; end if;

    /* A join through another table they CAN read must not launder it. */
    select count(*) into n
      from public.price_lists l join public.price_list_items i on i.price_list_id = l.id;
    if n <> 0 then raise exception 'SALES REACHED THE COST THROUGH A JOIN: % ROWS', n; end if;
  end $$;

  /* b. The margin rules: the other half of the arithmetic. */
  do $$
  declare
    n int;
  begin
    select count(*) into n from public.oem_margin_rules;
    if n <> 0 then raise exception 'SALES READ % MARGIN RULES', n; end if;
  end $$;

  /* c. The margin resolver itself, called directly. Execute was revoked,
        so this must be refused rather than answered. */
  do $$
  declare
    got numeric;
  begin
    got := public.min_margin_pct('c0000000-0000-0000-0000-00000000000a', 'Microsoft', 'Cloud', 'M365-E3');
    raise exception 'SALES CALLED min_margin_pct AND GOT %', got;
  exception when insufficient_privilege then
    null;
  end $$;

  /* d. The costed search, which is the one endpoint that does select the
        cost. It must refuse out loud, not answer thinly. */
  do $$
  declare
    n int;
  begin
    select count(*) into n from public.price_book_search_costed(
      'c0000000-0000-0000-0000-00000000000a', null, null, 100, 0);
    raise exception 'SALES CALLED THE COSTED SEARCH AND GOT % ROWS', n;
  exception when others then
    if sqlerrm not like '%Admin and Manager only%' then raise; end if;
  end $$;

  /* e. Their own approval row, which holds the distributor discount. */
  do $$
  declare
    n int;
  begin
    select count(*) into n from public.discount_approvals;
    if n <> 0 then raise exception 'SALES READ % APPROVAL ROWS DIRECTLY', n; end if;

    select count(*) into n from public.discount_approvals where distributor_discount_pct is not null;
    if n <> 0 then raise exception 'SALES READ THE DISTRIBUTOR DISCOUNT OFF THEIR OWN ROW'; end if;
  end $$;

  /* f. The audit log, which records old and new prices. */
  do $$
  declare
    n int;
  begin
    select count(*) into n from public.approval_audit_log;
    if n <> 0 then raise exception 'SALES READ % AUDIT ROWS', n; end if;
  end $$;

  /* g. WHAT THEY MUST SEE: the minimum selling price, through the one
        door built for them, with the margins applied. */
  do $$
  declare
    r record;
    n int;
  begin
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-00000000000a', null, null, 100);
    if n <> 4 then raise exception 'price book search gave % rows, wanted 4 (3 Microsoft + 1 Adobe, active lists only)', n; end if;

    select * into r from public.price_book_search(
      'c0000000-0000-0000-0000-00000000000a', 'M365-E3', null, 10);
    if r.min_price <> 1150.00 then raise exception 'M365-E3 minimum was %, wanted 1150.00', r.min_price; end if;
    if r.period <> '2026-11' then raise exception 'M365-E3 came from period %, wanted 2026-11', r.period; end if;

    select * into r from public.price_book_search(
      'c0000000-0000-0000-0000-00000000000a', 'M365-E5', null, 10);
    if r.min_price <> 2400.00 then raise exception 'M365-E5 minimum was %, wanted 2400.00 (SKU rule, 20%%)', r.min_price; end if;

    select * into r from public.price_book_search(
      'c0000000-0000-0000-0000-00000000000a', 'VISIO', null, 10);
    if r.min_price <> 550.00 then raise exception 'Visio minimum was %, wanted 550.00 (OEM rule, 10%%)', r.min_price; end if;

    select * into r from public.price_book_search(
      'c0000000-0000-0000-0000-00000000000a', 'ACROBAT', null, 10);
    if r.min_price <> 840.00 then raise exception 'Acrobat minimum was %, wanted 840.00 (company default, 5%%)', r.min_price; end if;
  end $$;

  /* h. And their own approval, through the door built for that: the
        approved price, without the distributor discount beside it. */
  do $$
  declare
    r record;
  begin
    select * into r from public.my_discount_approvals('c0000000-0000-0000-0000-00000000000a');
    if r.state <> 'approved' then raise exception 'own approval read back as %', r.state; end if;
    if r.approved_lines->0->>'approvedPrice' <> '1080' then
      raise exception 'approved price came back as %', r.approved_lines->0->>'approvedPrice';
    end if;
  end $$;

  /* i. An archived month is history, not a price to quote from. */
  do $$
  declare
    n int;
  begin
    select count(*) into n from public.price_book_search(
      'c0000000-0000-0000-0000-00000000000a', 'M365-E3', null, 100);
    if n <> 1 then raise exception 'M365-E3 matched % rows; the archived October list is being quoted from', n; end if;
  end $$;
rollback;

/* ── 3. ACCOUNTS: read-only, and read-only of what is not cost ──────── */

begin;
  set local role authenticated;
  set local "request.jwt.claim.sub"  = 'a0000000-0000-0000-0000-000000000004';
  set local "request.jwt.claim.role" = 'authenticated';
  do $$
  declare
    n int;
  begin
    select count(*) into n from public.price_list_items;
    if n <> 0 then raise exception 'ACCOUNTS READ % ROWS OF price_list_items', n; end if;
    select count(*) into n from public.oem_margin_rules;
    if n <> 0 then raise exception 'ACCOUNTS READ % MARGIN RULES', n; end if;
  end $$;
  do $$
  begin
    perform * from public.price_book_search_costed('c0000000-0000-0000-0000-00000000000a', null, null, 100, 0);
    raise exception 'ACCOUNTS CALLED THE COSTED SEARCH';
  exception when others then
    if sqlerrm not like '%Admin and Manager only%' then raise; end if;
  end $$;
rollback;

/* ── 4. THE MANAGER: sees the cost, cannot approve ──────────────────── */

begin;
  set local role authenticated;
  set local "request.jwt.claim.sub"  = 'a0000000-0000-0000-0000-000000000002';
  set local "request.jwt.claim.role" = 'authenticated';

  do $$
  declare
    n int;
    r record;
  begin
    select count(*) into n from public.price_list_items;
    if n <> 5 then raise exception 'manager saw % price list items, wanted all 5', n; end if;

    select * into r from public.price_book_search_costed(
      'c0000000-0000-0000-0000-00000000000a', 'M365-E3', null, 10, 3.5);
    if r.reseller_price <> 1000.00 then raise exception 'manager got reseller price %', r.reseller_price; end if;
    /* 1000 less 3.5% distributor discount. */
    if r.buying_price <> 965.00 then raise exception 'buying price came out at %, wanted 965.00', r.buying_price; end if;
    if r.min_margin_pct <> 15 then raise exception 'manager got margin %', r.min_margin_pct; end if;

    select count(*) into n from public.discount_approvals;
    if n <> 1 then raise exception 'manager saw % approvals, wanted 1', n; end if;
  end $$;

  /* The one thing a Manager may not do. The policy admits no row, so the
     update reaches nothing — asserted, because "0 rows" is the whole
     difference between a Manager and an approver. */
  do $$
  declare
    n int;
  begin
    update public.discount_approvals
       set state = 'approved', decided_by = 'a0000000-0000-0000-0000-000000000002'
     where id = 'dddddddd-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'A MANAGER APPROVED A DISCOUNT (% rows)', n; end if;
  exception when insufficient_privilege then
    null;   /* refused outright: also correct, and stronger */
  end $$;

  /* Nor may a Manager change the price list itself. */
  do $$
  declare
    n int;
  begin
    update public.price_list_items set reseller_price = 1 where sku = 'M365-E3';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'A MANAGER REWROTE THE PRICE LIST (% rows)', n; end if;
  exception when insufficient_privilege then
    null;
  end $$;
rollback;

/* ── 5. THE ADMIN: everything, including deciding ───────────────────── */

begin;
  set local role authenticated;
  set local "request.jwt.claim.sub"  = 'a0000000-0000-0000-0000-000000000001';
  set local "request.jwt.claim.role" = 'authenticated';

  do $$
  declare
    n int;
    r record;
  begin
    select * into r from public.price_book_search_costed(
      'c0000000-0000-0000-0000-00000000000a', 'M365-E5', null, 10, 0);
    if r.reseller_price <> 2000.00 then raise exception 'admin got reseller price %', r.reseller_price; end if;
    /* No distributor discount obtained: buying price is the reseller price. */
    if r.buying_price <> 2000.00 then raise exception 'admin buying price at 0%% discount was %', r.buying_price; end if;

    update public.discount_approvals
       set decision_note = 'reviewed again'
     where id = 'dddddddd-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'an Admin could not decide an approval (% rows)', n; end if;

    select count(*) into n from public.approval_audit_log;
    if n <> 0 then raise exception 'unexpected audit rows in the fixture: %', n; end if;
  end $$;

  /* Not even an Admin writes the audit log from a browser. */
  do $$
  begin
    insert into public.approval_audit_log(company_id, quote_id, action, actor)
      values ('c0000000-0000-0000-0000-00000000000a', 'quote_pb_1', 'approved',
              'a0000000-0000-0000-0000-000000000001');
    raise exception 'THE AUDIT LOG IS CLIENT-WRITABLE — IT IS NOT AN AUDIT LOG';
  exception when insufficient_privilege then
    null;
  end $$;
rollback;

/* ── 6. ANOTHER COMPANY'S ADMIN gets nothing at all ─────────────────── */

begin;
  set local role authenticated;
  set local "request.jwt.claim.sub"  = 'a0000000-0000-0000-0000-000000000005';
  set local "request.jwt.claim.role" = 'authenticated';
  do $$
  declare
    n int;
  begin
    select count(*) into n from public.price_list_items;
    if n <> 0 then raise exception 'ANOTHER COMPANY READ % PRICE ROWS', n; end if;
  end $$;
  do $$
  begin
    perform * from public.price_book_search('c0000000-0000-0000-0000-00000000000a', null, null, 100);
    raise exception 'ANOTHER COMPANY SEARCHED OUR PRICE BOOK';
  exception when others then
    if sqlerrm not like '%not a member%' then raise; end if;
  end $$;
  do $$
  begin
    perform * from public.my_discount_approvals('c0000000-0000-0000-0000-00000000000a');
    raise exception 'ANOTHER COMPANY READ OUR APPROVALS';
  exception when others then
    if sqlerrm not like '%not a member%' then raise; end if;
  end $$;
rollback;

/* ── 7. the two things the schema must make impossible ──────────────── */

do $$
begin
  insert into public.price_lists(company_id, oem, period_year, period_month, status)
    values ('c0000000-0000-0000-0000-00000000000a', 'microsoft', 2026, 12, 'active');
  raise exception 'TWO ACTIVE MICROSOFT LISTS ALLOWED — WHICH ONE IS THE PRICE?';
exception when unique_violation then
  null;
end $$;

do $$
begin
  insert into public.discount_approvals(company_id, quote_id, requested_by, reason, state)
    values ('c0000000-0000-0000-0000-00000000000a', 'quote_pb_2',
            'a0000000-0000-0000-0000-000000000003', 'first', 'pending');
  insert into public.discount_approvals(company_id, quote_id, requested_by, reason, state)
    values ('c0000000-0000-0000-0000-00000000000a', 'quote_pb_2',
            'a0000000-0000-0000-0000-000000000003', 'second', 'pending');
  raise exception 'TWO PENDING APPROVALS ON ONE QUOTE ALLOWED';
exception when unique_violation then
  null;
end $$;

/* ── clean up, so the proof can be run again ─────────────────────────── */

delete from public.discount_approvals where company_id in
  ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000b');
delete from public.price_lists where company_id in
  ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000b');
delete from public.oem_margin_rules where company_id in
  ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000b');

reset request.jwt.claim.role;

select 'price book: every route to the cost is closed to Sales and Accounts' as proof;
