-- More than one company in one CRM.
--
-- WHAT CHANGES AND WHAT DOES NOT. Every record already belongs to a person
-- (owner_id) and every policy already reads "yours, or you are privileged".
-- That second half is the problem: is_privileged() means Admin or Manager,
-- and an Admin of the second company would see the first company's
-- customers, quotations and invoices. Ownership scopes a record to a person;
-- nothing scoped it to a business. This adds that, and leaves the ownership
-- rule exactly as it was.
--
-- MEMBERSHIP, NOT A COLUMN ON THE PROFILE. A person can belong to more than
-- one company — in a group of businesses that share staff, most of them do —
-- and their role can differ between them: a director in one, a salesperson
-- in the other. A single company_id on profiles could express neither.
-- company_members carries the pair, and the role that applies there.
--
-- EVERYTHING EXISTING BECOMES TECHZOID. The company is created from the name
-- already in settings, every existing record is assigned to it, and every
-- existing person is made a member with the role they already hold. Nobody
-- sees anything different the day this runs; that is the point of doing it
-- this way rather than asking anybody to re-file their work.
--
-- THE COLUMN HAS A DEFAULT ON PURPOSE. The website deploys separately from
-- the database, so for a while a version of the app that has never heard of
-- companies will still be inserting rows. Rather than have those fail, the
-- column defaults to the caller's own company. That default is safe while
-- everybody belongs to exactly one company, which is true until a second one
-- is created — so DEPLOY THE APP BEFORE ADDING THE SECOND COMPANY. There is
-- a note about this in the runbook and it is not a formality.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  /* The role this person holds IN THIS COMPANY. Same vocabulary as
     profiles.role, which stays where it is: it remains what governs things
     that are not company-scoped, such as managing sign-ins. */
  role text not null default 'Sales' check (role in ('Admin', 'Manager', 'Sales', 'Accounts')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index if not exists company_members_user_idx on public.company_members (user_id);

alter table public.companies enable row level security;
alter table public.company_members enable row level security;

/* ── who am I, and where ────────────────────────────────────────────── */

-- SECURITY DEFINER because these are read from inside the policies that
-- guard company_members itself; a policy that had to read the table it
-- guards would recurse. STABLE so one statement evaluates them once.

create or replace function public.my_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_members where user_id = auth.uid();
$$;

create or replace function public.is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members
     where user_id = auth.uid() and company_id = p_company
  );
$$;

/* Privileged IN A PARTICULAR COMPANY. The old is_privileged() asked whether
   somebody was an Admin anywhere, which with two companies is the wrong
   question — it is what would have let one company's Admin read the
   other's books. */
create or replace function public.is_privileged_in(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members
     where user_id = auth.uid()
       and company_id = p_company
       and role in ('Admin', 'Manager')
  );
$$;

/* The company a row lands in when the caller did not say. Their oldest
   membership: for everybody who belongs to one company that is simply
   theirs, and for anybody who belongs to two it is the one they were in
   first, which is why the app must be deployed before a second company
   exists. Never raises — a default that can fail is a table you cannot
   insert into. */
create or replace function public.default_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_members
   where user_id = auth.uid()
   order by created_at, company_id
   limit 1;
$$;

grant execute on function public.my_company_ids() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_privileged_in(uuid) to authenticated;
grant execute on function public.default_company_id() to authenticated;

/* ── the company that already exists ────────────────────────────────── */

do $$
declare
  existing uuid;
  company_name text;
begin
  select id into existing from public.companies limit 1;
  if existing is not null then return; end if;

  select coalesce(nullif(btrim(data -> 'company' ->> 'name'), ''), 'My company')
    into company_name from public.settings where id = 'main';

  insert into public.companies (name) values (coalesce(company_name, 'My company'))
  returning id into existing;

  /* Everybody who can already sign in keeps the role they already have. */
  insert into public.company_members (company_id, user_id, role)
  select existing, p.id,
         case when p.role in ('Admin', 'Manager', 'Sales', 'Accounts') then p.role else 'Sales' end
    from public.profiles p
  on conflict do nothing;
end $$;

/* ── company_id on everything that belongs to a company ─────────────── */

do $$
declare
  t text;
  first_company uuid;
begin
  select id into first_company from public.companies order by created_at limit 1;

  foreach t in array array[
    'customers', 'quotes', 'proformas', 'orders', 'challans',
    'invoices', 'purchase_orders', 'subscriptions', 'follow_ups', 'attachments'
  ] loop
    execute format('alter table public.%I add column if not exists company_id uuid references public.companies(id)', t);
    execute format('update public.%I set company_id = $1 where company_id is null', t) using first_company;
    execute format('alter table public.%I alter column company_id set default public.default_company_id()', t);
    execute format('alter table public.%I alter column company_id set not null', t);
    execute format('create index if not exists %I on public.%I (company_id)', t || '_company_idx', t);
  end loop;
end $$;

/* ── settings: one row per company ──────────────────────────────────── */

alter table public.settings add column if not exists company_id uuid references public.companies(id);

update public.settings s
   set company_id = (select id from public.companies order by created_at limit 1)
 where s.id = 'main' and s.company_id is null;

create unique index if not exists settings_company_idx on public.settings (company_id);

/* ── document numbering, per company ────────────────────────────────── */

alter table public.doc_series add column if not exists company_id uuid references public.companies(id);

update public.doc_series set company_id = (select id from public.companies order by created_at limit 1)
 where company_id is null;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.doc_series'::regclass and contype = 'p'
       and array_length(conkey, 1) = 2
  ) then
    alter table public.doc_series drop constraint doc_series_pkey;
    alter table public.doc_series alter column company_id set not null;
    alter table public.doc_series add primary key (company_id, obj_type, fy);
  end if;
end $$;

/* ── the policies ───────────────────────────────────────────────────── */

-- The shape, applied to every record table:
--   you may see a row when it is in a company you belong to, AND it is
--   yours or you are privileged IN THAT COMPANY.
-- Both halves are required. The first alone would let a salesperson read a
-- colleague's pipeline; the second alone is what leaked across companies.

do $$
declare
  t text;
  stale text;
  had_update boolean;
  had_delete boolean;
begin
  foreach t in array array[
    'customers', 'quotes', 'proformas', 'orders', 'challans',
    'invoices', 'purchase_orders', 'subscriptions', 'follow_ups', 'attachments'
  ] loop
    /* WHICH COMMANDS THIS TABLE ALREADY ALLOWED. attachments deliberately
       has no update policy — an attachment row is a fact about a file that
       was uploaded, not something to be edited afterwards — and a migration
       whose job is to CLOSE a hole must not quietly open a different one by
       handing out a permission the table never had. So the set of commands
       is preserved exactly; only the rule inside each one changes. */
    select bool_or(cmd = 'UPDATE'), bool_or(cmd = 'DELETE')
      into had_update, had_delete
      from pg_policies where schemaname = 'public' and tablename = t;

    /* EVERY policy goes, not a list of names guessed here. Postgres ORs
       permissive policies together, so one older policy left behind — a
       `<table>_all` from an early migration, say — re-opens everything this
       is closing, and the leak is invisible: the new policies are present
       and correct, the table simply has another way in. Caught exactly that
       way while proving this migration. */
    for stale in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', stale, t);
    end loop;

    execute format($f$
      create policy %I on public.%I for select
        using (public.is_member(company_id)
               and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
    $f$, t || '_select', t);

    execute format($f$
      create policy %I on public.%I for insert
        with check (public.is_member(company_id)
                    and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
    $f$, t || '_insert', t);

    if coalesce(had_update, false) then
      execute format($f$
        create policy %I on public.%I for update
          using (public.is_member(company_id)
                 and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
          with check (public.is_member(company_id)
                      and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
      $f$, t || '_update', t);
    end if;

    if coalesce(had_delete, false) then
      execute format($f$
        create policy %I on public.%I for delete
          using (public.is_member(company_id)
                 and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
      $f$, t || '_delete', t);
    end if;
  end loop;
end $$;

/* Settings are readable by any member of that company and writable only by
   somebody privileged in it. Same rule as before, now company-aware. */
drop policy if exists "settings_select_authenticated" on public.settings;
drop policy if exists "settings_update_privileged" on public.settings;
drop policy if exists "settings_select_member" on public.settings;
drop policy if exists "settings_update_privileged_member" on public.settings;
drop policy if exists "settings_insert_privileged_member" on public.settings;

create policy "settings_select_member" on public.settings for select
  using (company_id is null or public.is_member(company_id));
create policy "settings_update_privileged_member" on public.settings for update
  using (public.is_privileged_in(company_id)) with check (public.is_privileged_in(company_id));
create policy "settings_insert_privileged_member" on public.settings for insert
  with check (public.is_privileged_in(company_id));

/* A company is visible to its own members, and its name editable by
   somebody privileged in it. Creating one is not done here — it needs a
   settings row and a first member in the same breath, so it goes through a
   function below. */
drop policy if exists "companies_select_member" on public.companies;
drop policy if exists "companies_update_privileged" on public.companies;
create policy "companies_select_member" on public.companies for select
  using (public.is_member(id));
create policy "companies_update_privileged" on public.companies for update
  using (public.is_privileged_in(id)) with check (public.is_privileged_in(id));

/* You can see who else is in a company you belong to. Changing membership
   is an Admin's job, in that company. */
drop policy if exists "company_members_select" on public.company_members;
drop policy if exists "company_members_write" on public.company_members;
create policy "company_members_select" on public.company_members for select
  using (public.is_member(company_id));
create policy "company_members_write" on public.company_members for all
  using (public.is_privileged_in(company_id)) with check (public.is_privileged_in(company_id));

grant select on table public.companies to authenticated;
grant update (name) on table public.companies to authenticated;
grant select, insert, update, delete on table public.company_members to authenticated;
grant insert on table public.settings to authenticated;

/* ── creating one ───────────────────────────────────────────────────── */

/**
 * A new company, its settings row and its first member, in one transaction.
 *
 * NOT FOUR SEPARATE WRITES FROM THE BROWSER. A company with no members is
 * invisible to everybody including the person who just made it — no policy
 * would let them add themselves, because the check asks whether they are
 * already privileged in it. Half-creating one leaves an orphan row nobody
 * can see or remove. So it is one statement, as the database.
 *
 * WHO MAY. Somebody who is already an Admin somewhere. A CRM where any
 * signed-in salesperson can conjure companies is one where the company list
 * fills up with tests.
 *
 * The creator becomes its Admin, because otherwise nobody is.
 */
create or replace function public.create_company(p_name text, p_seed_settings boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  clean_name text;
  seed jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if not exists (
    select 1 from public.company_members
     where user_id = auth.uid() and role = 'Admin'
  ) then
    raise exception 'Only an admin can add a company.';
  end if;

  clean_name := btrim(coalesce(p_name, ''));
  if clean_name = '' then
    raise exception 'A company needs a name.';
  end if;
  if length(clean_name) > 200 then
    raise exception 'That name is too long.';
  end if;

  insert into public.companies (name) values (clean_name) returning id into new_id;

  insert into public.company_members (company_id, user_id, role)
  values (new_id, auth.uid(), 'Admin');

  /* The new company starts with the document layout, terms and tax defaults
     of the one it was created from, and NOTHING else: no counters, no
     GSTIN, no logo, no bank account, no integration keys. Carrying those
     over is how a second company ends up invoicing under the first one's
     tax number. The name is set; the rest is for somebody to fill in. */
  if p_seed_settings then
    select coalesce(data, '{}'::jsonb) - 'company' - 'quoteSeq' - 'proformaSeq'
             - 'purchaseOrderSeq' - 'invoiceSeq' - 'orderSeq' - 'dispatchSeq'
             - 'webhook' - 'indiamart' - 'emailSignature' - 'uaeOffice' - 'bankAccounts'
      into seed
      from public.settings
     where company_id = public.default_company_id();
  end if;

  insert into public.settings (id, company_id, data)
  values (
    'company:' || new_id::text,
    new_id,
    coalesce(seed, '{}'::jsonb) || jsonb_build_object('company', jsonb_build_object('name', clean_name))
  );

  return new_id;
end;
$$;

revoke all on function public.create_company(text, boolean) from public, anon;
grant execute on function public.create_company(text, boolean) to authenticated;

/* ── numbering, now per company ─────────────────────────────────────── */

/**
 * Changing doc_series' primary key to (company_id, obj_type, fy) broke the
 * allocator from migration 032: its `on conflict (obj_type, fy)` no longer
 * names a unique index, and Postgres matches a conflict target as written.
 * The same family of bug as 028. Rewritten here rather than left for
 * somebody to find when the first document of the year would not save.
 *
 * Two forms on purpose. The three-argument one is what the app calls once it
 * knows which company it is working in. The two-argument one is the old
 * signature, kept working by falling back to the caller's own company, so
 * the version of the site currently deployed keeps allocating numbers until
 * it is replaced.
 */
create or replace function public.next_doc_number(p_company uuid, p_obj_type integer, p_fy text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  legacy_key text;
  this_fy text;
  seeded integer;
  allocated integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if not public.is_member(p_company) then
    raise exception 'You are not a member of that company.';
  end if;

  legacy_key := public.legacy_seq_key(p_obj_type);
  if legacy_key is null then
    raise exception 'unknown document type: %', p_obj_type;
  end if;
  if p_fy !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'financial year must look like 2026-27, got: %', p_fy;
  end if;

  this_fy := public.fy_label(now());
  if abs(split_part(p_fy, '-', 1)::integer - split_part(this_fy, '-', 1)::integer) > 1 then
    raise exception 'financial year % is too far from the current one (%)', p_fy, this_fy;
  end if;

  /* A NEW COMPANY STARTS AT ONE, always. Only the company that carried the
     old settings counters continues from them, and only in the year already
     in progress — otherwise the second company's first invoice would be
     numbered 0025 because the first company had issued twenty-four. */
  if p_fy = this_fy then
    select greatest(coalesce((data ->> legacy_key)::integer, 1), 1)
      into seeded from public.settings where company_id = p_company;
  end if;
  seeded := coalesce(seeded, 1);

  insert into public.doc_series (company_id, obj_type, fy, next_number)
  values (p_company, p_obj_type, p_fy, seeded + 1)
  on conflict (company_id, obj_type, fy) do update
    set next_number = public.doc_series.next_number + 1,
        updated_at = now()
  returning public.doc_series.next_number - 1 into allocated;

  if p_fy = this_fy then
    update public.settings
       set data = jsonb_set(coalesce(data, '{}'::jsonb), array[legacy_key], to_jsonb(allocated + 1)),
           updated_at = now()
     where company_id = p_company
       and greatest(coalesce((data ->> legacy_key)::integer, 1), 1) <= allocated;
  end if;

  return allocated;
end;
$$;

create or replace function public.next_doc_number(p_obj_type integer, p_fy text)
returns integer language plpgsql security definer set search_path = public as $$
begin
  return public.next_doc_number(public.default_company_id(), p_obj_type, p_fy);
end;
$$;

revoke all on function public.next_doc_number(uuid, integer, text) from public, anon;
revoke all on function public.next_doc_number(integer, text) from public, anon;
grant execute on function public.next_doc_number(uuid, integer, text) to authenticated;
grant execute on function public.next_doc_number(integer, text) to authenticated;
