-- Document numbers that restart each financial year.
--
-- THE BUG THIS FIXES, which has not fired yet but has a date. Numbers are
-- printed as TZ/QT/2026-27/0024: a prefix, the Indian financial year, and a
-- sequence. The FY segment is computed from the date at the moment the
-- number is built, but the sequence behind it is ONE counter per document
-- kind that has never reset since the day it started. So at one minute past
-- midnight on 1 April 2027 the next quotation becomes TZ/QT/2027-28/0025 —
-- a new financial year opening at twenty-five. The label says "new year",
-- the number says "carry on", and every register printed from it disagrees
-- with itself. Nothing breaks loudly; it is simply wrong from that day on,
-- and it is wrong in the numbering of tax documents.
--
-- WHAT REPLACES IT. One row per (document type, financial year), holding the
-- number the next document of that type in that year will take. April comes,
-- there is no row for the new year, a row is created starting at 1. That is
-- the whole mechanism.
--
-- KEYED ON THE SAP OBJECT TYPE, not the old kind strings, so the series
-- lines up with the type now carried on every document — 23 quotation,
-- 13 A/R invoice, 22 purchase order, 17 sales order, 15 delivery, and 9001
-- for the proforma, which is ours and not SAP's.
--
-- THE FINANCIAL YEAR IS SUPPLIED BY THE CALLER, deliberately. The browser
-- computes the FY it is about to print and asks for a number in that year.
-- If the server worked it out instead, a server on UTC and a person in India
-- would disagree for five and a half hours across the night of 31 March —
-- the label printed and the counter incremented would be for different
-- years, on the one night of the year when that matters most. The value is
-- validated rather than trusted: it must look like a financial year and be
-- within one year of the server's own, so nobody can mint an arbitrary
-- series by asking for one.
--
-- next_doc_seq IS LEFT IN PLACE AND KEPT IN STEP. The old function still
-- works, and every allocation here also advances the legacy counter it
-- replaced. A deployment can be rolled back in one click; a rollback that
-- reissued document numbers already printed on a customer's invoice would be
-- a far worse problem than the one being fixed.

create table if not exists public.doc_series (
  obj_type integer not null,
  fy text not null,
  /* The number the NEXT document takes — the same convention the settings
     counters used, so the seeding below is a straight copy. */
  next_number integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (obj_type, fy)
);

alter table public.doc_series enable row level security;

-- Nobody reads or writes this table directly. Allocation happens through the
-- function below, which is SECURITY DEFINER: a client that could UPDATE the
-- row could hand itself a number already used.
revoke all on table public.doc_series from anon, authenticated;

/* The Indian financial year label for an instant: 1 April to 31 March,
   written 2026-27. Asia/Kolkata because the business is in India and the
   database server is not. */
create or replace function public.fy_label(p_at timestamptz)
returns text language sql stable set search_path = public as $$
  select case
    when extract(month from (p_at at time zone 'Asia/Kolkata')) >= 4
      then to_char((p_at at time zone 'Asia/Kolkata'), 'YYYY') || '-'
           || to_char((p_at at time zone 'Asia/Kolkata') + interval '1 year', 'YY')
    else to_char((p_at at time zone 'Asia/Kolkata') - interval '1 year', 'YYYY') || '-'
           || to_char((p_at at time zone 'Asia/Kolkata'), 'YY')
  end;
$$;

/* Which object types may have a series, and the legacy settings counter each
   one grew out of. Anything not in this list is refused rather than silently
   given a new series. */
create or replace function public.legacy_seq_key(p_obj_type integer)
returns text language sql immutable as $$
  select case p_obj_type
    when 23 then 'quoteSeq'
    when 9001 then 'proformaSeq'
    when 22 then 'purchaseOrderSeq'
    when 13 then 'invoiceSeq'
    when 17 then 'orderSeq'
    when 15 then 'dispatchSeq'
  end;
$$;

create or replace function public.next_doc_number(p_obj_type integer, p_fy text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  legacy_key text;
  this_fy text;
  this_year integer;
  asked_year integer;
  seeded integer;
  allocated integer;
begin
  if coalesce(auth.role(), '') = 'anon' then
    raise exception 'Not signed in.';
  end if;

  legacy_key := public.legacy_seq_key(p_obj_type);
  if legacy_key is null then
    raise exception 'unknown document type: %', p_obj_type;
  end if;

  if p_fy !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'financial year must look like 2026-27, got: %', p_fy;
  end if;

  /* Within a year of the server's own, so a caller cannot open a series in
     2099 and start printing from it. One year of slack covers the timezone
     boundary and a clock that is a little out. */
  this_fy := public.fy_label(now());
  this_year := split_part(this_fy, '-', 1)::integer;
  asked_year := split_part(p_fy, '-', 1)::integer;
  if abs(asked_year - this_year) > 1 then
    raise exception 'financial year % is too far from the current one (%)', p_fy, this_fy;
  end if;

  /* Where a brand new series starts. For the year already in progress that
     is wherever the old counter had reached — seeded HERE, at first use,
     rather than when this migration ran, so any documents issued between the
     two pick-ups are accounted for. For any other year it is 1, which is the
     entire point of the change. */
  if p_fy = this_fy then
    select greatest(coalesce((data ->> legacy_key)::integer, 1), 1)
      into seeded
      from public.settings where id = 'main';
  end if;
  seeded := coalesce(seeded, 1);

  insert into public.doc_series (obj_type, fy, next_number)
  values (p_obj_type, p_fy, seeded + 1)
  on conflict (obj_type, fy) do update
    set next_number = public.doc_series.next_number + 1,
        updated_at = now()
  returning public.doc_series.next_number - 1 into allocated;

  /* Keep the counter this replaced in step, so rolling the site back to the
     previous deployment cannot reissue a number already printed. Only for
     the current year: the legacy counter has no concept of another one. */
  if p_fy = this_fy then
    update public.settings
       set data = jsonb_set(coalesce(data, '{}'::jsonb), array[legacy_key], to_jsonb(allocated + 1)),
           updated_at = now()
     where id = 'main'
       and greatest(coalesce((data ->> legacy_key)::integer, 1), 1) <= allocated;
  end if;

  return allocated;
end;
$$;

revoke all on function public.next_doc_number(integer, text) from public, anon;
grant execute on function public.next_doc_number(integer, text) to authenticated;
