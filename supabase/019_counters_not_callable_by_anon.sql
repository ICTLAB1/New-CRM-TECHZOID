-- 019 — the counter functions were callable without signing in.
--
-- FOUND BY LOOKING AT THE LIVE DATABASE, not by reading the migration:
--
--   select routine_name, grantee from information_schema.role_routine_grants
--   where specific_schema = 'public' and routine_name = 'next_doc_seq';
--   -- anon, authenticated, postgres, service_role
--
-- 018 ends with `revoke all on function ... from public`, which reads like
-- it closes this and does not. PUBLIC is the pseudo-role; `anon` is a real
-- one, and Supabase's default privileges grant EXECUTE on every new
-- function in `public` to anon and authenticated as it is created. The
-- revoke removes the pseudo-role's grant and leaves anon's untouched.
--
-- WHAT WAS EXPOSED. Nothing readable — neither function returns anybody's
-- data. But both ADVANCE A COUNTER, so anyone with the anon key (which is
-- in the JavaScript every visitor downloads, by design) could push
-- quotation numbers and customer IDs to arbitrary values by calling them in
-- a loop. next_customer_code has been open since 013; next_doc_seq since
-- 018 earlier the same day.
--
-- find_duplicate_customer and my_lead_code already refuse when auth.uid()
-- is null, so they were never exposed this way. They are revoked here too,
-- because a grant nothing needs is a grant worth not having.
--
-- TWO LAYERS, because the grant comes back on its own: any future
-- `create or replace` of these functions re-triggers those default
-- privileges silently. The in-function check is what still holds then.

revoke execute on function public.next_doc_seq(text) from anon;
revoke execute on function public.next_customer_code() from anon;
revoke execute on function public.find_duplicate_customer(text, text, text) from anon;
revoke execute on function public.my_lead_code() from anon;

-- The guard refuses ANON specifically rather than demanding a signed-in
-- user, and that distinction matters: next_customer_code is also called by
-- the public registration form, which runs server-side as service_role and
-- so has no auth.uid() at all. A "must be signed in" check there would
-- break new customers arriving from the form — the one path nobody would
-- think to test by hand.

create or replace function public.next_doc_seq(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  after integer;
begin
  if coalesce(auth.role(), '') = 'anon' then
    raise exception 'Not signed in.';
  end if;

  key := case p_kind
           when 'quote' then 'quoteSeq'
           when 'proforma' then 'proformaSeq'
           when 'purchaseOrder' then 'purchaseOrderSeq'
           when 'invoice' then 'invoiceSeq'
           when 'order' then 'orderSeq'
           when 'dispatch' then 'dispatchSeq'
         end;
  if key is null then
    raise exception 'unknown document kind: %', p_kind;
  end if;

  update public.settings
     set data = jsonb_set(
           coalesce(data, '{}'::jsonb),
           array[key],
           to_jsonb(greatest(coalesce((data ->> key)::integer, 1), 1) + 1)
         ),
         updated_at = now()
   where id = 'main'
  returning (data ->> key)::integer into after;

  if after is null then
    return null;
  end if;

  return after - 1;
end;
$$;

revoke all on function public.next_doc_seq(text) from public;
revoke execute on function public.next_doc_seq(text) from anon;
grant execute on function public.next_doc_seq(text) to authenticated;
