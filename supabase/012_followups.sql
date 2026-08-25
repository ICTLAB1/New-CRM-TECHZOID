-- Automatic follow-ups on a quotation that has been sent.
--
-- SCHEMA CHANGE: adds one table. Nothing else is touched, and no existing
-- table, column or policy changes. Safe to re-run.
--
-- WHAT THIS TABLE IS. Each row is one email that will leave this company
-- with nobody watching. That is the whole reason for its shape: the subject,
-- the message and the rendered HTML are stored HERE, written at the moment
-- the salesperson armed the sequence and saw them. Nothing is templated
-- later by the scheduler.
--
-- The alternative — storing a reference and re-rendering at send time —
-- means the email that goes out is one no human ever read, built by code
-- that may have changed since. Storing the words costs a few kilobytes a
-- row and buys the guarantee that what was previewed is what is sent.
--
-- The scheduler still re-checks the DOCUMENT before sending: a quotation
-- accepted, rejected or expired since arming must not be chased. That check
-- is deliberately not mirrored into a trigger here — the document lives in
-- a jsonb blob, and a trigger reaching into it would be a second, invisible
-- copy of a rule that belongs in one place.

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,

  -- What is being chased. `doc_id` is a text key like every other document
  -- id in this schema, and is deliberately NOT a foreign key: quotes,
  -- proformas and invoices are separate tables, and one column cannot
  -- reference all of them.
  doc_type text not null check (doc_type in ('quotation', 'proforma')),
  doc_id text not null,
  doc_number text not null default '',
  customer_id text,
  customer_name text not null default '',

  -- Which of how many, so a person reading a list sees "2 of 3".
  step integer not null check (step >= 1),
  steps integer not null check (steps >= 1),
  tone text not null check (tone in ('nudge', 'check', 'final')),

  -- A date, not a timestamp: what is scheduled is a day's work. The
  -- scheduler runs once a morning and sends everything up to today, so a
  -- day it did not run is caught up rather than skipped.
  due_on date not null,

  state text not null default 'scheduled'
    check (state in ('scheduled', 'sent', 'failed', 'cancelled')),

  -- The message, as written and previewed at arming time.
  send_to text not null,
  cc text not null default '',
  reply_to text not null default '',
  subject text not null default '',
  message text not null default '',
  html text,

  sent_at timestamptz,
  -- Why it did not go, in words a salesperson can act on. Never a stack
  -- trace: this is shown on a document screen, not in a log.
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.follow_ups enable row level security;

-- The same rule as every document table: yours, or anything if you are an
-- Admin or Manager. A follow-up is part of the deal it chases, so whoever
-- can see the quotation can see what is queued against it.
drop policy if exists "follow_ups_select" on public.follow_ups;
create policy "follow_ups_select" on public.follow_ups for select
  using (owner_id = auth.uid() or public.is_privileged());

drop policy if exists "follow_ups_insert" on public.follow_ups;
create policy "follow_ups_insert" on public.follow_ups for insert
  with check (owner_id = auth.uid() or public.is_privileged());

-- Update exists so a sequence can be STOPPED from the app. It is also the
-- only way a client can touch a row after arming, and it is why `state` is
-- constrained above: a client cannot invent a state the scheduler does not
-- understand, and cannot mark something 'sent' that was never sent.
drop policy if exists "follow_ups_update" on public.follow_ups;
create policy "follow_ups_update" on public.follow_ups for update
  using (owner_id = auth.uid() or public.is_privileged())
  with check (owner_id = auth.uid() or public.is_privileged());

drop policy if exists "follow_ups_delete" on public.follow_ups;
create policy "follow_ups_delete" on public.follow_ups for delete
  using (owner_id = auth.uid() or public.is_privileged());

-- What the scheduler asks every morning: what is due and not yet sent.
create index if not exists follow_ups_due_idx
  on public.follow_ups (due_on) where state = 'scheduled';

-- What a document screen asks: what is queued against this one.
create index if not exists follow_ups_doc_idx on public.follow_ups (doc_id);
