/*
 * Where a document series BEGINS, and a one-time bridge that had become
 * permanent.
 *
 * WHAT WENT WRONG. Migration 032 gave every (company, type, financial
 * year) its own counter so that 1 April opens at the start of a series
 * rather than continuing the old one. It also seeded a brand-new counter
 * from the legacy settings counter, so that a workspace that had been
 * numbering out of `settings` before 032 existed would not restart at 1
 * mid-year and re-issue numbers it had already used.
 *
 * That seeding was guarded only by "is this the current financial year",
 * which is true on 1 April of EVERY year. So the bridge that was meant to
 * fire once, for the changeover, would fire again each April and hand the
 * new year the old year's next number — defeating the per-year reset that
 * was the whole point of 032. Six months of runway on that, and nobody
 * would have looked until an auditor asked why FY 2027-28 opened at 1010.
 *
 * WHAT THIS DOES.
 *   - The bridge now fires only when this company has NO counter for this
 *     document type in ANY year, which is what "before 032" actually
 *     means. Once a series exists, the bridge is spent.
 *   - A new year opens at a number the company chooses, `<type>Start` in
 *     settings, defaulting to 1. TechZoid's tax invoices are set to 1001.
 *     Changing it has no effect on a year already running: the counter for
 *     that year already exists, and a series that renumbered itself
 *     mid-year would issue a number twice.
 *
 * Nothing about an existing number changes. This only affects what the
 * NEXT number is in a year that has not started yet.
 */

create or replace function public.series_start_key(p_obj_type integer)
returns text
language sql
immutable
as $$
  select case p_obj_type
    when 23 then 'quoteStart'
    when 9001 then 'proformaStart'
    when 22 then 'purchaseOrderStart'
    when 13 then 'invoiceStart'
    when 17 then 'orderStart'
    when 15 then 'dispatchStart'
  end;
$$;

create or replace function public.next_doc_number(p_company uuid, p_obj_type integer, p_fy text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  legacy_key text;
  start_key text;
  this_fy text;
  start_at integer;
  seeded integer;
  allocated integer;
  first_ever boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if not public.is_member(p_company) then
    raise exception 'You are not a member of that company.';
  end if;

  legacy_key := public.legacy_seq_key(p_obj_type);
  start_key := public.series_start_key(p_obj_type);
  if legacy_key is null then
    raise exception 'unknown document type: %', p_obj_type;
  end if;
  if p_fy !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'financial year must look like 2026-27, got: %', p_fy;
  end if;

  this_fy := public.fy_label(now());
  if abs(split_part(p_fy, '-', 1)::integer - split_part(this_fy, '-', 1)::integer) > 1 then
    raise exception 'financial year % is too far from the current one (%)', p_fy, this_fy;
  end if;

  /* Where this series opens a year it has not run before. */
  select greatest(coalesce((data ->> start_key)::integer, 1), 1)
    into start_at from public.settings where company_id = p_company;
  start_at := coalesce(start_at, 1);

  /* THE BRIDGE, AND WHY IT IS THIS CONDITION. A company that has never
     drawn a number of this type from doc_series may still have issued
     documents from the old settings counter. Opening at 1 would re-issue
     numbers it has already used. Once ANY year has a counter, that risk is
     gone and the legacy number is just a stale mirror. */
  select not exists (
    select 1 from public.doc_series
     where company_id = p_company and obj_type = p_obj_type
  ) into first_ever;

  if first_ever and p_fy = this_fy then
    select greatest(coalesce((data ->> legacy_key)::integer, 1), 1)
      into seeded from public.settings where company_id = p_company;
  end if;
  seeded := greatest(coalesce(seeded, start_at), start_at);

  insert into public.doc_series (company_id, obj_type, fy, next_number)
  values (p_company, p_obj_type, p_fy, seeded + 1)
  on conflict (company_id, obj_type, fy) do update
    set next_number = public.doc_series.next_number + 1,
        updated_at = now()
  returning public.doc_series.next_number - 1 into allocated;

  /* Keep the legacy mirror level, so the browser's preview of the next
     number is not a year out of date. Never moved backwards. */
  if p_fy = this_fy then
    update public.settings
       set data = jsonb_set(coalesce(data, '{}'::jsonb), array[legacy_key], to_jsonb(allocated + 1)),
           updated_at = now()
     where company_id = p_company
       and greatest(coalesce((data ->> legacy_key)::integer, 1), 1) <= allocated;
  end if;

  return allocated;
end;
$$;

revoke execute on function public.series_start_key(integer) from anon;
revoke execute on function public.next_doc_number(uuid, integer, text) from anon;
revoke execute on function public.next_doc_number(integer, text) from anon;
