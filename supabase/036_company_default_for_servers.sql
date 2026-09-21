-- A record written by the server must land somewhere, not be refused.
--
-- WHAT BROKE, and it reached a customer. Migration 033 made company_id NOT
-- NULL with a default of default_company_id(), which answers "the company of
-- whoever is signed in". Every server endpoint runs as the service role with
-- nobody signed in, so that default evaluated to NULL and the insert was
-- rejected. A customer filling in the registration form saw "Something went
-- wrong submitting your details" and the enquiry was lost. The website sync
-- and the IndiaMART poller were broken identically and would have failed
-- just as silently.
--
-- A default that depends on a session is no default at all for code that has
-- no session.
--
-- The endpoints now name the company explicitly, which is the real fix. This
-- is the floor under it: when there is no session AND the caller said
-- nothing, fall back to the oldest company rather than refusing the row.
--
-- WHY FALLING BACK IS RIGHT HERE, even though it can file a record under the
-- wrong business. The alternative is losing it. A lead in the wrong company
-- is visible, and somebody can move it; a lead rejected by a constraint is
-- gone, and the person who wrote it has already closed the tab. For records
-- a stranger creates, wrong-but-present beats correct-or-nothing. This is
-- NOT true of anything a signed-in person writes, which is why the
-- signed-in half of the answer is unchanged and still comes first.

create or replace function public.default_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select company_id from public.company_members
      where user_id = auth.uid()
      order by created_at, company_id
      limit 1),
    (select id from public.companies order by created_at limit 1)
  );
$$;

grant execute on function public.default_company_id() to authenticated;
