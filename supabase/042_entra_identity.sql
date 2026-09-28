-- Signing in with Entra ID, without rewriting who anybody is.
--
-- THE PROBLEM THIS SOLVES, AND THE OBVIOUS SOLUTION THAT IS WRONG.
-- Entra ID gives each person a uuid of its own (`oid`). It is not the uuid
-- they already have here. Every `owner_id` in this database — customers,
-- quotations, invoices, orders, leads, prospects, attachments — holds the
-- Supabase one, and 77 policies compare it against `auth.uid()`.
--
-- The obvious move is to rewrite every `owner_id` to the new value. That is
-- a mass update across fifteen tables and three foreign keys, on live data,
-- for cosmetic gain — and if it is half done, the policies match nothing and
-- every salesperson opens the CRM to an empty screen. There is no partial
-- failure that looks like anything other than total data loss to the person
-- looking at it.
--
-- So nobody's id changes. The Supabase uuid stays canonical, Entra's is
-- recorded next to it, and the API translates one into the other before it
-- stamps an identity. All 77 policies carry on comparing exactly what they
-- compared yesterday, and this migration adds one column and one function.
--
-- Reversible: drop the column and the CRM is back where it started.

begin;

-- Entra's object id for this person, once they have signed in with it.
-- Null until they do, which is what makes the cutover gradual: a workspace
-- can have some people linked and some not, and both can sign in.
alter table public.profiles
  add column if not exists entra_oid uuid;

-- One Entra account, one profile. Without this, two profiles could claim
-- the same external identity and which one you became would depend on row
-- order — the kind of bug that works fine until the day it does not.
create unique index if not exists profiles_entra_oid_key
  on public.profiles (entra_oid) where entra_oid is not null;

/**
 * Link an Entra account to the profile that already owns this person's work.
 *
 * SERVICE ROLE ONLY. It is called by the API after a token has been
 * verified, never by a browser — a caller who could run this could hand
 * themselves somebody else's records by naming their email.
 *
 * MATCHES ON EMAIL, which is only sound because of what the API has already
 * established before calling: the token's signature verified against the
 * tenant's published keys, its issuer matched the configured tenant, and
 * its audience matched this application. Within one company's own directory
 * an address identifies a person. Across the internet it identifies nothing,
 * which is why those three checks are not optional.
 *
 * NEVER CREATES A PROFILE. Somebody in the tenant who is not already a CRM
 * user gets null and is refused. Being an employee is not the same as
 * having an account here, and a function that quietly created one would
 * make it the same.
 *
 * @returns the internal user id, or null when there is nobody to link to.
 */
create or replace function public.link_entra_identity(p_oid uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email    text := lower(trim(coalesce(p_email, '')));
  v_existing uuid;
  v_id       uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'link_entra_identity is not callable from a browser';
  end if;
  if p_oid is null or v_email = '' then
    return null;
  end if;

  -- Already linked: return who they are and touch nothing. This is the
  -- common path — it runs on every request, not just the first one.
  select id into v_existing from public.profiles where entra_oid = p_oid;
  if v_existing is not null then
    return v_existing;
  end if;

  select id into v_id
    from public.profiles
   where lower(email) = v_email
     and entra_oid is null
   limit 1;

  if v_id is null then
    -- Either nobody here uses that address, or the profile that does is
    -- already linked to a DIFFERENT Entra account. Both are refusals, and
    -- deliberately the same refusal: distinguishing them would tell an
    -- outsider which addresses have accounts.
    return null;
  end if;

  update public.profiles set entra_oid = p_oid where id = v_id;
  return v_id;
end $function$;

revoke all on function public.link_entra_identity(uuid, text) from public, anon, authenticated;
grant execute on function public.link_entra_identity(uuid, text) to service_role;

commit;
