-- A second company must not inherit the first one's document prefixes.
--
-- WHAT WENT WRONG, in the live workspace, before this. Vertex Infosolutions
-- was created, somebody switched to it and raised a quotation, and it came
-- out numbered TZ/QT/2026-27/0027 — TechZoid's initials, and the next number
-- in TechZoid's series. Two separate faults with the same shape:
--
--   1. create_company copied the whole settings blob minus a deny-list, and
--      the *Prefix keys were not on that list. So the new company started
--      life labelling its documents TZ.
--   2. The browser asked for a number with the two-argument form of
--      next_doc_number, which falls back to default_company_id() — the
--      caller's OLDEST membership, not the company on screen. Fixed in the
--      app; this migration is the data half.
--
-- The result was a document going to Vertex's customer carrying another
-- company's identity, which is the single thing the multi-company work was
-- meant to prevent.

-- TechZoid's own prefixes, written down rather than left to a default. Two
-- of them were never set and relied on the code's "TZ/INV" and "TZ/PO"
-- fallbacks; those fallbacks are now neutral, so making these explicit is
-- what keeps TechZoid numbering exactly as it always has.
update public.settings s
   set data = coalesce(s.data, '{}'::jsonb)
              || jsonb_build_object('invoicePrefix', coalesce(s.data ->> 'invoicePrefix', 'TZ/INV'))
              || jsonb_build_object('purchaseOrderPrefix', coalesce(s.data ->> 'purchaseOrderPrefix', 'TZ/PO')),
       updated_at = now()
 where s.company_id = (select id from public.companies order by created_at limit 1);

-- Every OTHER company loses the inherited prefixes. They fall through to the
-- neutral defaults (QT, PI, PO, INV, SO, DC) until somebody sets their own in
-- Settings, which is a document number that says nothing untrue.
update public.settings s
   set data = (coalesce(s.data, '{}'::jsonb)
               - 'quotePrefix' - 'proformaPrefix' - 'invoicePrefix'
               - 'purchaseOrderPrefix' - 'orderPrefix' - 'dispatchPrefix'),
       updated_at = now()
 where s.company_id is not null
   and s.company_id <> (select id from public.companies order by created_at limit 1);

-- And stop the inheritance at the source.
create or replace function public.create_company(p_name text, p_seed_settings boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  clean_name text;
  seed jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if not exists (
    select 1 from public.company_members
     where user_id = auth.uid() and role = 'Admin'
  ) then
    raise exception 'Only an admin can add a company.';
  end if;

  clean_name := btrim(coalesce(p_name, ''));
  if clean_name = '' then
    raise exception 'A company needs a name.';
  end if;
  if length(clean_name) > 200 then
    raise exception 'That name is too long.';
  end if;

  insert into public.companies (name) values (clean_name) returning id into new_id;

  insert into public.company_members (company_id, user_id, role)
  values (new_id, auth.uid(), 'Admin');

  /* The new company starts with the document LAYOUT, the terms and the tax
     defaults — how this business likes its paperwork to look — and with
     nothing that identifies the company it was created from. No counters, no
     GSTIN, no logo, no bank account, no integration keys, and no document
     prefixes: a prefix is initials, and initials are identity. */
  if p_seed_settings then
    select coalesce(data, '{}'::jsonb)
             - 'company' - 'quoteSeq' - 'proformaSeq' - 'purchaseOrderSeq'
             - 'invoiceSeq' - 'orderSeq' - 'dispatchSeq'
             - 'quotePrefix' - 'proformaPrefix' - 'invoicePrefix'
             - 'purchaseOrderPrefix' - 'orderPrefix' - 'dispatchPrefix'
             - 'webhook' - 'indiamart' - 'emailSignature' - 'uaeOffice' - 'bankAccounts'
      into seed
      from public.settings
     where company_id = public.default_company_id();
  end if;

  insert into public.settings (id, company_id, data)
  values (
    'company:' || new_id::text,
    new_id,
    coalesce(seed, '{}'::jsonb) || jsonb_build_object('company', jsonb_build_object('name', clean_name))
  );

  return new_id;
end;
$$;

revoke all on function public.create_company(text, boolean) from public, anon;
grant execute on function public.create_company(text, boolean) to authenticated;
