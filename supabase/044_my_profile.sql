-- "Who am I", answered by the database rather than guessed in the browser.
--
-- WHY. Under Entra the browser was finding its own profile by matching
-- `entra_oid` against the object id MSAL reports. That works for a member
-- of the tenant and NOT for a B2B guest: a guest has one object id in
-- their home tenant and a different one in the tenant they are a guest of,
-- and MSAL reports the home one while the access token carries the other.
-- The API had already linked the profile correctly -- the row was right,
-- the match was not -- so a guest signed in successfully and was then told
-- their account was not set up.
--
-- The browser should never have been matching ids at all. `auth.uid()` is
-- the id the API stamped after resolving the caller, so asking the
-- database costs one round trip and cannot disagree with itself.
create or replace function public.my_profile()
returns table (id uuid, name text, email text, role text, designation text, phone text)
language sql
stable
security invoker
as $$
  select p.id, p.name, p.email, p.role, p.designation, p.phone
    from public.profiles p
   where p.id = auth.uid();
$$;

-- SECURITY INVOKER, not DEFINER: the row-level policies on `profiles`
-- apply as they would to any other read, and the `where` makes the single
-- row explicit rather than relying on them alone.
revoke all on function public.my_profile() from public;
grant execute on function public.my_profile() to authenticated;
