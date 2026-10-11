-- The counter revokes, re-applied on Azure.
--
-- WHAT WENT WRONG. 019 revoked `anon`'s EXECUTE on the four functions that
-- advance a counter or answer a question about a customer, and explained why
-- the revoke has to be re-stated rather than assumed:
--
--   "TWO LAYERS, because the grant comes back on its own: any future
--    `create or replace` of these functions re-triggers those default
--    privileges silently."
--
-- That is precisely what the move to Azure did. `alter default privileges in
-- schema public grant execute on functions to anon` is part of the Supabase
-- role scaffold, and it is in force here too — so every function created by
-- `crmadmin` came out anon-executable, and 019's revokes were not replayed
-- afterwards. Confirmed from the outside, not inferred: an unauthenticated
-- POST to /api/rpc for `next_customer_code` returned a real code and advanced
-- the counter.
--
-- WHY THE GRANT IS THE ONLY DEFENCE HERE. These are `security definer`, so
-- RLS does not apply to what they do, and `next_customer_code` cannot grow an
-- "are you signed in" check — the public registration form calls it as
-- `service_role`, with no auth.uid() at all. 019 says so in as many words.
-- `find_duplicate_customer` and `my_lead_code` do refuse a null auth.uid(),
-- so they were never exposed; they are revoked anyway, on 019's reasoning
-- that a grant nothing needs is a grant worth not having.
--
-- WHAT THIS DOES NOT TOUCH. `service_role` keeps EXECUTE — the registration
-- form depends on it. `authenticated` keeps EXECUTE — that is every signed-in
-- salesperson adding a customer or allocating a document number.
--
-- Idempotent, and worth re-running after any `create or replace` of these.

begin;

-- 019's four, verbatim in intent.
revoke execute on function public.next_doc_seq(text) from anon;
revoke execute on function public.next_customer_code() from anon;
revoke execute on function public.find_duplicate_customer(text, text, text) from anon;
revoke execute on function public.my_lead_code() from anon;

-- 032/033/037 said the same for both next_doc_number signatures.
revoke execute on function public.next_doc_number(integer, text) from anon;
revoke execute on function public.next_doc_number(uuid, integer, text) from anon;

-- 044 is new enough that it was never covered by 019. It reads auth.uid(),
-- so anon learns nothing from it, but the grant is still one nothing needs.
revoke execute on function public.my_profile() from anon;

-- PUBLIC too: 013's and 018's `revoke all ... from public` did not survive
-- either, which is why `=X/crmadmin` is still sitting in these ACLs.
revoke all on function public.next_doc_seq(text) from public;
revoke all on function public.next_customer_code() from public;
revoke all on function public.find_duplicate_customer(text, text, text) from public;
revoke all on function public.my_lead_code() from public;
revoke all on function public.next_doc_number(integer, text) from public;
revoke all on function public.next_doc_number(uuid, integer, text) from public;
revoke all on function public.my_profile() from public;

-- And re-state what the signed-in CRM needs, so a revoke above can never
-- leave a salesperson unable to add a customer.
grant execute on function public.next_doc_seq(text) to authenticated;
grant execute on function public.next_customer_code() to authenticated;
grant execute on function public.find_duplicate_customer(text, text, text) to authenticated;
grant execute on function public.my_lead_code() to authenticated;
grant execute on function public.next_doc_number(integer, text) to authenticated;
grant execute on function public.next_doc_number(uuid, integer, text) to authenticated;
grant execute on function public.my_profile() to authenticated;

commit;
