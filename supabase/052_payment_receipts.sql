/*
 * Thank a customer for a payment, exactly once.
 *
 * WHAT THIS TABLE IS FOR, and it is not a log for its own sake: the
 * acknowledgement goes out the moment somebody records a payment, from a
 * screen, by hand. Screens get double-clicked, a save gets retried on a
 * flaky connection, and two people in accounts enter the same cheque
 * within a minute of each other. Every one of those is a second thank-you
 * to a customer for a payment they made once, which reads as either
 * incompetence or a second demand.
 *
 * THE CLAIM COMES FIRST, exactly as payment_reminders works: the row is
 * inserted before anything is sent, and the unique index on
 * (source, ref_id, payment_id) means the second attempt finds it already
 * there and sends nothing.
 *
 * TWO SOURCES, no foreign key. A payment is recorded either against a
 * Payment Tracker bill or against a CRM tax invoice, which are different
 * tables that share nothing, so the reference is (source, ref_id) as text
 * rather than a column pointing at one of them. company_id does have its
 * key, because that is what decides who may read the row.
 *
 * WRITTEN ONLY BY THE SERVER. The browser may read the log — the screen
 * shows whether a customer was thanked — but a page that could write it
 * could mark a payment acknowledged without sending anything, or clear
 * the history and send a customer a second one.
 *
 * Idempotent: safe to run twice.
 */

create table if not exists public.payment_receipts (
  /* '<source>:<ref_id>:<payment_id>' — stable, so a retry rebuilds the
     same id and collides with itself rather than inserting a twin. */
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  /* bill | invoice */
  source text not null,
  ref_id text not null,
  payment_id text not null,
  /* sending | sent | failed */
  state text not null default 'sending',
  send_to text not null default '',
  sent_on date not null default current_date,
  amount numeric(14,2) not null default 0,
  currency text not null default 'INR',
  error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payment_receipts_once_idx
  on public.payment_receipts (source, ref_id, payment_id);
create index if not exists payment_receipts_ref_idx
  on public.payment_receipts (source, ref_id);

alter table public.payment_receipts enable row level security;

do $$
begin
  execute 'drop policy if exists payment_receipts_select on public.payment_receipts';
  execute 'create policy payment_receipts_select on public.payment_receipts for select
    using (public.is_member(company_id))';
end $$;

grant select on public.payment_receipts to authenticated;
