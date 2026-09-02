-- 022 — the front of the outreach funnel: prospects, imports, verification,
-- and the suppression list.
--
-- WHY EVERY TABLE HERE IS PREFIXED `outreach_`. This database is shared with
-- another application, and that application already owns `public.prospects`,
-- `public.campaigns`, `public.sequence_steps`, `public.suppressions` and
-- `public.touches` — an outreach system of its own, occupying exactly the
-- names this module wants.
--
-- The first version of this migration created `public.prospects`. Because it
-- said `create table if not exists`, it did not fail — it SILENTLY DID
-- NOTHING, and left this CRM's code pointing at a table with entirely
-- different columns (campaign_id, vendor_focus, employee_band, dedupe_key).
-- Nothing would have gone wrong until somebody imported a list, and the error
-- then would have made no sense to anybody.
--
-- WHY A PREFIX AND NOT A SEPARATE SCHEMA. A dedicated `outreach` schema is the
-- tidier namespace, and it was built and tested that way first. It was undone
-- for one practical reason: PostgREST only serves schemas named in the
-- project's "Exposed schemas" setting, which is a dashboard toggle and cannot
-- be set from SQL. Ship the schema version and every query from the browser
-- fails with PGRST106 until somebody finds that setting — a migration that
-- looks applied but leaves the feature dead. A prefix needs no setting, works
-- the moment the migration runs, and rules out collision just as completely:
-- the other application's tables are all unprefixed, so `outreach_campaigns`
-- and `outreach_touches` stay free for us later too.
--
-- NOT RENAMED: email_accounts, email_domains and email_account_grants keep
-- their names. They are already live and hold three working refresh tokens;
-- they collide with nothing, and renaming them to gain symmetry would risk the
-- mailboxes the company sends quotations from.
--
-- SCHEMA CHANGE: four new tables. Nothing existing is touched — least of all
-- the other application's tables. Safe to re-run.

create extension if not exists pgcrypto;


-- ── a batch somebody uploaded ─────────────────────────────────────────
create table if not exists public.outreach_imports (
  id uuid primary key default gen_random_uuid(),
  imported_by uuid not null references public.profiles (id) on delete cascade,
  file_name text not null default '',
  -- What the user was shown before they pressed Import. Kept because "why
  -- did only 842 of my 1,000 rows arrive" is asked weeks later, and the
  -- answer has to survive the screen that displayed it.
  row_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ── the prospect ──────────────────────────────────────────────────────
create table if not exists public.outreach_prospects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- Set when this prospect becomes a real account. Null for everybody who
  -- has not replied yet, which is most of them.
  customer_id text references public.customers (id) on delete set null,
  import_id uuid references public.outreach_imports (id) on delete set null,

  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  full_name text not null default '',
  job_title text not null default '',
  company text not null default '',
  company_domain text not null default '',
  phone text not null default '',
  mobile text not null default '',
  linkedin text not null default '',
  industry text not null default '',
  country text not null default '',
  city text not null default '',

  -- §19. Free text with a default rather than an enum: the list is expected
  -- to grow, and a check constraint here means a migration every time
  -- somebody adds a status.
  status text not null default 'New',

  -- §6. The verdict, kept on the row so a list can be filtered without a
  -- join. The audit trail of HOW it was reached lives in email_verifications.
  verification_status text not null default 'Unknown',
  verification_reason text not null default '',
  verified_at timestamptz,

  -- §6 again: "DO NOT simply delete data silently." A rejected prospect is
  -- quarantined, with the reason attached, and can still be read.
  quarantined boolean not null default false,
  quarantine_reason text not null default '',

  source text not null default 'Import',
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  /* Anything the importer saw that has no column of its own. Never read for
     logic — it is there so an unmapped column is not thrown away. */
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ONE PROSPECT PER ADDRESS, ACROSS THE WHOLE WORKSPACE. Not per owner: the
-- failure this prevents is two salespeople importing the same list and the
-- prospect receiving the same introduction twice from two people at the same
-- company, which is the single most damaging thing an outreach tool can do.
create unique index if not exists prospects_email_key
  on public.outreach_prospects (lower(email));

create index if not exists prospects_owner_idx  on public.outreach_prospects (owner_id, created_at desc);
create index if not exists prospects_status_idx on public.outreach_prospects (status) where not quarantined;
create index if not exists prospects_verify_idx on public.outreach_prospects (verification_status) where not quarantined;
create index if not exists prospects_import_idx on public.outreach_prospects (import_id);

-- ── what verification decided, and why ────────────────────────────────
-- Keyed by ADDRESS, not by prospect: a re-import of the same list should
-- reuse a recent verdict rather than pay for it again, and a verdict is a
-- fact about an address rather than about one row.
create table if not exists public.outreach_verifications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null,
  reason text not null default '',
  -- Which check produced this. "local" for syntax/disposable/role/MX; a
  -- provider name when one is configured. Kept so a verdict can be re-run
  -- when the provider changes without re-running the ones that cannot move.
  provider text not null default 'local',
  raw jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

create unique index if not exists email_verifications_latest_key
  on public.outreach_verifications (lower(email), provider);
create index if not exists email_verifications_email_idx
  on public.outreach_verifications (lower(email), checked_at desc);

-- ── never write to these people again ─────────────────────────────────
create table if not exists public.outreach_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  -- 'unsubscribed' | 'hard-bounce' | 'complaint' | 'do-not-contact' | 'manual'
  reason text not null,
  source text not null default '',
  note text not null default '',
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists suppression_email_key
  on public.outreach_suppressions (lower(email));

-- ── who may see what ──────────────────────────────────────────────────
alter table public.outreach_prospects           enable row level security;
alter table public.outreach_imports    enable row level security;
alter table public.outreach_verifications enable row level security;
alter table public.outreach_suppressions    enable row level security;

-- Prospects follow the same rule as customers: yours, or you are privileged.
drop policy if exists "prospects_rw" on public.outreach_prospects;
create policy "prospects_rw" on public.outreach_prospects for all
  to authenticated
  using (owner_id = auth.uid() or public.is_privileged())
  with check (owner_id = auth.uid() or public.is_privileged());

drop policy if exists "prospect_imports_rw" on public.outreach_imports;
create policy "prospect_imports_rw" on public.outreach_imports for all
  to authenticated
  using (imported_by = auth.uid() or public.is_privileged())
  with check (imported_by = auth.uid() or public.is_privileged());

-- A verdict about an address is not private to a salesperson — two people
-- importing the same list must both see that it bounced. Read by anyone
-- signed in; written only by the server, which holds the service role.
drop policy if exists "email_verifications_read" on public.outreach_verifications;
create policy "email_verifications_read" on public.outreach_verifications for select
  to authenticated using (true);

-- SUPPRESSION IS READ BY EVERYONE AND ADDED TO BY ANYONE SIGNED IN. Adding
-- somebody is always safe — it can only stop mail going out. REMOVING is
-- deliberately absent: there is no policy for delete or update, so nobody
-- can quietly take a person off the list from the UI. Undoing a suppression
-- is a decision with a person behind it, not a button.
drop policy if exists "suppression_read" on public.outreach_suppressions;
create policy "suppression_read" on public.outreach_suppressions for select
  to authenticated using (true);

drop policy if exists "suppression_insert" on public.outreach_suppressions;
create policy "suppression_insert" on public.outreach_suppressions for insert
  to authenticated with check (true);

-- Supabase's default privileges already grant authenticated on new tables in
-- `public`, so these are strictly belt and braces — but they are cheap, and
-- they are what makes the migration correct on its own terms rather than
-- correct by inheriting a project setting. RLS narrows a privilege; it can
-- never conjure one, so a table missing its grant fails with "permission
-- denied" no matter how permissive the policies above look.
grant select, insert, update, delete on table public.outreach_prospects     to authenticated;
grant select, insert, update, delete on table public.outreach_imports       to authenticated;
grant select, insert, update, delete on table public.outreach_verifications to authenticated;
grant select, insert, update, delete on table public.outreach_suppressions  to authenticated;

-- The unsubscribe endpoint is unauthenticated and runs as the service role,
-- which bypasses RLS — so anon needs nothing here at all. In `public` this
-- revoke is not optional: Supabase's default privileges DID grant anon on
-- these tables at creation, and `revoke ... from public` would not have taken
-- it back, because anon is a real role holding a real grant. It has to be
-- named. This must run after the grants above so a future edit that widens a
-- grant is still closed off on the next run.
revoke all on table public.outreach_prospects     from anon;
revoke all on table public.outreach_imports       from anon;
revoke all on table public.outreach_verifications from anon;
revoke all on table public.outreach_suppressions  from anon;

-- Live, so a colleague importing a list sees it appear.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='outreach_prospects') then
    execute 'alter publication supabase_realtime add table public.outreach_prospects';
  end if;
end $$;
