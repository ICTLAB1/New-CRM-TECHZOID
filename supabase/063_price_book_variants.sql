/* ─────────────────────────────────────────────────────────────────────
   Filtering a price book that now holds one row per variant.

   WHY THIS EXISTS. Until November 2026 a Microsoft list imported as 211
   rows, because the importer keyed on a SkuId that repeats for every term
   and billing plan the product is sold on and threw the rest away as
   duplicates. Fixed, the same workbook loads 4,887 rows — which is right,
   because a one-year licence billed monthly and a one-month licence are
   different things at different prices, and a salesperson needs the floor
   for the one they are actually quoting.

   It also made Browse unusable. Searching "Exchange online" returns a
   dozen rows that differ only in term, billing plan and segment, with no
   way to narrow them. So:

     · THE BILLING PLAN IS KEPT. It was read out of the workbook and then
       dropped on the floor — it went into the SKU and nowhere else, so
       "annual or monthly billing" could not be asked as a question. It is
       a column now.
     · SEARCH TAKES THE THREE AXES a variant varies on: term, billing plan
       and segment. Null means "any", so every existing caller is
       unaffected.
     · THE DROPDOWNS ARE BUILT FROM THE DATA, not from a list in the code.
       price_book_facets returns the values actually present in the active
       lists, with a count each. A hardcoded list of terms would be wrong
       the first time an OEM shipped a P2Y, and wrong silently.

   SIGNATURES CHANGE, so the old overloads are dropped first. Leaving them
   would make the call ambiguous and PostgREST would pick one of them at
   random — which, for a function that returns a price floor, is the kind
   of coin-toss nobody would ever debug.
   ───────────────────────────────────────────────────────────────────── */

/* ── the column ──────────────────────────────────────────────────── */

alter table public.price_list_items
  add column if not exists billing_plan text;

/* Browse filters on these three together, under a list. */
create index if not exists price_list_items_variant_idx
  on public.price_list_items (price_list_id, licence_type, billing_plan, category);

/* ── loading writes it ───────────────────────────────────────────── */

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
    reseller_price, currency)
  select v_list, p_company,
         btrim(r->>'sku'),
         btrim(r->>'productName'),
         nullif(btrim(coalesce(r->>'category', '')), ''),
         nullif(btrim(coalesce(r->>'licenceType', '')), ''),
         nullif(btrim(coalesce(r->>'billingPlan', '')), ''),
         nullif(btrim(coalesce(r->>'unit', '')), ''),
         (r->>'resellerPrice')::numeric,
         coalesce(nullif(btrim(coalesce(r->>'currency', '')), ''), 'INR')
    from jsonb_array_elements(p_items) as r;

  select count(*) into v_count from public.price_list_items where price_list_id = v_list;
  update public.price_lists set row_count = v_count where id = v_list;

  if coalesce(p_activate, false) then
    perform public.price_list_activate(v_list);
  end if;

  return query select v_list, v_count, v_replaced, coalesce(p_activate, false);
end $$;

/* ── search, with the three axes a variant varies on ─────────────── */

/* BOTH SIGNATURES GO. The old one, because leaving it would make the call
   ambiguous; the new one, because this file must be safe to run twice —
   every migration from 043 on is, and `create function` over an existing
   one is an error, not a replace. `create or replace` would not do here:
   with a different argument list it adds an overload rather than
   replacing, which is the ambiguity this is avoiding. */
drop function if exists public.price_book_search(uuid, text, text, int);
drop function if exists public.price_book_search(uuid, text, text, int, text, text, text);

create function public.price_book_search(
  p_company uuid,
  p_query text,
  p_oem text,
  p_limit int,
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
  min_price numeric,
  period text
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_company) then raise exception 'not a member of that company'; end if;

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
       /* Null is "any". An empty string is the same thing arriving from a
          <select> whose first option is "All", and must not be read as
          "rows whose term is the empty string" — which is no rows. */
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
           round(i.reseller_price * (1 - coalesce(p_distributor_pct, 0) / 100.0), 2) as buying_price,
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

/* ── what to put in the dropdowns ────────────────────────────────── */

/**
 * The terms, billing plans and segments actually present in the active
 * lists, with how many rows carry each.
 *
 * BUILT FROM THE DATA, NOT FROM A LIST IN THE CODE. A hardcoded set of
 * terms would be wrong the first time an OEM shipped a P2Y — and wrong
 * silently, because the filter would simply never offer it and nobody
 * would know those rows were unreachable. It also means an OEM with no
 * segments at all gets no segment filter rather than an empty one.
 *
 * The count is what lets the UI leave out a filter that would do nothing:
 * one value is not a choice.
 */
create or replace function public.price_book_facets(
  p_company uuid,
  p_oem text default null
) returns table (kind text, value text, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_company) then raise exception 'not a member of that company'; end if;

  return query
    with rows as (
      select i.licence_type, i.billing_plan, i.category
        from public.price_list_items i
        join public.price_lists l on l.id = i.price_list_id
       where i.company_id = p_company
         and l.status = 'active'
         and (p_oem is null or btrim(p_oem) = '' or lower(l.oem) = lower(btrim(p_oem)))
    )
    select 'term'::text, r.licence_type, count(*) from rows r
     where coalesce(btrim(r.licence_type), '') <> '' group by r.licence_type
    union all
    select 'billing'::text, r.billing_plan, count(*) from rows r
     where coalesce(btrim(r.billing_plan), '') <> '' group by r.billing_plan
    union all
    select 'segment'::text, r.category, count(*) from rows r
     where coalesce(btrim(r.category), '') <> '' group by r.category
     order by 1, 3 desc, 2;
end $$;

revoke all on function public.price_book_search(uuid, text, text, int, text, text, text) from public;
revoke all on function public.price_book_search_costed(uuid, text, text, int, numeric, text, text, text) from public;
revoke all on function public.price_book_facets(uuid, text) from public;

grant execute on function public.price_book_search(uuid, text, text, int, text, text, text) to authenticated;
grant execute on function public.price_book_search_costed(uuid, text, text, int, numeric, text, text, text) to authenticated;
grant execute on function public.price_book_facets(uuid, text) to authenticated;
