-- 028 — make the email keys usable by an upsert.
--
-- THE BUG. 022 wrote the uniqueness rule as an expression index:
--
--     create unique index outreach_prospects_email_key
--       on public.outreach_prospects (lower(email));
--
-- which is a correct rule and an unusable one. Postgres matches ON CONFLICT
-- against a unique index on the CONFLICT TARGET AS WRITTEN, and an index on
-- `lower(email)` does not satisfy `on conflict (email)`. PostgREST's upsert
-- takes a column list, not an expression, so every write path that relied on
-- one failed with:
--
--     there is no unique or exclusion constraint matching the
--     ON CONFLICT specification
--
-- Three paths were broken by it: importing prospects, adding somebody to the
-- suppression list from the CRM, and — the one that matters — the public
-- unsubscribe endpoint. A person clicking "unsubscribe" got a confirmation
-- page while the write behind it failed, because that endpoint deliberately
-- shows the same page whatever happens rather than leaking whether an id is
-- real. So it failed silently, which is the worst version of this.
--
-- THE FIX, and why it is this one. The rule that matters is "one prospect per
-- address, case-insensitively" — ravi@acme.example and Ravi@Acme.example are
-- one person. Two ways to keep it:
--
--   * keep the expression index and stop upserting. That means every caller
--     does select-then-insert, which is racy, and the race is exactly the
--     one the index exists to prevent.
--   * normalise on write and index the plain column. The uniqueness rule is
--     unchanged, and ON CONFLICT (email) then means what it says.
--
-- This is the second. A trigger lower-cases and trims on every insert and
-- update, so the guarantee does not depend on any caller remembering — a
-- future endpoint written by somebody who has not read this file cannot
-- reintroduce a duplicate that differs only in case.
--
-- SCHEMA CHANGE: three indexes replaced, one trigger function, three
-- triggers, and an in-place normalisation of any rows already stored. Safe to
-- re-run.

-- ── normalise what is already there ───────────────────────────────────
--
-- Before the plain unique index can be built, any rows that collide once
-- normalised have to be resolved — otherwise the index build fails and the
-- whole migration rolls back. The OLDEST row wins in each case: it is the one
-- other rows may already reference, and for a suppression it is the earliest
-- point from which "do not contact" has been true.
--
-- COMPARED ON THE NORMALISED FORM, not merely the lower-cased one. 022's
-- index already made two rows differing only in case impossible, so the
-- collision that actually exists in the data is a whitespace one:
-- '  ravi@acme.example ' and 'ravi@acme.example' have DIFFERENT lower()
-- values and so both got in. Comparing on lower() alone here misses exactly
-- the duplicates this has to find, and the update below then fails against
-- the old index — which is how this was caught.

do $$
begin
  -- prospects: keep the earliest row per address, repoint nothing (sends
  -- reference prospects by id and a duplicate has no sends by definition —
  -- it could never have been queued, because queueing goes through the
  -- audience rules which key on the address).
  delete from public.outreach_prospects a
   using public.outreach_prospects b
   where lower(btrim(a.email)) = lower(btrim(b.email))
     and (a.created_at, a.id) > (b.created_at, b.id);

  update public.outreach_prospects
     set email = lower(btrim(email))
   where email <> lower(btrim(email));

  delete from public.outreach_suppressions a
   using public.outreach_suppressions b
   where lower(btrim(a.email)) = lower(btrim(b.email))
     and (a.created_at, a.id) > (b.created_at, b.id);

  update public.outreach_suppressions
     set email = lower(btrim(email))
   where email <> lower(btrim(email));

  delete from public.outreach_verifications a
   using public.outreach_verifications b
   where lower(btrim(a.email)) = lower(btrim(b.email))
     and a.provider = b.provider
     and (a.checked_at, a.id) > (b.checked_at, b.id);

  update public.outreach_verifications
     set email = lower(btrim(email))
   where email <> lower(btrim(email));
end $$;

-- ── keep it that way ──────────────────────────────────────────────────
--
-- The trigger, not the caller, is what makes the plain index safe. Trimming
-- too: " ravi@acme.example" is the same person and a leading space is what a
-- paste from a spreadsheet produces.

create or replace function public.outreach_normalise_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end; $$;

drop trigger if exists outreach_prospects_normalise_email on public.outreach_prospects;
create trigger outreach_prospects_normalise_email
  before insert or update of email on public.outreach_prospects
  for each row execute function public.outreach_normalise_email();

drop trigger if exists outreach_suppressions_normalise_email on public.outreach_suppressions;
create trigger outreach_suppressions_normalise_email
  before insert or update of email on public.outreach_suppressions
  for each row execute function public.outreach_normalise_email();

drop trigger if exists outreach_verifications_normalise_email on public.outreach_verifications;
create trigger outreach_verifications_normalise_email
  before insert or update of email on public.outreach_verifications
  for each row execute function public.outreach_normalise_email();

-- ── the keys an upsert can actually name ──────────────────────────────
--
-- Dropped and rebuilt rather than renamed: the point is the change from an
-- expression to a column, which a rename would not make.

drop index if exists public.outreach_prospects_email_key;
create unique index if not exists outreach_prospects_email_key
  on public.outreach_prospects (email);

drop index if exists public.outreach_suppressions_email_key;
create unique index if not exists outreach_suppressions_email_key
  on public.outreach_suppressions (email);

drop index if exists public.outreach_verifications_latest_key;
create unique index if not exists outreach_verifications_latest_key
  on public.outreach_verifications (email, provider);

-- The lookup index on verifications was also written against lower(email)
-- and is merely redundant now rather than broken; replaced for consistency
-- so nobody has to wonder which of the two forms is current.
drop index if exists public.outreach_verifications_email_idx;
create index if not exists outreach_verifications_email_idx
  on public.outreach_verifications (email, checked_at desc);
