/* ─────────────────────────────────────────────────────────────────────
   The distributor transfer price, read from the file instead of guessed.

   WHAT WAS WRONG. A price list states two prices per line. The ERP price
   is the estimated retail price — the list — and "Unit SELL Price" is the
   DTP: what the distributor sells to us at, which is our cost. The
   importer kept the first and threw the second away, and the CRM then
   RECONSTRUCTED the cost by asking an Admin to type a distributor
   discount percentage and applying it to the list price.

   That reconstruction is a guess, and it is not even a consistent one. In
   the November 2026 Microsoft workbook the DTP is 70% to 100% of the ERP
   depending on the line — median 80% on NCE and EST, 87.6% on PERPETUAL
   and SUBSCRIPTIONS, and equal to the ERP on 26 lines. One typed
   percentage cannot be right for all of them, so every margin shown to an
   Admin deciding a discount was wrong by however much that line differed
   from the number they typed.

   The file says it. We store it.

   WHO MAY SEE IT. The DTP is cost, and this schema's whole price book
   exists to keep cost away from Sales and Accounts — see the long note on
   min_selling_price, and supabase/proofs/056_price_book_proof.sql, which
   is what actually holds it to that. So:

     · price_book_search — the function a salesperson reaches — does NOT
       gain this column, and must never. Its return type is the door.
     · price_book_search_costed and approval_lines DO return it. Both
       already raise unless the caller is Admin or Manager.
     · The table itself is already closed to Sales by row-level security,
       which is what stops a hand-written /rest query reading it.

   THE TYPED PERCENTAGE STAYS as the fallback, for a list whose file
   carried no DTP column at all — an older upload, or a distributor who
   sends one price. buying_price() is that decision, in one place, so the
   two callers cannot drift.
   ───────────────────────────────────────────────────────────────────── */

alter table public.price_list_items
  add column if not exists dtp numeric(14,2) check (dtp is null or dtp >= 0);

comment on column public.price_list_items.dtp is
  'Distributor transfer price: what we buy at, as the price list states it. '
  'COST — never returned by price_book_search. Null when the file had no such column.';

/* ── the one place the buying price is decided ───────────────────────── */

/**
 * What we pay for a line.
 *
 * The DTP when the file gave one, and otherwise the list price less the
 * discount the Admin negotiated. Having both callers go through this is
 * the point: an approval screen and a price search that disagreed about
 * what a line costs would be two different margins for one deal.
 *
 * REVOKED FROM authenticated, like min_selling_price and for the same
 * reason: it is cost arithmetic, and the functions that call it are
 * SECURITY DEFINER, so they keep working for a caller who may not call
 * this directly.
 */
create or replace function public.buying_price(
  p_dtp numeric, p_reseller numeric, p_distributor_pct numeric
) returns numeric language sql immutable as $$
  select coalesce(
    p_dtp,
    round(coalesce(p_reseller, 0) * (1 - coalesce(p_distributor_pct, 0) / 100.0), 2)
  )
$$;

revoke execute on function public.buying_price(numeric, numeric, numeric) from public, authenticated, anon;

/* ── loading stores it ───────────────────────────────────────────────── */

create or replace function public.price_list_commit(
  p_company uuid,
  p_oem text,
  p_year int,
  p_month int,
  p_items jsonb,
  p_sheet text,
  p_header_row int,
  p_map jsonb,
  p_source_name text,
  p_sha text,
  p_activate boolean
) returns table (list_id uuid, items_loaded int, replaced boolean, activated boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_list uuid;
  v_old uuid;
  v_count int;
  v_replaced boolean := false;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_admin_in(p_company) then
    raise exception 'only an Admin can load a price list';
  end if;
  if coalesce(btrim(p_oem), '') = '' then raise exception 'which OEM is this list for?'; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'that is not a year'; end if;
  if p_month is null or p_month < 1 or p_month > 12 then raise exception 'that is not a month'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'no rows to load'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'that list has no usable rows in it'; end if;

  select id into v_old
    from public.price_lists
   where company_id = p_company and lower(oem) = lower(p_oem)
     and period_year = p_year and period_month = p_month;

  if v_old is not null then
    delete from public.price_lists where id = v_old;
    v_replaced := true;
  end if;

  insert into public.price_lists(
    company_id, oem, period_year, period_month, status, source_name, source_sha256,
    sheet_name, header_row, column_map, uploaded_by, row_count)
  values (
    p_company, btrim(p_oem), p_year, p_month, 'draft', p_source_name, p_sha,
    p_sheet, p_header_row, coalesce(p_map, '{}'::jsonb), auth.uid(), jsonb_array_length(p_items))
  returning id into v_list;

  insert into public.price_list_items(
    price_list_id, company_id, sku, product_name, category, licence_type, billing_plan, unit,
    reseller_price, dtp, currency)
  select v_list, p_company,
         btrim(r->>'sku'),
         btrim(r->>'productName'),
         nullif(btrim(coalesce(r->>'category', '')), ''),
         nullif(btrim(coalesce(r->>'licenceType', '')), ''),
         nullif(btrim(coalesce(r->>'billingPlan', '')), ''),
         nullif(btrim(coalesce(r->>'unit', '')), ''),
         (r->>'resellerPrice')::numeric,
         /* Absent, empty or unparseable leaves it null, which is "the file
            did not say" — and the typed percentage answers instead. A zero
            would be a claim that the line is free. */
         nullif(btrim(coalesce(r->>'dtp', '')), '')::numeric,
         coalesce(nullif(btrim(coalesce(r->>'currency', '')), ''), 'INR')
    from jsonb_array_elements(p_items) as r;

  select count(*) into v_count from public.price_list_items where price_list_id = v_list;
  update public.price_lists set row_count = v_count where id = v_list;

  if coalesce(p_activate, false) then
    perform public.price_list_activate(v_list);
  end if;

  return query select v_list, v_count, v_replaced, coalesce(p_activate, false);
end $$;

/* ── the costed search returns it ────────────────────────────────────── */

/* The return type changes, so these are dropped rather than replaced.
   Both signatures go, so the file is safe to run twice. */
drop function if exists public.price_book_search_costed(uuid, text, text, int, numeric);
drop function if exists public.price_book_search_costed(uuid, text, text, int, numeric, text, text, text);

create function public.price_book_search_costed(
  p_company uuid,
  p_query text,
  p_oem text,
  p_limit int,
  p_distributor_pct numeric,
  p_term text default null,
  p_billing text default null,
  p_segment text default null
) returns table (
  item_id uuid,
  oem text,
  sku text,
  product_name text,
  category text,
  licence_type text,
  billing_plan text,
  unit text,
  currency text,
  reseller_price numeric,
  dtp numeric,
  buying_price numeric,
  min_margin_pct numeric,
  min_price numeric,
  period text
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_privileged_in(p_company) then
    raise exception 'cost prices are for Admin and Manager only';
  end if;

  return query
    select i.id,
           l.oem,
           i.sku,
           i.product_name,
           i.category,
           i.licence_type,
           i.billing_plan,
           i.unit,
           i.currency,
           i.reseller_price,
           i.dtp,
           public.buying_price(i.dtp, i.reseller_price, p_distributor_pct) as buying_price,
           public.min_margin_pct(i.company_id, l.oem, i.category, i.sku) as min_margin_pct,
           public.min_selling_price(
             i.reseller_price,
             public.min_margin_pct(i.company_id, l.oem, i.category, i.sku)
           ) as min_price,
           to_char(make_date(l.period_year, l.period_month, 1), 'YYYY-MM') as period
      from public.price_list_items i
      join public.price_lists l on l.id = i.price_list_id
     where i.company_id = p_company
       and l.status = 'active'
       and (p_oem is null or lower(l.oem) = lower(p_oem))
       and (coalesce(btrim(p_term), '') = '' or lower(i.licence_type) = lower(btrim(p_term)))
       and (coalesce(btrim(p_billing), '') = '' or lower(i.billing_plan) = lower(btrim(p_billing)))
       and (coalesce(btrim(p_segment), '') = '' or lower(i.category) = lower(btrim(p_segment)))
       and (
         p_query is null or btrim(p_query) = ''
         or i.sku ilike '%' || p_query || '%'
         or i.product_name ilike '%' || p_query || '%'
       )
     order by i.product_name, i.licence_type, i.billing_plan
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke all on function public.price_book_search_costed(uuid, text, text, int, numeric, text, text, text) from public;
grant execute on function public.price_book_search_costed(uuid, text, text, int, numeric, text, text, text) to authenticated;

/* ── and so does the screen an Admin decides a discount on ───────────── */

drop function if exists public.approval_lines(uuid, numeric);

create function public.approval_lines(p_approval uuid, p_distributor_pct numeric)
returns table (
  line_id text,
  sku text,
  product_name text,
  qty numeric,
  min_price numeric,
  requested_price numeric,
  approved_price numeric,
  reseller_price numeric,
  dtp numeric,
  buying_price numeric,
  margin_at_requested numeric,
  markup_at_requested numeric
) language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select company_id into v_company from public.discount_approvals where id = p_approval;
  if v_company is null then raise exception 'no such approval request'; end if;
  if not public.is_privileged_in(v_company) then
    raise exception 'the cost picture is for Admin and Manager only';
  end if;

  return query
  with asked as (
    select r->>'lineId' as line_id,
           nullif(r->>'itemId', '')::uuid as item_id,
           r->>'sku' as sku,
           r->>'productName' as product_name,
           (r->>'qty')::numeric as qty,
           (r->>'minPrice')::numeric as min_price,
           (r->>'requestedPrice')::numeric as requested
      from public.discount_approvals a,
           jsonb_array_elements(coalesce(a.lines, '[]'::jsonb)) as r
     where a.id = p_approval
  ),
  decided as (
    select c->>'lineId' as line_id, (c->>'approvedPrice')::numeric as approved
      from public.discount_approvals a,
           jsonb_array_elements(coalesce(a.approved_lines, '[]'::jsonb)) as c
     where a.id = p_approval
  ),
  priced as (
    select a.*, d.approved, i.reseller_price, i.dtp,
           public.buying_price(i.dtp, i.reseller_price, p_distributor_pct) as buy
      from asked a
      left join decided d on d.line_id = a.line_id
      left join public.price_list_items i on i.id = a.item_id
  )
  select p.line_id, p.sku, p.product_name, p.qty, p.min_price, p.requested, p.approved,
         p.reseller_price, p.dtp, p.buy,
         /* Of the sale, which is what every other margin figure in the CRM
            means, and over the buying price, which is what the minimum
            margin means. Both, because they are different numbers and both
            get called "margin". */
         case when p.requested > 0 then round((p.requested - p.buy) / p.requested * 100, 2) end,
         case when p.buy > 0 then round((p.requested - p.buy) / p.buy * 100, 2) end
    from priced p
   order by p.line_id;
end $$;

revoke all on function public.approval_lines(uuid, numeric) from public;
grant execute on function public.approval_lines(uuid, numeric) to authenticated;
