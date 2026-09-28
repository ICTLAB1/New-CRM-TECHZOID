/*
 * The CRM objects: deals, contacts, activities, tasks, automation rules and
 * an audit trail.
 *
 * ADDITIVE ONLY. Nothing existing is dropped, renamed or rewritten. Every
 * customer, quotation, proforma, invoice and purchase order is left exactly
 * as it is, and `customers.stage` keeps working — the old board runs on it
 * until the new screens replace it. That is deliberate: a migration that
 * cuts over the data AND the screens in one step has no state in which you
 * can compare the two.
 *
 * THE BACKFILL IS THE RISKY PART, so it is written to be re-runnable and to
 * be impossible to double. Every customer that is not concluded gets ONE
 * deal carrying their current stage and value, and every customer with a
 * contact name gets ONE contact row. Both are keyed deterministically off
 * the customer id, so running this twice inserts nothing the second time —
 * which matters, because a migration that has to be run exactly once is a
 * migration that will be run twice.
 *
 * Shapes follow the rest of this schema rather than inventing a new style:
 * a text id, an owner, a jsonb `data` blob, a company_id defaulted from
 * default_company_id(), and the same four policies every other table has.
 */

/* ── deals ──────────────────────────────────────────────────────────── */
create table if not exists public.deals (
  id text primary key,
  owner_id uuid not null default auth.uid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  /* The account it belongs to. Nullable on purpose: a deal can be raised
     against a lead that is not yet a customer record. */
  customer_id text,
  /* Denormalised so the board can sort and filter without opening the blob.
     Everything else lives in `data`, as with every other table here. */
  stage text not null default 'lead',
  value numeric(14,2) not null default 0,
  currency text not null default 'INR',
  expected_close date,
  concluded_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deals_company_stage_idx on public.deals (company_id, stage);
create index if not exists deals_customer_idx on public.deals (customer_id);
/* The forecast asks "what closes in this window", every time it is drawn. */
create index if not exists deals_close_idx on public.deals (company_id, expected_close);

/* ── contacts: many people per company, which `customers.contact` could
      never hold ─────────────────────────────────────────────────────── */
create table if not exists public.contacts (
  id text primary key,
  owner_id uuid not null default auth.uid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  customer_id text,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  /* Exactly one per account may be primary; enforced by the partial unique
     index below rather than by hope. */
  is_primary boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_customer_idx on public.contacts (customer_id);
create unique index if not exists contacts_one_primary_idx
  on public.contacts (company_id, customer_id) where is_primary;

/* ── activities: the timeline, as rows rather than a blob on the customer
      ────────────────────────────────────────────────────────────────── */
create table if not exists public.activities (
  id text primary key,
  owner_id uuid not null default auth.uid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  /* What it happened to. Kept loose on purpose — an activity can hang off a
     customer, a deal or a contact, and a foreign key per kind would mean a
     new column every time an object is added. */
  subject_type text not null,
  subject_id text not null,
  kind text not null default 'note',
  occurred_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activities_subject_idx on public.activities (company_id, subject_type, subject_id, occurred_at desc);

/* ── tasks and follow-ups ───────────────────────────────────────────── */
create table if not exists public.tasks (
  id text primary key,
  owner_id uuid not null default auth.uid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  subject_type text,
  subject_id text,
  title text not null default '',
  kind text not null default 'todo',
  due_on date,
  done_at timestamptz,
  /* Which automation raised it, where one did. Null means a person did —
     and that distinction is what makes "how much of this did the CRM do
     for us" answerable later. */
  rule_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_due_idx on public.tasks (company_id, due_on) where done_at is null;
create index if not exists tasks_owner_idx on public.tasks (owner_id, due_on) where done_at is null;

/* ── automation rules, and what they did ────────────────────────────── */
create table if not exists public.automation_rules (
  id text primary key,
  owner_id uuid not null default auth.uid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  name text not null default '',
  /* OFF until somebody switches it on. A rule that starts emailing
     customers the moment it is saved is one nobody got to read first. */
  enabled boolean not null default false,
  trigger text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rules_enabled_idx on public.automation_rules (company_id, trigger) where enabled;

create table if not exists public.automation_runs (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  rule_id text not null,
  subject_type text,
  subject_id text,
  /* 'fired', 'skipped', 'failed' — and the reason, in data. "Why did this
     not fire" is the question a rule engine gets asked, and it cannot be
     answered from the rule alone. */
  outcome text not null default 'fired',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists runs_rule_idx on public.automation_runs (company_id, rule_id, created_at desc);

/* ── audit trail ────────────────────────────────────────────────────── */
create table if not exists public.audit_log (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid,
  subject_type text not null,
  subject_id text not null,
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index if not exists audit_subject_idx on public.audit_log (company_id, subject_type, subject_id, created_at desc);

/* ── row-level security ─────────────────────────────────────────────────
   The SAME shape every other table in this schema uses: you must be a
   member of the company, and either own the row or be privileged in it.
   Written as a loop so a table cannot be added to the list and quietly
   miss a policy — which is exactly how `customers_all` survived migration
   033's hand-written drop list and left every customer readable. */
do $$
declare t text; c text;
begin
  foreach t in array array['deals','contacts','activities','tasks','automation_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    /* Dropped before created, so this file can be run twice. A migration
       that must be run exactly once is a migration that will be run
       twice — by a rebuild, by a rehearsal, by somebody being careful. */
    foreach c in array array['select','insert','update','delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_' || c, t);
    end loop;
    execute format($f$
      create policy %2$I on public.%1$I for select
        using (public.is_member(company_id) and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
    $f$, t, t || '_select');
    execute format($f$
      create policy %2$I on public.%1$I for insert
        with check (public.is_member(company_id) and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
    $f$, t, t || '_insert');
    execute format($f$
      create policy %2$I on public.%1$I for update
        using (public.is_member(company_id) and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
    $f$, t, t || '_update');
    execute format($f$
      create policy %2$I on public.%1$I for delete
        using (public.is_member(company_id) and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
    $f$, t, t || '_delete');
  end loop;
end $$;

/* The two ledgers are READ-ONLY to the client and written by the server.
   An audit trail a user can edit is not an audit trail, and a rule's run
   history is evidence about the rule rather than a record they own. */
alter table public.automation_runs enable row level security;
alter table public.audit_log enable row level security;
drop policy if exists automation_runs_select on public.automation_runs;
drop policy if exists audit_log_select on public.audit_log;
create policy automation_runs_select on public.automation_runs for select
  using (public.is_member(company_id) and public.is_privileged_in(company_id));
create policy audit_log_select on public.audit_log for select
  using (public.is_member(company_id) and public.is_privileged_in(company_id));
revoke insert, update, delete on public.automation_runs from anon, authenticated;
revoke insert, update, delete on public.audit_log from anon, authenticated;

/* Nothing here is callable by a signed-out visitor. */
revoke all on public.deals, public.contacts, public.activities, public.tasks,
  public.automation_rules, public.automation_runs, public.audit_log from anon;

/* ── backfill ───────────────────────────────────────────────────────────
 * Every open customer becomes one deal; every named contact becomes one
 * contact row. Nothing is deleted and `customers.data` is not rewritten —
 * the old board keeps running off customers.stage until the new screens
 * take over, so there is a period where both work and can be compared.
 *
 * THE IDS ARE DERIVED, NOT GENERATED. 'deal_' || customer id means running
 * this twice cannot produce a second deal for the same customer, and the
 * `on conflict do nothing` makes that explicit rather than incidental. A
 * backfill that doubles the pipeline on a rehearsal is worse than one that
 * refuses to run.
 *
 * A CONCLUDED CUSTOMER GETS NO DEAL. Won and Lost are conclusions of a
 * deal that is over; inventing an open deal for them would put every
 * customer you have ever sold to back into the forecast on day one.
 */
insert into public.deals (id, owner_id, company_id, customer_id, stage, value, currency, expected_close, data, created_at)
select
  'deal_' || c.id,
  c.owner_id,
  c.company_id,
  c.id,
  coalesce(nullif(c.data ->> 'stage', ''), 'lead'),
  /* `value` on a customer has always been free text as well as a number,
     so anything unparseable becomes zero rather than failing the migration
     for everybody. */
  coalesce((nullif(regexp_replace(coalesce(c.data ->> 'value', ''), '[^0-9.]', '', 'g'), ''))::numeric, 0),
  coalesce(nullif(c.data ->> 'currency', ''), 'INR'),
  nullif(c.data ->> 'nextFollowUp', '')::date,
  jsonb_build_object(
    'name', coalesce(nullif(c.data ->> 'company', ''), 'Opportunity'),
    'source', coalesce(c.data ->> 'source', ''),
    'backfilledFrom', 'customer',
    'backfilledAt', to_char(now(), 'YYYY-MM-DD')
  ),
  coalesce(c.created_at, now())
from public.customers c
where coalesce(nullif(c.data ->> 'stage', ''), 'lead') not in ('won', 'lost')
on conflict (id) do nothing;

insert into public.contacts (id, owner_id, company_id, customer_id, name, email, phone, is_primary, data, created_at)
select
  'contact_' || c.id,
  c.owner_id,
  c.company_id,
  c.id,
  c.data ->> 'contact',
  coalesce(c.data ->> 'email', ''),
  coalesce(c.data ->> 'phone', ''),
  true,
  jsonb_build_object(
    'designation', coalesce(c.data ->> 'designation', ''),
    'backfilledFrom', 'customer',
    'backfilledAt', to_char(now(), 'YYYY-MM-DD')
  ),
  coalesce(c.created_at, now())
from public.customers c
where coalesce(c.data ->> 'contact', '') <> ''
on conflict (id) do nothing;
