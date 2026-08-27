-- Finding a duplicate customer across the whole workspace, without showing
-- anybody a customer they are not allowed to see.
--
-- SCHEMA CHANGE: adds one function. No table, column or policy changes, and
-- no data is touched. Safe to re-run.
--
-- THE PROBLEM THIS SOLVES. Duplicate detection ran against the customers
-- already loaded in the browser — which RLS has scoped to the ones the
-- signed-in person may see. A Sales user therefore checked for duplicates
-- against their OWN customers only, and the case that actually matters —
-- two salespeople entering the same company a week apart — was invisible to
-- both of them. The first they learn of it is two quotations, two prices,
-- and one annoyed customer.
--
-- WHY A FUNCTION AND NOT A RELAXED POLICY. The answer needed is "somebody
-- already has this one, go and talk to them". That is three fields. Widening
-- the SELECT policy to make the local check work would hand every
-- salesperson every other salesperson's book — contacts, values, follow-up
-- dates, the lot. This returns the company name as stored, so the speller
-- can see it, and the owner's name, so they know who to ask. It returns no
-- contact details, no id, no value, and no notes.

create or replace function public.find_duplicate_customer(
  p_company text default '',
  p_phone   text default '',
  p_gstin   text default ''
)
returns table (reason text, company text, owner_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := lower(btrim(coalesce(p_company, '')));
  v_phone   text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
  v_gstin   text := upper(btrim(coalesce(p_gstin, '')));
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  -- Same suffix-stripping as the browser does, so the two agree about what
  -- counts as the same name. See normalizeCompanyName in
  -- src/domain/customers/duplicates.ts.
  v_company := btrim(regexp_replace(v_company,
    '\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|corp\.?)\.?$', '', 'gi'));
  v_company := btrim(regexp_replace(v_company,
    '\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|corp\.?)\.?$', '', 'gi'));

  -- Strongest signal first, and at most one row: this answers "is there
  -- one", not "list them".
  return query
  select x.reason, x.company, x.owner_name
  from (
    select
      case
        when v_gstin <> '' and upper(btrim(coalesce(c.data ->> 'gstin', ''))) = v_gstin then 'gstin'
        when v_phone <> '' and right(regexp_replace(coalesce(c.data ->> 'phone', ''), '[^0-9]', '', 'g'), 10) = v_phone then 'phone'
        else 'name'
      end as reason,
      coalesce(c.data ->> 'company', '') as company,
      coalesce(p.name, 'another user') as owner_name,
      case
        when v_gstin <> '' and upper(btrim(coalesce(c.data ->> 'gstin', ''))) = v_gstin then 1
        when v_phone <> '' and right(regexp_replace(coalesce(c.data ->> 'phone', ''), '[^0-9]', '', 'g'), 10) = v_phone then 2
        else 3
      end as rank
    from public.customers c
    left join public.profiles p on p.id = c.owner_id
    where
      (v_gstin <> '' and upper(btrim(coalesce(c.data ->> 'gstin', ''))) = v_gstin)
      or (v_phone <> '' and right(regexp_replace(coalesce(c.data ->> 'phone', ''), '[^0-9]', '', 'g'), 10) = v_phone)
      or (v_company <> '' and btrim(regexp_replace(
            btrim(regexp_replace(lower(btrim(coalesce(c.data ->> 'company', ''))),
              '\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|corp\.?)\.?$', '', 'gi')),
            '\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|corp\.?)\.?$', '', 'gi')) = v_company)
  ) x
  order by x.rank
  limit 1;
end;
$$;

revoke all on function public.find_duplicate_customer(text, text, text) from public;
grant execute on function public.find_duplicate_customer(text, text, text) to authenticated;
