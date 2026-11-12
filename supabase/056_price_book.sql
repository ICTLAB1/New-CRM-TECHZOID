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
