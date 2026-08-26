-- Give the customers who were already here a customer ID.
--
-- LOOK BEFORE YOU RUN IT. This says exactly who would get what, and changes
-- nothing:
--
--   select
--     coalesce(nullif((select data ->> 'customerPrefix' from public.settings where id = 'main'), ''), 'CUST-')
--       || lpad((coalesce((select (data ->> 'customerSeq')::integer from public.settings where id = 'main'), 0)
--                + row_number() over (order by created_at, id))::text, 6, '0') as would_get,
--     data ->> 'company' as company,
--     created_at::date   as on_the_books_since
--   from public.customers
--   where coalesce(data ->> 'code', '') = ''
--   order by created_at, id;
--
-- DATA CHANGE, and the only one in this folder: it writes a `code` onto
-- customer records that have none. It adds nothing else and overwrites
-- nothing — a record that already carries a code is skipped, so running
-- this twice changes nothing the second time.
--
-- Run it AFTER 013, which is where the counter and the allocator live.
--
-- Order is oldest first, so the customer who has been on the books longest
-- is CUST-000001. Ties are broken by id, which makes the result the same
-- whichever way the rows happen to come back — a backfill that numbers
-- people differently on a re-run would be worse than one that never ran.
--
-- The counter in settings is left pointing past the last code handed out,
-- so the next customer added in the app continues the sequence rather than
-- colliding with one of these.

do $$
declare
  prefix text;
  seq integer;
  filled integer := 0;
  r record;
begin
  select coalesce(nullif(data ->> 'customerPrefix', ''), 'CUST-'),
         coalesce((data ->> 'customerSeq')::integer, 0)
    into prefix, seq
    from public.settings
   where id = 'main'
     for update;

  if not found then
    raise notice 'No settings row yet — nothing to number against. Save Settings once in the app, then run this again.';
    return;
  end if;

  for r in
    select id
      from public.customers
     where coalesce(data ->> 'code', '') = ''
     order by created_at asc, id asc
  loop
    seq := seq + 1;
    update public.customers
       set data = jsonb_set(
             coalesce(data, '{}'::jsonb),
             '{code}',
             to_jsonb(prefix || lpad(seq::text, 6, '0'))
           ),
           -- The row is touched so the app picks the change up. The record's
           -- own `updatedAt` is deliberately NOT bumped: nothing about this
           -- customer changed for the person who owns them, and making every
           -- account read as "just edited" would bury whatever really was.
           updated_at = now()
     where id = r.id;
    filled := filled + 1;
  end loop;

  update public.settings
     set data = jsonb_set(coalesce(data, '{}'::jsonb), '{customerSeq}', to_jsonb(seq))
   where id = 'main';

  raise notice 'Customer IDs written: %. Next number: %.', filled, seq + 1;
end $$;
