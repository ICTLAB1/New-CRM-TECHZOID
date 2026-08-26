-- Short registration links, and a customer ID that allocates itself.
--
-- SCHEMA CHANGE: adds one column to public.profiles and two functions.
-- Nothing else is touched, no policy changes, no data is deleted. Safe to
-- re-run.

-- ── 1. a short code per salesperson ─────────────────────────────────
--
-- The registration link used to carry the salesperson's uuid:
--   https://crm.ttpldelhi.com/?lead=ebc9fe98-4434-4b13-82bd-887c…
-- 36 characters of hexadecimal, unreadable over the phone, ugly in a
-- WhatsApp message, and it puts an internal identifier in front of every
-- customer who is sent one. This replaces it with six characters.
--
-- The old form still works and always will — links are already out there in
-- people's inboxes, and breaking one means a customer meeting a dead page
-- with no way to tell anybody.
alter table public.profiles add column if not exists lead_code text;

-- Unique, but only where set: existing rows keep a null until they first
-- need a code, and two nulls do not collide.
create unique index if not exists profiles_lead_code_idx
  on public.profiles (lead_code) where lead_code is not null;

create extension if not exists pgcrypto;

/**
 * The caller's own short code, minting one the first time it is asked for.
 *
 * Security definer because a Sales user cannot be allowed to write another
 * person's row — and because uniqueness has to be settled by the database,
 * not by a browser that cannot see the other codes.
 *
 * The alphabet has no 0/O or 1/I/L: this gets read down a phone line and
 * typed by somebody who has never seen it. 31 characters over 6 places is
 * about 887 million codes, and the retry loop closes the gap between that
 * and certainty.
 *
 * `extensions` is in the search path because Supabase installs pgcrypto
 * there rather than into public, and gen_random_bytes() lives in it.
 */
create or replace function public.my_lead_code()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  existing text;
  candidate text;
  i integer;
  attempt integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select lead_code into existing from public.profiles where id = auth.uid();
  if existing is not null and existing <> '' then
    return existing;
  end if;

  loop
    attempt := attempt + 1;
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
    end loop;

    begin
      update public.profiles set lead_code = candidate where id = auth.uid();
      return candidate;
    exception when unique_violation then
      -- Someone else holds it. Try again; 887 million codes means this
      -- effectively never happens twice.
      if attempt >= 10 then
        raise exception 'Could not allocate a link code. Try again.';
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.my_lead_code() from public;
grant execute on function public.my_lead_code() to authenticated;

-- ── 2. the customer ID printed on documents ─────────────────────────
--
-- ALLOCATED IN THE DATABASE, and that is the whole point. Customers arrive
-- from two places that never see each other: a salesperson pressing "New
-- customer" in the app, and the public registration form, which runs on a
-- server with nobody watching. Two readers of the same counter, each doing
-- read-then-write, produce duplicate IDs — and a duplicate that appears on
-- a form submission at 2am is one nobody will ever catch.
--
-- One `update … returning` settles it: the row is locked for the duration,
-- so two callers queue rather than collide.
create or replace function public.next_customer_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  prefix text;
  seq integer;
begin
  -- The settings row is created by the app on first save; without it there
  -- is no counter to advance and no sensible number to invent.
  update public.settings
     set data = jsonb_set(
           coalesce(data, '{}'::jsonb),
           '{customerSeq}',
           to_jsonb(coalesce((data ->> 'customerSeq')::integer, 0) + 1)
         )
   where id = 'main'
  returning coalesce(nullif(data ->> 'customerPrefix', ''), 'CUST-'),
            (data ->> 'customerSeq')::integer
    into prefix, seq;

  if seq is null then
    return null;
  end if;

  return prefix || lpad(seq::text, 6, '0');
end;
$$;

revoke all on function public.next_customer_code() from public;
-- Signed-in users allocate one when they add a customer by hand; the public
-- registration form allocates through the service role, which is not granted
-- here because it bypasses privileges entirely.
grant execute on function public.next_customer_code() to authenticated;
