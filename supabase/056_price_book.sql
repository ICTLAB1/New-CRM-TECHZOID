/*
 * Price Book — the tables, and the rule that a salesperson never sees cost.
 *
 * WHAT THIS IS FOR. Admin uploads an OEM's reseller price list each month.
 * A BDE searching for a product may see the MINIMUM SELLING PRICE and
 * nothing else: not the reseller price it was derived from, not the
 * distributor discount, not the margin. Selling below that minimum needs
 * an Admin's approval, recorded.
 *
 * WHERE THE RULE LIVES, and this is the whole design: in the database, not
 * in the API and not in the browser. price_list_items holds the cost and
 * its row-level security policy admits only Admin and Manager. A BDE's
 * connection — which runs as `authenticated` with their own auth.uid() —
 * cannot select the column at all, however the request is shaped. The only
 * way a BDE reaches the price book is price_book_search(), which does not
 * select cost for anybody: the minimum price is computed inside it and the
 * cost never leaves the function. An API bug, a hand-made HTTP request or
 * a future endpoint written by somebody who has not read this file all hit
 * the same wall.
 *
 * ROLES, as company_members records them: Admin, Manager, Sales, Accounts.
 *   Admin    everything, and the only role that may approve a discount.
 *   Manager  sees cost and margin, may not approve.
 *   Sales    minimum selling price only.
 *   Accounts reads approved quotes; no cost.
 *
 * Idempotent: safe to run twice. Adds only; alters nothing that exists
 * beyond two nullable columns on `quotes`.
 */

/* ── who is asking ──────────────────────────────────────────────────── */

/* The caller's role in one company, or null if they are not in it.
   is_privileged_in() already answers "Admin or Manager"; approvals need
   to tell those two apart, and the price book needs the name itself. */
create or replace function public.role_in(p_company uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.company_members
   where user_id = auth.uid() and company_id = p_company
   limit 1
$$;

create or replace function public.is_admin_in(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members
     where user_id = auth.uid() and company_id = p_company and role = 'Admin'
  )
$$;

grant execute on function public.role_in(uuid) to authenticated;
grant execute on function public.is_admin_in(uuid) to authenticated;

/* ── the lists ──────────────────────────────────────────────────────── */

create table if not exists public.price_lists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  /* Free text, not an enum: a new OEM is a business decision, not a
     migration. The UI offers the five that are used today. */
  oem text not null,
  period_year int not null check (period_year between 2000 and 2100),
  period_month int not null check (period_month between 1 and 12),
  /* draft while it is being checked, active once it is the one in use,
     archived when a later month replaces it. History is kept: a quote
     has to be able to say which month's prices it was built on. */
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  /* Where the uploaded workbook itself is kept, so a disputed price can
     be traced back to the file it came from. */
  source_file text,
  source_name text,
  /* A hash of the uploaded workbook, so "this is the file we loaded" can be
     answered without keeping every workbook for ever. */
  source_sha256 text,
  /* WHICH SHEET, WHICH ROW WAS THE HEADER, AND WHICH COLUMN WAS WHAT. Kept
     per upload rather than in a templates table, because "the template for
     Microsoft" is exactly "what we did for Microsoft last month" — so next
     month's upload offers this back and is one click, and a row that turns
     out to have been read out of the wrong column can be traced to the
     mapping that read it. */
  sheet_name text,
  header_row int,
  column_map jsonb not null default '{}'::jsonb,
  uploaded_by uuid references public.profiles(id),
  row_count int not null default 0,
  error_count int not null default 0,
  note text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now()
);

/* ONE ACTIVE LIST PER OEM, enforced here rather than remembered. Two
   active lists for Microsoft means two different minimum prices for the
   same SKU, and which one a quote used would depend on row order. */
create unique index if not exists price_lists_one_active
  on public.price_lists (company_id, lower(oem)) where status = 'active';
/* And one list per OEM per month, so re-uploading a month replaces it
   rather than quietly adding a second copy. */
create unique index if not exists price_lists_period
  on public.price_lists (company_id, lower(oem), period_year, period_month);

create table if not exists public.price_list_items (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  sku text not null,
  product_name text not null,
  category text,
  licence_type text,
  unit text,
  /* THE COST. Everything in this file exists to keep this number away
     from a salesperson. */
  reseller_price numeric(14,2) not null check (reseller_price >= 0),
  currency text not null default 'INR',
  created_at timestamptz not null default now()
);

create index if not exists price_list_items_list_idx on public.price_list_items (price_list_id);
create unique index if not exists price_list_items_sku_idx
  on public.price_list_items (price_list_id, lower(sku));
/* Search by name or part number, which is how a BDE looks for a product. */
create index if not exists price_list_items_search_idx
  on public.price_list_items using gin (
    to_tsvector('simple', coalesce(product_name, '') || ' ' || coalesce(sku, '') || ' ' || coalesce(category, ''))
  );

/* ── the margin rules ───────────────────────────────────────────────── */

create table if not exists public.oem_margin_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  /* '*' is the company-wide default, used when an OEM has no rule. */
  oem text not null,
  /* null means "the whole OEM"; null sku means "the whole category". */
  category text,
  sku text,
  min_margin_pct numeric(6,3) not null check (min_margin_pct >= 0 and min_margin_pct < 1000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create unique index if not exists oem_margin_rules_one
  on public.oem_margin_rules (
    company_id, lower(oem), coalesce(lower(category), ''), coalesce(lower(sku), '')
  );

/**
 * The minimum margin that applies to one product: the most specific rule
 * wins — SKU, then category, then the OEM, then the company default.
 *
 * NO RULE AT ALL MEANS ZERO MARGIN, which makes the minimum selling price
 * equal to the reseller price. That is the safe end of the mistake: a
 * company that has not configured this yet cannot accidentally let a BDE
 * quote below cost, it just lets them quote at cost.
 */
create or replace function public.min_margin_pct(
  p_company uuid, p_oem text, p_category text, p_sku text
) returns numeric language sql stable security definer set search_path = public as $$
  select r.min_margin_pct
    from public.oem_margin_rules r
   where r.company_id = p_company
     and (lower(r.oem) = lower(p_oem) or r.oem = '*')
     and (r.category is null or lower(r.category) = lower(coalesce(p_category, '')))
     and (r.sku is null or lower(r.sku) = lower(coalesce(p_sku, '')))
   order by (r.sku is not null) desc,
            (r.category is not null) desc,
            (r.oem <> '*') desc
   limit 1
$$;

/** Reseller price plus the minimum margin, to the paisa. The distributor
 *  discount is deliberately NOT part of this: the minimum a BDE may sell
 *  at assumes no discount was obtained, so a discount that does come in
 *  is margin earned rather than margin spent. */
create or replace function public.min_selling_price(p_reseller numeric, p_margin_pct numeric)
returns numeric language sql immutable as $$
  select round(coalesce(p_reseller, 0) * (1 + coalesce(p_margin_pct, 0) / 100.0), 2)
$$;

/* NOT CALLABLE BY A BROWSER, and this is deliberate. The margin is the
   other half of the arithmetic: a BDE who knows the minimum price AND the
   minimum margin divides one by the other and reads the cost off the back
   of it. The price book functions below are SECURITY DEFINER and call
   these as their owner, which is how they keep working for a BDE who may
   not call them directly.
 *
 * REVOKED FROM authenticated AND anon BY NAME, not just from PUBLIC. This
 * database carries default privileges (pg_default_acl) that grant execute
 * on every new function in public to authenticated, anon and service_role
 * — a Supabase inheritance. So "revoke from public" leaves the grant that
 * matters untouched, and the proof caught exactly that: a Sales user
 * called min_margin_pct and was told 15%. service_role keeps it: that is
 * the server's own identity, used by the upload and approval jobs. */
revoke execute on function public.min_margin_pct(uuid, text, text, text) from public, authenticated, anon;
revoke execute on function public.min_selling_price(numeric, numeric) from public, authenticated, anon;

/* ── approvals ──────────────────────────────────────────────────────── */

create table if not exists public.discount_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  /* quotes.id is text in this schema. */
  quote_id text not null,
  quote_number text,
  requested_by uuid not null references public.profiles(id),
  reason text not null,
  note text,
  /* pending | approved | rejected | withdrawn */
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'withdrawn')),
  /* What the BDE asked for, line by line, as it stood when they asked:
     [{lineId, sku, qty, minPrice, requestedPrice}]. Kept with the request
     rather than read back off the quote, so a quote edited afterwards
     cannot change what was approved. */
  lines jsonb not null default '[]'::jsonb,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  /* The discount the Admin actually obtained from the distributor for
     this deal, 0–3.5% and occasionally more. Recorded because it is what
     turns a thin approved margin into a real one. */
  distributor_discount_pct numeric(6,3) check (distributor_discount_pct >= 0 and distributor_discount_pct < 100),
  /* The prices the Admin approved, which may differ from those asked for
     (a counter-offer): [{lineId, approvedPrice}]. */
  approved_lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discount_approvals_quote_idx on public.discount_approvals (quote_id);
create index if not exists discount_approvals_state_idx on public.discount_approvals (company_id, state);
/* One live request per quote: a second "please approve" while the first
   is still pending is the same conversation, not a new one. */
create unique index if not exists discount_approvals_one_pending
  on public.discount_approvals (quote_id) where state = 'pending';

create table if not exists public.approval_audit_log (
  id bigserial primary key,
  company_id uuid references public.companies(id) on delete cascade,
  approval_id uuid references public.discount_approvals(id) on delete cascade,
  quote_id text,
  line_id text,
  /* requested | approved | countered | rejected | withdrawn | repriced */
  action text not null,
  actor uuid references public.profiles(id),
  old_price numeric(14,2),
  new_price numeric(14,2),
  distributor_discount_pct numeric(6,3),
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists approval_audit_quote_idx on public.approval_audit_log (quote_id, at desc);

/* ── what a quote remembers about the price book ────────────────────── */

/* The month its prices came from, as 'YYYY-MM'. A quote expires at the
   end of that month unless an Admin set a date of its own, because the
   price it quoted is only true for the list it was built on. Nullable:
   every quote that already exists was built before any of this. */
alter table public.quotes add column if not exists price_list_period text;
/* Set when an approval unlocks the quote, so a later edit that lowers a
   price again can tell that it is lowering an APPROVED price and ask
   afresh. */
alter table public.quotes add column if not exists approved_at timestamptz;

/* ── who may read what ──────────────────────────────────────────────── */

alter table public.price_lists enable row level security;
alter table public.price_list_items enable row level security;
alter table public.oem_margin_rules enable row level security;
alter table public.discount_approvals enable row level security;
alter table public.approval_audit_log enable row level security;

do $$
begin
  /* The lists themselves are not secret — which OEM, which month, whether
     it is active. Everyone in the company may see that much; only an
     Admin may upload or activate one. */
  execute 'drop policy if exists price_lists_select on public.price_lists';
  execute 'create policy price_lists_select on public.price_lists for select
    using (public.is_member(company_id))';
  execute 'drop policy if exists price_lists_write on public.price_lists';
  execute 'create policy price_lists_write on public.price_lists for all
    using (public.is_admin_in(company_id)) with check (public.is_admin_in(company_id))';

  /* THE LINE THAT MATTERS. A Sales or Accounts user selecting from this
     table gets nothing back — not a redacted row, no row. The minimum
     price reaches them through price_book_search() instead, which never
     selects the cost column for anybody. */
  execute 'drop policy if exists price_list_items_select on public.price_list_items';
  execute 'create policy price_list_items_select on public.price_list_items for select
    using (public.is_privileged_in(company_id))';
  execute 'drop policy if exists price_list_items_write on public.price_list_items';
  execute 'create policy price_list_items_write on public.price_list_items for all
    using (public.is_admin_in(company_id)) with check (public.is_admin_in(company_id))';

  /* A margin rule is a cost secret too: it is the other half of the
     arithmetic, and knowing it plus the minimum price gives the cost. */
  execute 'drop policy if exists oem_margin_rules_select on public.oem_margin_rules';
  execute 'create policy oem_margin_rules_select on public.oem_margin_rules for select
    using (public.is_privileged_in(company_id))';
  execute 'drop policy if exists oem_margin_rules_write on public.oem_margin_rules';
  execute 'create policy oem_margin_rules_write on public.oem_margin_rules for all
    using (public.is_admin_in(company_id)) with check (public.is_admin_in(company_id))';

  /* ADMIN AND MANAGER ONLY, INCLUDING THE BDE'S OWN REQUESTS. The obvious
     policy here is "or requested_by = auth.uid()", so that a BDE can watch
     their own request — and it leaks. The row carries
     distributor_discount_pct, the discount the Admin got from the
     distributor, and the browser's query layer lets a caller name the
     columns it wants: ?select=distributor_discount_pct on one's own row
     would hand a BDE the number this module exists to keep from them. A
     BDE reads their requests through my_discount_approvals() below, which
     returns the columns they are entitled to and not that one. */
  execute 'drop policy if exists discount_approvals_select on public.discount_approvals';
  execute 'create policy discount_approvals_select on public.discount_approvals for select
    using (public.is_privileged_in(company_id))';
  /* DECIDING IS ADMIN-ONLY, and it is a database rule rather than a button
     that is not drawn: a Manager sees the cost picture and may not give
     margin away. No client holds insert or update on this table at all
     (see the grants below) — requesting and deciding will arrive as
     SECURITY DEFINER functions that also write the audit log, because an
     audit log a client could write around is not an audit log. These
     policies are the second wall behind that, so that a grant added here
     in future years cannot quietly make a Manager an approver. */
  execute 'drop policy if exists discount_approvals_insert on public.discount_approvals';
  execute 'create policy discount_approvals_insert on public.discount_approvals for insert
    with check (public.is_member(company_id) and requested_by = auth.uid())';
  execute 'drop policy if exists discount_approvals_decide on public.discount_approvals';
  execute 'create policy discount_approvals_decide on public.discount_approvals for update
    using (public.is_admin_in(company_id)) with check (public.is_admin_in(company_id))';

  /* The log is read-only from a browser: a page that could write it could
     record an approval that never happened. The server writes it. */
  execute 'drop policy if exists approval_audit_select on public.approval_audit_log';
  execute 'create policy approval_audit_select on public.approval_audit_log for select
    using (public.is_privileged_in(company_id))';
end $$;

grant select, insert, update, delete on public.price_lists to authenticated;
grant select, insert, update, delete on public.price_list_items to authenticated;
grant select, insert, update, delete on public.oem_margin_rules to authenticated;
/* READ ONLY, for the two roles the policies above admit. Writes go through
   SECURITY DEFINER functions so that every decision lands in the audit log
   in the same breath; a client that could insert here could record an
   approval that never happened. */
grant select on public.discount_approvals to authenticated;
grant select on public.approval_audit_log to authenticated;

/* ── the price book, as each role may see it ────────────────────────── */

/**
 * What a BDE searches. There is no cost column in the result because
 * there is no cost column in the select: the minimum price is computed
 * inside the function and the reseller price it came from never leaves.
 *
 * SECURITY DEFINER so that a Sales user, whose own policy denies them
 * price_list_items entirely, can still be told the minimum. Membership is
 * checked here instead — the function is the door, so the door is locked.
 *
 * Only ACTIVE lists: an archived month is history, not a price anybody
 * may quote from today.
 */
create or replace function public.price_book_search(
  p_company uuid, p_query text, p_oem text, p_limit int
) returns table (
  item_id uuid,
  oem text,
  sku text,
  product_name text,
  category text,
  licence_type text,
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
       and (
         p_query is null or btrim(p_query) = ''
         or i.sku ilike '%' || p_query || '%'
         or i.product_name ilike '%' || p_query || '%'
       )
     order by i.product_name
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

/**
 * The same search with the cost picture, for the two roles entitled to
 * it. It RAISES rather than returning an empty set when the caller is
 * not entitled: a Sales user who finds this endpoint should get a clear
 * refusal in the log, not a silent empty list that looks like "no
 * products matched".
 *
 * buying_price is reseller less the distributor discount for the deal in
 * hand, which is not known until an Admin negotiates it — so it is a
 * parameter here rather than a column anywhere.
 */
create or replace function public.price_book_search_costed(
  p_company uuid, p_query text, p_oem text, p_limit int, p_distributor_pct numeric
) returns table (
  item_id uuid,
  oem text,
  sku text,
  product_name text,
  category text,
  licence_type text,
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
       and (
         p_query is null or btrim(p_query) = ''
         or i.sku ilike '%' || p_query || '%'
         or i.product_name ilike '%' || p_query || '%'
       )
     order by i.product_name
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

/**
 * The minimum price for specific items, which is what a quote checks a
 * typed price against. Same rule as the search: no cost leaves.
 */
create or replace function public.price_book_minimums(p_company uuid, p_item_ids uuid[])
returns table (item_id uuid, sku text, min_price numeric, currency text, period text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_company) then raise exception 'not a member of that company'; end if;

  return query
    select i.id, i.sku,
           public.min_selling_price(
             i.reseller_price,
             public.min_margin_pct(i.company_id, l.oem, i.category, i.sku)
           ),
           i.currency,
           to_char(make_date(l.period_year, l.period_month, 1), 'YYYY-MM')
      from public.price_list_items i
      join public.price_lists l on l.id = i.price_list_id
     where i.company_id = p_company
       and i.id = any(coalesce(p_item_ids, '{}'::uuid[]));
end $$;

grant execute on function public.price_book_search(uuid, text, text, int) to authenticated;
grant execute on function public.price_book_search_costed(uuid, text, text, int, numeric) to authenticated;
grant execute on function public.price_book_minimums(uuid, uuid[]) to authenticated;

/* A signed-out caller has no business in the price book. Each of these
   refuses an anonymous caller on its own (auth.uid() is null), but the
   default privileges described above hand anon execute on every new
   function, and the house rule since migration 019 is to take it back by
   name rather than rely on the check inside. */
revoke execute on function public.price_book_search(uuid, text, text, int) from anon;
revoke execute on function public.price_book_search_costed(uuid, text, text, int, numeric) from anon;
revoke execute on function public.price_book_minimums(uuid, uuid[]) from anon;
revoke execute on function public.role_in(uuid) from anon;
revoke execute on function public.is_admin_in(uuid) from anon;

/**
 * A BDE's own approval requests, with the columns they are entitled to.
 *
 * Not a view and not a policy, because the table's select policy admits
 * only Admin and Manager — on purpose: the row carries the distributor
 * discount, and the browser's query layer lets a caller choose its own
 * columns, so any policy that let a BDE read their own row would let them
 * read that number off it. This function picks the columns instead.
 *
 * What comes back is their request, its state, the Admin's comment and the
 * prices that were approved — everything needed to show "approved at
 * ₹X" or "rejected because Y" — and nothing about cost.
 */
create or replace function public.my_discount_approvals(p_company uuid)
returns table (
  id uuid,
  quote_id text,
  quote_number text,
  reason text,
  note text,
  state text,
  lines jsonb,
  approved_lines jsonb,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_company) then raise exception 'not a member of that company'; end if;

  return query
    select a.id, a.quote_id, a.quote_number, a.reason, a.note, a.state,
           a.lines, a.approved_lines, a.decision_note, a.decided_at, a.created_at
      from public.discount_approvals a
     where a.company_id = p_company
       and a.requested_by = auth.uid()
     order by a.created_at desc;
end $$;

grant execute on function public.my_discount_approvals(uuid) to authenticated;
revoke execute on function public.my_discount_approvals(uuid) from anon;

/* ── loading a month's list ─────────────────────────────────────────────
   The upload endpoint parses the workbook (api/lib/priceListSheet.mjs) and
   hands the rows here as one jsonb array. One statement, one transaction:
   either the month is loaded or nothing changed. Doing it as five thousand
   inserts from the function host would leave a half-loaded list behind on
   any failure, and a half-loaded price list is worse than none — every SKU
   that did not make it becomes a product with no floor. */

/**
 * Load a month's price list, and optionally make it the active one.
 *
 * ADMIN ONLY, CHECKED HERE. The endpoint checks too, so that a BDE gets a
 * sentence rather than an exception, but this is the check that counts.
 *
 * RE-UPLOADING A MONTH REPLACES IT. The second upload of November is
 * somebody fixing the first, not a second November — and the unique index
 * on (company, oem, year, month) would refuse it anyway. The old rows go
 * with the old list row; quotations keep their own copy of what they were
 * priced at, so nothing already quoted changes.
 */
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
    price_list_id, company_id, sku, product_name, category, licence_type, unit,
    reseller_price, currency)
  select v_list, p_company,
         btrim(r->>'sku'),
         btrim(r->>'productName'),
         nullif(btrim(coalesce(r->>'category', '')), ''),
         nullif(btrim(coalesce(r->>'licenceType', '')), ''),
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

/**
 * Make one list THE list for its OEM, and archive the one it replaces.
 *
 * Separate from loading so that a list can be checked before it goes live:
 * upload, read the preview and the changes against last month, then
 * activate. The unique index enforces one active list per OEM whatever
 * happens here, so the archive and the activate have to be one statement —
 * which they are, inside this one transaction.
 */
create or replace function public.price_list_activate(p_list uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_oem text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select company_id, oem into v_company, v_oem from public.price_lists where id = p_list;
  if v_company is null then raise exception 'no such price list'; end if;
  if not public.is_admin_in(v_company) then
    raise exception 'only an Admin can activate a price list';
  end if;

  update public.price_lists
     set status = 'archived', updated_at = now()
   where company_id = v_company and lower(oem) = lower(v_oem)
     and status = 'active' and id <> p_list;

  update public.price_lists
     set status = 'active', activated_at = now(), updated_at = now()
   where id = p_list;
end $$;

/**
 * What this month's rows do to last month's: new SKUs, SKUs that have gone,
 * and the ones whose price moved.
 *
 * TAKES THE NEW ROWS AS jsonb so that the same function answers before the
 * list is loaded — which is when the answer is actually useful, because a
 * list where every price has jumped 400% is a list with the wrong column
 * mapped, and finding that out after loading it means every quotation
 * raised in between was priced off nonsense.
 *
 * PRIVILEGED ONLY. A price rise of 8% is a statement about the cost.
 */
create or replace function public.price_list_changes(p_company uuid, p_oem text, p_items jsonb)
returns table (
  change text,
  sku text,
  product_name text,
  was numeric,
  now_is numeric,
  change_pct numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_privileged_in(p_company) then
    raise exception 'a price comparison is for Admin and Manager only';
  end if;

  return query
  with incoming as (
    select lower(btrim(r->>'sku')) as key,
           btrim(r->>'sku') as sku,
           btrim(r->>'productName') as product_name,
           round((r->>'resellerPrice')::numeric, 2) as price
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as r
     where coalesce(btrim(r->>'sku'), '') <> ''
  ),
  current_list as (
    select lower(i.sku) as key, i.sku, i.product_name, i.reseller_price as price
      from public.price_list_items i
      join public.price_lists l on l.id = i.price_list_id
     where i.company_id = p_company
       and lower(l.oem) = lower(p_oem)
       and l.status = 'active'
  )
  select 'added', n.sku, n.product_name, null::numeric, n.price, null::numeric
    from incoming n left join current_list c on c.key = n.key
   where c.key is null
  union all
  select 'removed', c.sku, c.product_name, c.price, null::numeric, null::numeric
    from current_list c left join incoming n on n.key = c.key
   where n.key is null
  union all
  select 'changed', n.sku, coalesce(nullif(n.product_name, ''), c.product_name), c.price, n.price,
         case when c.price > 0 then round((n.price - c.price) / c.price * 100, 2) else null end
    from incoming n join current_list c on c.key = n.key
   where abs(n.price - c.price) > 0.005
   order by 1, 2;
end $$;

/**
 * The mapping used for this OEM last time, so next month is one click.
 *
 * The most recent list by period, not by upload time: a correction uploaded
 * for September after October has gone live should not become the template.
 */
create or replace function public.price_list_last_mapping(p_company uuid, p_oem text)
returns table (sheet_name text, header_row int, column_map jsonb, period text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_admin_in(p_company) then
    raise exception 'only an Admin loads price lists';
  end if;

  return query
    select l.sheet_name, l.header_row, l.column_map,
           to_char(make_date(l.period_year, l.period_month, 1), 'YYYY-MM')
      from public.price_lists l
     where l.company_id = p_company and lower(l.oem) = lower(p_oem)
       and l.column_map <> '{}'::jsonb
     order by l.period_year desc, l.period_month desc
     limit 1;
end $$;

/**
 * Every month on file for an OEM, with how many rows and which is live.
 *
 * MEMBERS, not just the privileged: a row count and a month carry no cost,
 * and a BDE being able to see that November's Microsoft list is the one in
 * force is how they know what they are quoting from.
 */
create or replace function public.price_list_history(p_company uuid, p_oem text)
returns table (
  id uuid, oem text, period text, status text, row_count int,
  source_name text, activated_at timestamptz, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_company) then raise exception 'not a member of that company'; end if;

  return query
    select l.id, l.oem,
           to_char(make_date(l.period_year, l.period_month, 1), 'YYYY-MM'),
           l.status, l.row_count, l.source_name, l.activated_at, l.created_at
      from public.price_lists l
     where l.company_id = p_company
       and (p_oem is null or lower(l.oem) = lower(p_oem))
     order by l.period_year desc, l.period_month desc, l.oem;
end $$;

/* The upload endpoint calls commit, activate, changes and last_mapping as
   the signed-in Admin, so the checks inside them are the ones that decide.
   History is the only one a browser needs directly. */
grant execute on function public.price_list_commit(uuid, text, int, int, jsonb, text, int, jsonb, text, text, boolean) to authenticated;
grant execute on function public.price_list_activate(uuid) to authenticated;
grant execute on function public.price_list_changes(uuid, text, jsonb) to authenticated;
grant execute on function public.price_list_last_mapping(uuid, text) to authenticated;
grant execute on function public.price_list_history(uuid, text) to authenticated;

revoke execute on function public.price_list_commit(uuid, text, int, int, jsonb, text, int, jsonb, text, text, boolean) from anon;
revoke execute on function public.price_list_activate(uuid) from anon;
revoke execute on function public.price_list_changes(uuid, text, jsonb) from anon;
revoke execute on function public.price_list_last_mapping(uuid, text) from anon;
revoke execute on function public.price_list_history(uuid, text) from anon;

/* ── asking, and deciding ───────────────────────────────────────────────
   Both are functions rather than table writes, because each one has to put
   a row in the audit log in the same breath. A client that could insert
   into discount_approvals directly could record an approval that never
   happened, or a request at a discount it then quietly changed. Neither
   table takes a client write at all — see the grants above. */

/**
 * A salesperson asks for a price below the floor.
 *
 * THE MINIMUM IS RECOMPUTED HERE AND THE CALLER'S IS IGNORED. The browser
 * sends which price book item each line is, how many, and what it wants to
 * charge — not what the floor is. If the floor came from the browser, a
 * salesperson could send "minimum ₹1,160, requested ₹1,150" on a product
 * whose floor is really ₹1,400, and the Admin's screen would show them a
 * ₹10 discount to approve. The whole approval would be theatre. So the
 * floor is read from the price book, under this function's own authority,
 * and what the caller claimed is not read at all.
 *
 * A LINE THAT IS NOT BELOW ITS FLOOR IS DROPPED rather than refused: a
 * quotation often has one line under and five over, and the five are not
 * what is being asked about.
 */
create or replace function public.request_discount_approval(
  p_company uuid,
  p_quote_id text,
  p_quote_number text,
  p_reason text,
  p_note text,
  p_lines jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_lines jsonb;
  v_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_company) then raise exception 'not a member of that company'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why the discount is needed';
  end if;

  /* The floor, from the price book, per line. */
  with asked as (
    select r->>'lineId'                        as line_id,
           nullif(r->>'itemId', '')::uuid      as item_id,
           coalesce((r->>'qty')::numeric, 1)   as qty,
           round((r->>'requestedPrice')::numeric, 2) as requested
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as r
  ),
  priced as (
    select a.line_id, a.item_id, a.qty, a.requested,
           i.sku, i.product_name,
           public.min_selling_price(
             i.reseller_price,
             public.min_margin_pct(i.company_id, l.oem, i.category, i.sku)) as min_price
      from asked a
      join public.price_list_items i on i.id = a.item_id
      join public.price_lists l on l.id = i.price_list_id
     where i.company_id = p_company and l.status = 'active'
  )
  select jsonb_agg(jsonb_build_object(
           'lineId', line_id, 'itemId', item_id, 'sku', sku, 'productName', product_name,
           'qty', qty, 'minPrice', min_price, 'requestedPrice', requested)
         order by line_id)
    into v_lines
    from priced
   where requested < min_price - 0.005;

  if v_lines is null or jsonb_array_length(v_lines) = 0 then
    raise exception 'none of those lines is below its minimum selling price';
  end if;

  insert into public.discount_approvals(
    company_id, quote_id, quote_number, requested_by, reason, note, state, lines)
  values (p_company, p_quote_id, nullif(btrim(coalesce(p_quote_number, '')), ''),
          auth.uid(), btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''), 'pending', v_lines)
  returning id into v_id;

  insert into public.approval_audit_log(company_id, approval_id, quote_id, line_id, action, actor, old_price, new_price, detail)
  select p_company, v_id, p_quote_id, r->>'lineId', 'requested', auth.uid(),
         (r->>'minPrice')::numeric, (r->>'requestedPrice')::numeric,
         jsonb_build_object('sku', r->>'sku', 'reason', btrim(p_reason))
    from jsonb_array_elements(v_lines) as r;

  select jsonb_array_length(v_lines) into v_count;
  return v_id;
end $$;

/**
 * An Admin decides.
 *
 * APPROVE AT A DIFFERENT PRICE is the same call with prices in p_lines: a
 * counter-offer is a decision, not a rejection, and it is recorded as the
 * price that was actually approved rather than the one that was asked for.
 *
 * THE DISTRIBUTOR DISCOUNT IS RECORDED WITH THE DECISION because it is
 * what turns a thin approved margin into a real one, and six months later
 * "why did we approve that" is answerable only if the number that made it
 * acceptable is written down next to it.
 */
create or replace function public.decide_discount_approval(
  p_approval uuid,
  p_decision text,
  p_lines jsonb,
  p_distributor_pct numeric,
  p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_quote text;
  v_state text;
  v_requested jsonb;
  v_approved jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select company_id, quote_id, state, lines
    into v_company, v_quote, v_state, v_requested
    from public.discount_approvals where id = p_approval;
  if v_company is null then raise exception 'no such approval request'; end if;
  if not public.is_admin_in(v_company) then
    raise exception 'only an Admin can decide a discount';
  end if;
  if v_state <> 'pending' then
    raise exception 'that request was already %', v_state;
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'a decision is approved or rejected';
  end if;
  if p_decision = 'rejected' and coalesce(btrim(coalesce(p_note, '')), '') = '' then
    raise exception 'say why it is rejected, so the salesperson can go back to the customer with something';
  end if;
  if p_decision = 'approved' and exists (
    select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as c
     where coalesce((c->>'approvedPrice')::numeric, 0) <= 0
  ) then
    raise exception 'an approved price has to be a price';
  end if;

  /* The approved price per line: what the Admin countered with, else what
     was asked for, EXACTLY AS GIVEN.
   *
   * An earlier version clamped this to the minimum selling price, which
   * had it backwards. The approved price is the floor for that line from
   * now on, so an Admin countering at ₹1,200 against a ₹1,150 minimum is
   * granting less discount than was asked for, not more — and clamping it
   * to ₹1,150 would have recorded an approval for a bigger discount than
   * the Admin gave. Countering the other way, below what was asked, is
   * allowed too: an Admin who says "I will do ₹1,000 to win it" means it.
   * Both directions are in the audit log with the requested price beside
   * them, which is the control; a silent clamp is not. */
  if p_decision = 'approved' then
    with asked as (
      select r->>'lineId' as line_id,
             (r->>'requestedPrice')::numeric as requested,
             (r->>'minPrice')::numeric as min_price
        from jsonb_array_elements(coalesce(v_requested, '[]'::jsonb)) as r
    ),
    countered as (
      select c->>'lineId' as line_id, round((c->>'approvedPrice')::numeric, 2) as approved
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as c
    )
    select jsonb_agg(jsonb_build_object(
             'lineId', a.line_id,
             'approvedPrice', coalesce(c.approved, a.requested))
           order by a.line_id)
      into v_approved
      from asked a left join countered c on c.line_id = a.line_id;
  else
    v_approved := '[]'::jsonb;
  end if;

  update public.discount_approvals
     set state = p_decision,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         distributor_discount_pct = p_distributor_pct,
         approved_lines = coalesce(v_approved, '[]'::jsonb),
         updated_at = now()
   where id = p_approval;

  insert into public.approval_audit_log(
    company_id, approval_id, quote_id, line_id, action, actor,
    old_price, new_price, distributor_discount_pct, detail)
  select v_company, p_approval, v_quote, r->>'lineId',
         case when p_decision = 'rejected' then 'rejected'
              when (select (c->>'approvedPrice')::numeric
                      from jsonb_array_elements(coalesce(v_approved, '[]'::jsonb)) c
                     where c->>'lineId' = r->>'lineId')
                   is distinct from (r->>'requestedPrice')::numeric
              then 'countered'
              else 'approved' end,
         auth.uid(),
         (r->>'minPrice')::numeric,
         (select (c->>'approvedPrice')::numeric
            from jsonb_array_elements(coalesce(v_approved, '[]'::jsonb)) c
           where c->>'lineId' = r->>'lineId'),
         p_distributor_pct,
         jsonb_build_object('sku', r->>'sku', 'requested', (r->>'requestedPrice')::numeric,
                            'note', nullif(btrim(coalesce(p_note, '')), ''))
    from jsonb_array_elements(coalesce(v_requested, '[]'::jsonb)) as r;

  /* The quotation unlocks from here: approved_at is what the trigger below
     and the editor both read. */
  if p_decision = 'approved' then
    update public.quotes set approved_at = now(), updated_at = now() where id = v_quote;
  end if;
end $$;

/** A salesperson takes their request back — they renegotiated, or the
 *  customer went away. An Admin may too, to clear a stale queue. */
create or replace function public.withdraw_discount_approval(p_approval uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_by uuid;
  v_quote text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select company_id, requested_by, quote_id into v_company, v_by, v_quote
    from public.discount_approvals where id = p_approval and state = 'pending';
  if v_company is null then raise exception 'no pending request to withdraw'; end if;
  if v_by <> auth.uid() and not public.is_admin_in(v_company) then
    raise exception 'that is not your request';
  end if;

  update public.discount_approvals
     set state = 'withdrawn', updated_at = now(), decided_at = now()
   where id = p_approval;

  insert into public.approval_audit_log(company_id, approval_id, quote_id, action, actor)
  values (v_company, p_approval, v_quote, 'withdrawn', auth.uid());
end $$;

/**
 * One request with the cost picture, for the Admin deciding it.
 *
 * Reseller price, the buying price at whatever discount the Admin has
 * negotiated, and the margin both ways. Admin and Manager only — a Manager
 * may look at the queue and cannot decide it.
 */
create or replace function public.approval_lines(p_approval uuid, p_distributor_pct numeric)
returns table (
  line_id text,
  sku text,
  product_name text,
  qty numeric,
  min_price numeric,
  requested_price numeric,
  approved_price numeric,
  reseller_price numeric,
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
  )
  select a.line_id, a.sku, a.product_name, a.qty, a.min_price, a.requested, d.approved,
         i.reseller_price,
         round(i.reseller_price * (1 - coalesce(p_distributor_pct, 0) / 100.0), 2) as buying_price,
         /* Of the sale, which is what every other margin figure in the CRM
            means, and over the buying price, which is what the minimum
            margin means. Both, because they are different numbers and both
            get called "margin". */
         case when a.requested > 0 then round(
           (a.requested - round(i.reseller_price * (1 - coalesce(p_distributor_pct, 0) / 100.0), 2))
           / a.requested * 100, 2) end,
         case when i.reseller_price > 0 then round(
           (a.requested - round(i.reseller_price * (1 - coalesce(p_distributor_pct, 0) / 100.0), 2))
           / round(i.reseller_price * (1 - coalesce(p_distributor_pct, 0) / 100.0), 2) * 100, 2) end
    from asked a
    left join decided d on d.line_id = a.line_id
    left join public.price_list_items i on i.id = a.item_id
   order by a.line_id;
end $$;

grant execute on function public.request_discount_approval(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.decide_discount_approval(uuid, text, jsonb, numeric, text) to authenticated;
grant execute on function public.withdraw_discount_approval(uuid) to authenticated;
grant execute on function public.approval_lines(uuid, numeric) to authenticated;

revoke execute on function public.request_discount_approval(uuid, text, text, text, text, jsonb) from anon;
revoke execute on function public.decide_discount_approval(uuid, text, jsonb, numeric, text) from anon;
revoke execute on function public.withdraw_discount_approval(uuid) from anon;
revoke execute on function public.approval_lines(uuid, numeric) from anon;

/* ── the lock, in the database ──────────────────────────────────────────
   "The quote is locked from sending" is a sentence about authority, and a
   disabled button is not one. The editor greys the button because that is
   kind; this refuses the write because that is the rule. */

/**
 * A quotation carrying a line below its floor cannot become a sent
 * quotation without an approval that covers it.
 *
 * ONLY ON THE WAY OUT. Draft is where a salesperson works out what to
 * charge, and a draft at any price is fine — this fires on the move to
 * Sent, Accepted or Paid. Editing a sent quotation's other fields does not
 * re-check, because the status is not changing.
 *
 * ONLY FOR LINES FROM THE PRICE BOOK. A line typed by hand, a service, or
 * anything quoted before the price book existed has no floor to be under.
 * Treating a missing minimum as zero would lock every old quotation for an
 * approval nobody could grant.
 *
 * A PRODUCT THAT HAS LEFT THE ACTIVE LIST HAS NO FLOOR EITHER, and that is
 * deliberate rather than an oversight: the floor is a statement about this
 * month's list, and a SKU the distributor has withdrawn is not on it. What
 * catches a quotation priced off an old list is its expiry, not this.
 *
 * service_role passes, as it does in prevent_self_role_escalation: the
 * server's own jobs are not the thing being guarded against, and a
 * migration that touched a quotation would otherwise fail the deploy.
 */
create or replace function public.enforce_discount_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old text := coalesce(OLD.data->>'status', '');
  v_new text := coalesce(NEW.data->>'status', '');
  v_bad record;
begin
  if v_new = v_old then return NEW; end if;
  if v_new not in ('Sent', 'Accepted', 'Paid') then return NEW; end if;
  if auth.role() = 'service_role' then return NEW; end if;
  if jsonb_typeof(NEW.data->'items') <> 'array' then return NEW; end if;

  select line.id as line_id, line.sku, line.rate, line.min_price
    into v_bad
    from (
      select it->>'id' as id,
             coalesce(it->>'sku', '') as sku,
             coalesce((it->>'rate')::numeric, 0) as rate,
             public.min_selling_price(
               i.reseller_price,
               public.min_margin_pct(i.company_id, l.oem, i.category, i.sku)) as min_price
        from jsonb_array_elements(NEW.data->'items') as it
        join public.price_list_items i on i.id = nullif(it->>'priceBookItemId', '')::uuid
        join public.price_lists l on l.id = i.price_list_id
       where l.status = 'active'
         and i.company_id = NEW.company_id
    ) as line
   where line.rate < line.min_price - 0.005
     /* ...and no approval that covers this line at this price. The
        approved price is a floor of its own: quoting at or above what was
        approved is allowed, below it is a fresh ask. */
     and not exists (
       select 1
         from public.discount_approvals a,
              jsonb_array_elements(coalesce(a.approved_lines, '[]'::jsonb)) as c
        where a.quote_id = NEW.id
          and a.state = 'approved'
          and c->>'lineId' = line.id
          and line.rate >= (c->>'approvedPrice')::numeric - 0.005
     )
   limit 1;

  if found then
    raise exception
      'Line % (%) is priced at % against a minimum of %. An Admin has to approve that discount before this quotation can be sent.',
      v_bad.line_id, v_bad.sku, v_bad.rate, v_bad.min_price
      using errcode = 'check_violation';
  end if;

  return NEW;
end $$;

drop trigger if exists trg_enforce_discount_approval on public.quotes;
create trigger trg_enforce_discount_approval
  before update on public.quotes
  for each row execute function public.enforce_discount_approval();
