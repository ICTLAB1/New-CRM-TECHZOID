-- 022 — the front of the outreach funnel: prospects, imports, verification,
-- and the suppression list.
--
-- WHY PROSPECTS ARE NOT CUSTOMERS. `customers` is an account somebody is
-- selling to: it carries a stage, a deal value, an owner's forecast. A
-- prospect is a name on a list who has never replied. Putting ten thousand
-- imported rows into `customers` would put ten thousand deals on the pipeline
-- board and make every dashboard figure meaningless. A prospect graduates —
-- `customer_id` is set when one is created from them — and until then it
-- stays out of the sales numbers entirely.
--
-- SCHEMA CHANGE: four new tables. Nothing existing is touched. Safe to re-run.

create extension if not exists pgcrypto;

-- ── a batch somebody uploaded ─────────────────────────────────────────
create table if not exists public.prospect_imports (
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
create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- Set when this prospect becomes a real account. Null for everybody who
  -- has not replied yet, which is most of them.
  customer_id text references public.customers (id) on delete set null,
  import_id uuid references public.prospect_imports (id) on delete set null,

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
  on public.prospects (lower(email));

create index if not exists prospects_owner_idx  on public.prospects (owner_id, created_at desc);
create index if not exists prospects_status_idx on public.prospects (status) where not quarantined;
create index if not exists prospects_verify_idx on public.prospects (verification_status) where not quarantined;
create index if not exists prospects_import_idx on public.prospects (import_id);

-- ── what verification decided, and why ────────────────────────────────
-- Keyed by ADDRESS, not by prospect: a re-import of the same list should
-- reuse a recent verdict rather than pay for it again, and a verdict is a
-- fact about an address rather than about one row.
create table if not exists public.email_verifications (
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
  on public.email_verifications (lower(email), provider);
create index if not exists email_verifications_email_idx
  on public.email_verifications (lower(email), checked_at desc);

-- ── never write to these people again ─────────────────────────────────
create table if not exists public.suppression_list (
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
  on public.suppression_list (lower(email));

-- ── who may see what ──────────────────────────────────────────────────
alter table public.prospects           enable row level security;
alter table public.prospect_imports    enable row level security;
alter table public.email_verifications enable row level security;
alter table public.suppression_list    enable row level security;

-- Prospects follow the same rule as customers: yours, or you are privileged.
drop policy if exists "prospects_rw" on public.prospects;
create policy "prospects_rw" on public.prospects for all
  to authenticated
  using (owner_id = auth.uid() or public.is_privileged())
  with check (owner_id = auth.uid() or public.is_privileged());

drop policy if exists "prospect_imports_rw" on public.prospect_imports;
create policy "prospect_imports_rw" on public.prospect_imports for all
  to authenticated
  using (imported_by = auth.uid() or public.is_privileged())
  with check (imported_by = auth.uid() or public.is_privileged());

-- A verdict about an address is not private to a salesperson — two people
-- importing the same list must both see that it bounced. Read by anyone
-- signed in; written only by the server, which holds the service role.
drop policy if exists "email_verifications_read" on public.email_verifications;
create policy "email_verifications_read" on public.email_verifications for select
  to authenticated using (true);

-- SUPPRESSION IS READ BY EVERYONE AND ADDED TO BY ANYONE SIGNED IN. Adding
-- somebody is always safe — it can only stop mail going out. REMOVING is
-- deliberately absent: there is no policy for delete or update, so nobody
-- can quietly take a person off the list from the UI. Undoing a suppression
-- is a decision with a person behind it, not a button.
drop policy if exists "suppression_read" on public.suppression_list;
create policy "suppression_read" on public.suppression_list for select
  to authenticated using (true);

drop policy if exists "suppression_insert" on public.suppression_list;
create policy "suppression_insert" on public.suppression_list for insert
  to authenticated with check (true);

-- The unsubscribe endpoint is unauthenticated and runs as the service role,
-- which bypasses RLS — so anon needs nothing here at all.
revoke all on table public.prospects           from anon;
revoke all on table public.prospect_imports    from anon;
revoke all on table public.email_verifications from anon;
revoke all on table public.suppression_list    from anon;

-- Live, so a colleague importing a list sees it appear.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='prospects') then
    execute 'alter publication supabase_realtime add table public.prospects';
  end if;
end $$;
