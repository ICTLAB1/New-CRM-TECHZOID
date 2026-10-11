/*
 * Payment Tracker — bills given on credit, and the reminders that chase them.
 *
 * A SEPARATE SECTION, ON PURPOSE. Nothing existing is read, altered or
 * dropped. The CRM's own `invoices` table and its Receivables screen are left
 * exactly as they are; this is a stand-alone ledger for bills raised outside
 * the CRM (Tally, by hand) that accounts enter themselves. Every name here
 * carries the `payment_` prefix so it can never be mistaken for, or collide
 * with, a CRM table.
 *
 * Three tables:
 *   payment_bills            one row per bill on credit
 *   payment_reminders        one row per reminder sent (or tried), the log
 *   payment_tracker_settings one row per company: who sends, the schedule,
 *                            WhatsApp template names, bank details
 *
 * Idempotent: safe to run twice.
 */

/* ── bills ─────────────────────────────────────────────────────────── */
create table if not exists public.payment_bills (
  id text primary key,
  owner_id uuid not null default auth.uid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  customer_id text,
  invoice_no text not null,
  customer_name text not null,
  contact_name text not null default '',
  email text not null default '',
  cc text not null default '',
  /* "<country code> <national number>", split when saved, because the
     WhatsApp sender posts the two halves separately. */
  phone text not null default '',
  invoice_date date not null,
  credit_days integer not null default 30,
  due_date date not null,
  amount numeric(14,2) not null default 0,
  /* Kept in step with `data.payments` by the app on every save, so the
     reminder engine can tell what is owed without opening the blob. */
  amount_paid numeric(14,2) not null default 0,
  currency text not null default 'INR',
  /* open | paid | written_off */
  status text not null default 'open',
  reminders_on boolean not null default true,
  /* Reminders hold until the day after this — "customer promised the 20th". */
  paused_until date,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_bills_company_idx on public.payment_bills (company_id);
create index if not exists payment_bills_due_idx on public.payment_bills (status, due_date);

/* ── the reminder log ──────────────────────────────────────────────── */
create table if not exists public.payment_reminders (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  bill_id text not null references public.payment_bills(id) on delete cascade,
  /* Which step of the schedule: "d-7", "d0", "d+3" … or "manual-<time>". */
  step text not null,
  /* email | whatsapp | digest */
  channel text not null,
  /* sending | sent | failed */
  state text not null default 'sending',
  sent_on date not null default current_date,
  send_to text not null default '',
  error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* THE GUARANTEE AGAINST A DOUBLE SEND. The engine claims a step by
   inserting this row before it sends; a second run, or a second server,
   hits this index and sends nothing. */
create unique index if not exists payment_reminders_once_idx
  on public.payment_reminders (bill_id, step, channel);
create index if not exists payment_reminders_bill_idx on public.payment_reminders (bill_id);

/* ── settings ──────────────────────────────────────────────────────── */
create table if not exists public.payment_tracker_settings (
  company_id uuid primary key default public.default_company_id() references public.companies(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

/* ── who may see and do what ───────────────────────────────────────── */
alter table public.payment_bills enable row level security;
alter table public.payment_reminders enable row level security;
alter table public.payment_tracker_settings enable row level security;

do $$
begin
  /* Bills: the same four rules as every record table in this schema. */
  execute 'drop policy if exists payment_bills_select on public.payment_bills';
  execute 'create policy payment_bills_select on public.payment_bills for select
    using (public.is_member(company_id) and (owner_id = auth.uid() or public.is_privileged_in(company_id)))';
  execute 'drop policy if exists payment_bills_insert on public.payment_bills';
  execute 'create policy payment_bills_insert on public.payment_bills for insert
    with check (public.is_member(company_id) and (owner_id = auth.uid() or public.is_privileged_in(company_id)))';
  execute 'drop policy if exists payment_bills_update on public.payment_bills';
  execute 'create policy payment_bills_update on public.payment_bills for update
    using (public.is_member(company_id) and (owner_id = auth.uid() or public.is_privileged_in(company_id)))
    with check (public.is_member(company_id) and (owner_id = auth.uid() or public.is_privileged_in(company_id)))';
  execute 'drop policy if exists payment_bills_delete on public.payment_bills';
  execute 'create policy payment_bills_delete on public.payment_bills for delete
    using (public.is_member(company_id) and (owner_id = auth.uid() or public.is_privileged_in(company_id)))';

  /* The log is READ-ONLY from the browser. Only the server writes it, so a
     page cannot fake "reminder sent" or clear the history. */
  execute 'drop policy if exists payment_reminders_select on public.payment_reminders';
  execute 'create policy payment_reminders_select on public.payment_reminders for select
    using (public.is_member(company_id))';

  /* Settings: every member reads (the screen shows the schedule); only an
     admin or manager changes who sends and what. */
  execute 'drop policy if exists payment_tracker_settings_select on public.payment_tracker_settings';
  execute 'create policy payment_tracker_settings_select on public.payment_tracker_settings for select
    using (public.is_member(company_id))';
  execute 'drop policy if exists payment_tracker_settings_insert on public.payment_tracker_settings';
  execute 'create policy payment_tracker_settings_insert on public.payment_tracker_settings for insert
    with check (public.is_privileged_in(company_id))';
  execute 'drop policy if exists payment_tracker_settings_update on public.payment_tracker_settings';
  execute 'create policy payment_tracker_settings_update on public.payment_tracker_settings for update
    using (public.is_privileged_in(company_id)) with check (public.is_privileged_in(company_id))';
end $$;

grant select, insert, update, delete on public.payment_bills to authenticated;
grant select on public.payment_reminders to authenticated;
grant select, insert, update on public.payment_tracker_settings to authenticated;
