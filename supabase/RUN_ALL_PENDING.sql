-- ════════════════════════════════════════════════════════════════════
-- TechZoid CRM — everything still to run, in order.
--
-- Paste the WHOLE file into Supabase → SQL Editor → New query, and Run.
-- It is one transaction's worth of work but not one statement: if it stops
-- part way, fix what it complains about and run the whole thing again.
--
-- EVERY PART IS SAFE TO RE-RUN. If you have already run some of these,
-- running them again changes nothing — no table is dropped, no row is
-- deleted, no file is removed. Running the whole file is always safe.
--
-- Order matters in three places: 011 must come after 010, 019 must come
-- after both 013 and 018, and 021 needs the customers table, which the
-- base schema already created.
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- 007_profile_designation.sql
-- Job title on each person's profile — prints under their name on email they send.
-- ────────────────────────────────────────────────────────────────────

-- Each person's own job title, for the signature on email they send.
--
-- SCHEMA CHANGE: adds one column to public.profiles. Nothing else is
-- touched, no policy changes, and no data is deleted. Safe to re-run.
--
-- Distinct from settings.signatoryDesignation, which is NOT the same thing
-- and stays where it is: that one names whoever signs quotations on behalf
-- of the company, and prints in the "For {company} / Authorised signatory"
-- block on the document itself. It is a property of the company. This is a
-- property of a person — what goes under their name when THEY email a
-- customer — so one shared value put the same job title under everybody's
-- signature.
--
-- No policy is needed: profiles_update_self_or_admin already lets a person
-- edit their own row and an Admin edit anyone's, and that policy's `with
-- check` clause continues to be what stops anyone changing their own role.

alter table public.profiles add column if not exists designation text not null default '';


-- ────────────────────────────────────────────────────────────────────
-- 008_purchase_orders.sql
-- Purchase orders: what the company buys.
-- ────────────────────────────────────────────────────────────────────

-- Purchase orders: what the company buys, rather than what it sells.
--
-- SCHEMA CHANGE: adds one table with the same shape and the same four
-- policies as `quotes`. Nothing else is touched and no data is deleted.
-- Safe to re-run.
--
-- Its own table rather than a flag on `quotes`, because the two face
-- opposite directions: a quotation is issued BY the company TO a customer,
-- a purchase order is issued BY the company TO a supplier. Mixing them
-- would put suppliers in the sales pipeline and count money the company
-- owes as money it is owed, on every dashboard and report.
--
-- `customer_id` is nullable and means something different here: it is set
-- only when the goods are drop-shipped to an end customer, so a purchase
-- order can be traced to the sale it was raised for. Most orders ship to
-- the company's own address and leave it null.

create table if not exists public.purchase_orders (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  customer_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The same rule as every other per-record table: you can touch a row if you
-- own it, or if you are Admin/Manager.
do $$
begin
  execute 'alter table public.purchase_orders enable row level security';

  execute 'drop policy if exists "purchase_orders_select" on public.purchase_orders';
  execute 'create policy "purchase_orders_select" on public.purchase_orders for select
    using (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "purchase_orders_insert" on public.purchase_orders';
  execute 'create policy "purchase_orders_insert" on public.purchase_orders for insert
    with check (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "purchase_orders_update" on public.purchase_orders';
  execute 'create policy "purchase_orders_update" on public.purchase_orders for update
    using (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "purchase_orders_delete" on public.purchase_orders';
  execute 'create policy "purchase_orders_delete" on public.purchase_orders for delete
    using (owner_id = auth.uid() or public.is_privileged())';
end $$;

create index if not exists purchase_orders_owner_idx on public.purchase_orders (owner_id);

-- Live sync, same as every other table the app subscribes to.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'purchase_orders'
  ) then
    alter publication supabase_realtime add table public.purchase_orders;
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────
-- 009_invoices.sql
-- Tax invoices, and the ledger receivables ageing is derived from.
-- ────────────────────────────────────────────────────────────────────

-- Tax invoices: the document that actually asks a customer for money.
--
-- SCHEMA CHANGE: adds one table with the same shape and the same four
-- policies as `quotes`. Nothing else is touched and no data is deleted.
-- Safe to re-run.
--
-- Until now a sale left the CRM at the proforma: "Send for invoicing"
-- emailed accounts and nothing came back, so what had been invoiced, what
-- had been paid and what was overdue lived outside the system. This is
-- where that comes back in.
--
-- `quote_id` carries the proforma or quotation an invoice was raised from,
-- so a customer query can be traced back to what was agreed.

create table if not exists public.invoices (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  customer_id text,
  quote_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  execute 'alter table public.invoices enable row level security';

  execute 'drop policy if exists "invoices_select" on public.invoices';
  execute 'create policy "invoices_select" on public.invoices for select
    using (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "invoices_insert" on public.invoices';
  execute 'create policy "invoices_insert" on public.invoices for insert
    with check (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "invoices_update" on public.invoices';
  execute 'create policy "invoices_update" on public.invoices for update
    using (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "invoices_delete" on public.invoices';
  execute 'create policy "invoices_delete" on public.invoices for delete
    using (owner_id = auth.uid() or public.is_privileged())';
end $$;

create index if not exists invoices_owner_idx on public.invoices (owner_id);
create index if not exists invoices_customer_idx on public.invoices (customer_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoices'
  ) then
    alter publication supabase_realtime add table public.invoices;
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────
-- 010_attachments.sql
-- Attachments: a private storage bucket and the table indexing it.
-- ────────────────────────────────────────────────────────────────────

-- Attachments: files kept against a customer or a document.
--
-- SCHEMA CHANGE: adds one private storage bucket and one table. Nothing
-- existing is touched and no data is deleted. Safe to re-run.
--
-- TWO HALVES, AND BOTH MATTER. The bucket holds the bytes; the table holds
-- what the file is, what it belongs to and who put it there. Guarding only
-- the table would leave the bytes reachable by anyone who guessed a path,
-- so `storage.objects` carries its own policies below — a private bucket is
-- not a policy, it only means there is no public URL.
--
-- The bucket is PRIVATE. Files are read through short-lived signed URLs
-- issued to a signed-in user, never through a permanent public link: a
-- customer's signed purchase order or a supplier's price list is not
-- something to leave on a guessable address forever.

-- ── the bucket ──────────────────────────────────────────────────────
--
-- 25 MB per file. Big enough for a scanned PO or a signed contract, small
-- enough that nobody uses the CRM as a file server. The allow-list is
-- enforced here as well as in the browser, because a limit only the client
-- applies is not a limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 26214400,
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── the index ───────────────────────────────────────────────────────
--
-- `record_type` + `record_id` is deliberately loose rather than eight
-- foreign keys: a file can hang off a customer, a quotation, a proforma, a
-- purchase order or an invoice, and those live in five different tables. The
-- trade is that a deleted record leaves its attachment rows behind — which
-- the app clears on delete, and which is the safer failure: an orphaned row
-- is tidy-up, a cascade that ate a signed contract is not.
create table if not exists public.attachments (
  id text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  record_type text not null,
  record_id text not null,
  -- Path inside the bucket. Unique so two uploads can never collide on one
  -- object and silently overwrite each other.
  path text not null unique,
  -- The name as the person who uploaded it saw it, kept separate from the
  -- storage path: the path is sanitised and unique, the name is what they
  -- will look for in a list.
  name text not null,
  mime text not null default '',
  size bigint not null default 0,
  uploaded_by text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

do $$
begin
  execute 'alter table public.attachments enable row level security';

  -- The same rule as every other per-record table: yours, or you are
  -- Admin/Manager.
  execute 'drop policy if exists "attachments_select" on public.attachments';
  execute 'create policy "attachments_select" on public.attachments for select
    using (owner_id = auth.uid() or public.is_privileged())';

  execute 'drop policy if exists "attachments_insert" on public.attachments';
  execute 'create policy "attachments_insert" on public.attachments for insert
    with check (owner_id = auth.uid() or public.is_privileged())';

  -- No update policy, on purpose. An attachment row describes a file that
  -- already exists; changing which bytes a row points at, after the fact, is
  -- how an approved document quietly becomes a different one. Replace a file
  -- by deleting it and uploading again.

  execute 'drop policy if exists "attachments_delete" on public.attachments';
  execute 'create policy "attachments_delete" on public.attachments for delete
    using (owner_id = auth.uid() or public.is_privileged())';
end $$;

create index if not exists attachments_record_idx on public.attachments (record_type, record_id);
create index if not exists attachments_owner_idx on public.attachments (owner_id);

-- ── the bytes ───────────────────────────────────────────────────────
--
-- Objects are stored under `<owner-uuid>/<record-type>/<record-id>/<file>`,
-- so the first path segment says who owns the file and the policies below
-- can be decided from the path alone without joining anything.
--
-- Read is deliberately WIDER than write: any signed-in user may read an
-- attachment, exactly as any signed-in user may read a document through the
-- app. Write and delete are restricted to the file's own owner, or to an
-- Admin/Manager — nobody can drop a file into somebody else's folder, or
-- delete a contract they did not upload.
do $$
begin
  execute 'drop policy if exists "attachments_objects_read" on storage.objects';
  execute 'create policy "attachments_objects_read" on storage.objects for select
    to authenticated
    using (bucket_id = ''attachments'')';

  execute 'drop policy if exists "attachments_objects_write" on storage.objects';
  execute 'create policy "attachments_objects_write" on storage.objects for insert
    to authenticated
    with check (
      bucket_id = ''attachments''
      and ((storage.foldername(name))[1] = auth.uid()::text or public.is_privileged())
    )';

  execute 'drop policy if exists "attachments_objects_delete" on storage.objects';
  execute 'create policy "attachments_objects_delete" on storage.objects for delete
    to authenticated
    using (
      bucket_id = ''attachments''
      and ((storage.foldername(name))[1] = auth.uid()::text or public.is_privileged())
    )';
end $$;

-- Live sync, so a file one person uploads appears on everybody else's screen
-- without a refresh — the same as every other table the app subscribes to.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attachments'
  ) then
    alter publication supabase_realtime add table public.attachments;
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────
-- 011_attachments_shared.sql
-- Attachments become a team resource, and reach sales orders.
-- ────────────────────────────────────────────────────────────────────

-- Attachments become a team resource rather than a personal one.
--
-- SCHEMA CHANGE: adds one column to `attachments` and replaces its policies
-- and the bucket's object policies. No table is dropped and no file is
-- deleted. Safe to re-run. Run AFTER 010_attachments.sql.
--
-- WHY. As first shipped, a file could only be seen or added by the record's
-- owner (or an Admin/Manager). That is wrong for how this company works: a
-- salesperson covering a colleague's account, or picking up a customer call
-- on a Friday, could not see the signed purchase order sitting against it.
-- Everyone in the team now reads and adds; only the person who uploaded a
-- file — or an Admin/Manager — can remove it.
--
-- Deleting stays narrow ON PURPOSE. Adding a file is additive and reversible;
-- deleting somebody else's signed contract is neither.

-- Who actually uploaded this, as opposed to who owns the record it hangs off.
-- Those were the same person while only owners could upload. They are not any
-- more, and the delete policy needs the uploader.
alter table public.attachments add column if not exists uploaded_by_id uuid;

create index if not exists attachments_uploader_idx on public.attachments (uploaded_by_id);

do $$
begin
  -- Read: anybody signed in. A salesperson already sees every customer and
  -- every document in the app; the paperwork attached to them is not more
  -- sensitive than the record itself, and hiding it only means the file gets
  -- emailed around instead.
  execute 'drop policy if exists "attachments_select" on public.attachments';
  execute 'create policy "attachments_select" on public.attachments for select
    to authenticated
    using (true)';

  -- Write: anybody signed in, but only ever as themselves. The `with check`
  -- is what stops a row being inserted that claims somebody else uploaded it
  -- — which would also hand its deletion to that person.
  execute 'drop policy if exists "attachments_insert" on public.attachments';
  execute 'create policy "attachments_insert" on public.attachments for insert
    to authenticated
    with check (uploaded_by_id = auth.uid())';

  -- Still no update policy. A row describes bytes that already exist, and
  -- repointing it after the fact is how an approved document quietly becomes
  -- a different one.

  -- Delete: the uploader, or an Admin/Manager. `owner_id` is included for
  -- rows created before this migration, which have no uploader recorded.
  execute 'drop policy if exists "attachments_delete" on public.attachments';
  execute 'create policy "attachments_delete" on public.attachments for delete
    to authenticated
    using (
      uploaded_by_id = auth.uid()
      or (uploaded_by_id is null and owner_id = auth.uid())
      or public.is_privileged()
    )';
end $$;

-- ── the bytes ───────────────────────────────────────────────────────
--
-- Objects live under `<uploader-uuid>/<record-type>/<record-id>/<file>`. The
-- first segment is the UPLOADER, not the record's owner: it is what the
-- policies below read, and a salesperson attaching a file to a colleague's
-- customer must still be writing inside their own folder.
--
-- Files uploaded before this change sit under the record owner's folder
-- instead. They stay readable — read is bucket-wide — and stay deletable by
-- that owner or by an Admin/Manager, which is exactly who could delete them
-- before.
do $$
begin
  execute 'drop policy if exists "attachments_objects_read" on storage.objects';
  execute 'create policy "attachments_objects_read" on storage.objects for select
    to authenticated
    using (bucket_id = ''attachments'')';

  execute 'drop policy if exists "attachments_objects_write" on storage.objects';
  execute 'create policy "attachments_objects_write" on storage.objects for insert
    to authenticated
    with check (
      bucket_id = ''attachments''
      and (storage.foldername(name))[1] = auth.uid()::text
    )';

  execute 'drop policy if exists "attachments_objects_delete" on storage.objects';
  execute 'create policy "attachments_objects_delete" on storage.objects for delete
    to authenticated
    using (
      bucket_id = ''attachments''
      and ((storage.foldername(name))[1] = auth.uid()::text or public.is_privileged())
    )';
end $$;


-- ────────────────────────────────────────────────────────────────────
-- 012_followups.sql
-- Automatic follow-ups on a quotation that has been sent.
-- ────────────────────────────────────────────────────────────────────

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


-- ────────────────────────────────────────────────────────────────────
-- 013_short_links_and_customer_ids.sql
-- Short registration links, and a customer ID that allocates itself.
-- ────────────────────────────────────────────────────────────────────

-- Short registration links, and a customer ID that allocates itself.
--
-- SCHEMA CHANGE: adds one column to public.profiles and two functions.
-- Nothing else is touched, no policy changes, no data is deleted. Safe to
-- re-run.

-- ── 1. a short code per salesperson ─────────────────────────────────
--
-- The registration link used to carry the salesperson's uuid:
--   https://crm.ttpldelhi.com/?lead=ebc9fe98-4434-4b13-82bd-887c…
-- 36 characters of hexadecimal, unreadable over the phone, ugly in a
-- WhatsApp message, and it puts an internal identifier in front of every
-- customer who is sent one. This replaces it with six characters.
--
-- The old form still works and always will — links are already out there in
-- people's inboxes, and breaking one means a customer meeting a dead page
-- with no way to tell anybody.
alter table public.profiles add column if not exists lead_code text;

-- Unique, but only where set: existing rows keep a null until they first
-- need a code, and two nulls do not collide.
create unique index if not exists profiles_lead_code_idx
  on public.profiles (lead_code) where lead_code is not null;

create extension if not exists pgcrypto;

/**
 * The caller's own short code, minting one the first time it is asked for.
 *
 * Security definer because a Sales user cannot be allowed to write another
 * person's row — and because uniqueness has to be settled by the database,
 * not by a browser that cannot see the other codes.
 *
 * The alphabet has no 0/O or 1/I/L: this gets read down a phone line and
 * typed by somebody who has never seen it. 31 characters over 6 places is
 * about 887 million codes, and the retry loop closes the gap between that
 * and certainty.
 *
 * `extensions` is in the search path because Supabase installs pgcrypto
 * there rather than into public, and gen_random_bytes() lives in it.
 */
create or replace function public.my_lead_code()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  existing text;
  candidate text;
  i integer;
  attempt integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select lead_code into existing from public.profiles where id = auth.uid();
  if existing is not null and existing <> '' then
    return existing;
  end if;

  loop
    attempt := attempt + 1;
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
    end loop;

    begin
      update public.profiles set lead_code = candidate where id = auth.uid();
      return candidate;
    exception when unique_violation then
      -- Someone else holds it. Try again; 887 million codes means this
      -- effectively never happens twice.
      if attempt >= 10 then
        raise exception 'Could not allocate a link code. Try again.';
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.my_lead_code() from public;
grant execute on function public.my_lead_code() to authenticated;

-- ── 2. the customer ID printed on documents ─────────────────────────
--
-- ALLOCATED IN THE DATABASE, and that is the whole point. Customers arrive
-- from two places that never see each other: a salesperson pressing "New
-- customer" in the app, and the public registration form, which runs on a
-- server with nobody watching. Two readers of the same counter, each doing
-- read-then-write, produce duplicate IDs — and a duplicate that appears on
-- a form submission at 2am is one nobody will ever catch.
--
-- One `update … returning` settles it: the row is locked for the duration,
-- so two callers queue rather than collide.
create or replace function public.next_customer_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  prefix text;
  seq integer;
begin
  -- The settings row is created by the app on first save; without it there
  -- is no counter to advance and no sensible number to invent.
  update public.settings
     set data = jsonb_set(
           coalesce(data, '{}'::jsonb),
           '{customerSeq}',
           to_jsonb(coalesce((data ->> 'customerSeq')::integer, 0) + 1)
         )
   where id = 'main'
  returning coalesce(nullif(data ->> 'customerPrefix', ''), 'CUST-'),
            (data ->> 'customerSeq')::integer
    into prefix, seq;

  if seq is null then
    return null;
  end if;

  return prefix || lpad(seq::text, 6, '0');
end;
$$;

revoke all on function public.next_customer_code() from public;
-- Signed-in users allocate one when they add a customer by hand; the public
-- registration form allocates through the service role, which is not granted
-- here because it bypasses privileges entirely.
grant execute on function public.next_customer_code() to authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 014_backfill_customer_codes.sql
-- A customer ID for the customers who were already here.
-- ────────────────────────────────────────────────────────────────────

-- Give the customers who were already here a customer ID.
--
-- LOOK BEFORE YOU RUN IT. This says exactly who would get what, and changes
-- nothing:
--
--   select
--     coalesce(nullif((select data ->> 'customerPrefix' from public.settings where id = 'main'), ''), 'CUST-')
--       || lpad((coalesce((select (data ->> 'customerSeq')::integer from public.settings where id = 'main'), 0)
--                + row_number() over (order by created_at, id))::text, 6, '0') as would_get,
--     data ->> 'company' as company,
--     created_at::date   as on_the_books_since
--   from public.customers
--   where coalesce(data ->> 'code', '') = ''
--   order by created_at, id;
--
-- DATA CHANGE, and the only one in this folder: it writes a `code` onto
-- customer records that have none. It adds nothing else and overwrites
-- nothing — a record that already carries a code is skipped, so running
-- this twice changes nothing the second time.
--
-- Run it AFTER 013, which is where the counter and the allocator live.
--
-- Order is oldest first, so the customer who has been on the books longest
-- is CUST-000001. Ties are broken by id, which makes the result the same
-- whichever way the rows happen to come back — a backfill that numbers
-- people differently on a re-run would be worse than one that never ran.
--
-- The counter in settings is left pointing past the last code handed out,
-- so the next customer added in the app continues the sequence rather than
-- colliding with one of these.

do $$
declare
  prefix text;
  seq integer;
  filled integer := 0;
  r record;
begin
  select coalesce(nullif(data ->> 'customerPrefix', ''), 'CUST-'),
         coalesce((data ->> 'customerSeq')::integer, 0)
    into prefix, seq
    from public.settings
   where id = 'main'
     for update;

  if not found then
    raise notice 'No settings row yet — nothing to number against. Save Settings once in the app, then run this again.';
    return;
  end if;

  for r in
    select id
      from public.customers
     where coalesce(data ->> 'code', '') = ''
     order by created_at asc, id asc
  loop
    seq := seq + 1;
    update public.customers
       set data = jsonb_set(
             coalesce(data, '{}'::jsonb),
             '{code}',
             to_jsonb(prefix || lpad(seq::text, 6, '0'))
           ),
           -- The row is touched so the app picks the change up. The record's
           -- own `updatedAt` is deliberately NOT bumped: nothing about this
           -- customer changed for the person who owns them, and making every
           -- account read as "just edited" would bury whatever really was.
           updated_at = now()
     where id = r.id;
    filled := filled + 1;
  end loop;

  update public.settings
     set data = jsonb_set(coalesce(data, '{}'::jsonb), '{customerSeq}', to_jsonb(seq))
   where id = 'main';

  raise notice 'Customer IDs written: %. Next number: %.', filled, seq + 1;
end $$;


-- ────────────────────────────────────────────────────────────────────
-- 015_followups_whatsapp.sql
-- Follow-ups can go by WhatsApp as well as by email.
-- ────────────────────────────────────────────────────────────────────

-- Follow-ups can go by WhatsApp as well as by email.
--
-- SCHEMA CHANGE: adds columns to public.follow_ups. Nothing else is touched,
-- no policy changes, no data is deleted. Safe to re-run.
--
-- WHY A TEMPLATE NAME AND VALUES RATHER THAN A MESSAGE. An email row stores
-- the words, because we wrote them and can show them. A WhatsApp follow-up
-- goes out days after the last contact, which is outside Meta's 24-hour
-- window, and out there only a template approved by Meta in advance may be
-- sent. The words live in Meta's template library; what belongs here is
-- which template and what to put in its placeholders.
--
-- The existing message/html columns stay exactly as they are for email rows,
-- and stay empty for WhatsApp ones.

alter table public.follow_ups
  add column if not exists channel text not null default 'email';

-- Constrained so a client cannot queue a channel the scheduler has never
-- heard of, which would sit as 'scheduled' for ever without being sent.
do $$
begin
  alter table public.follow_ups
    add constraint follow_ups_channel_check check (channel in ('email', 'whatsapp'));
exception
  when duplicate_object then null;
end $$;

alter table public.follow_ups
  add column if not exists send_to_phone text not null default '';

-- The template registered with Meta, by the exact name it was approved
-- under. A name that does not match one in the library is refused at send
-- time, which is why it is stored per row rather than looked up later: the
-- row records what was actually queued.
alter table public.follow_ups
  add column if not exists template_name text not null default '';

-- The placeholder values, in order. jsonb rather than three columns because
-- Meta templates differ in how many they take, and a schema that assumes
-- three is a schema that breaks the day somebody approves a fourth.
alter table public.follow_ups
  add column if not exists template_values jsonb not null default '[]'::jsonb;

-- The scheduler asks for what is due regardless of channel, so the existing
-- index still serves. This one answers "what went out on WhatsApp", which is
-- the question asked when a number gets blocked.
create index if not exists follow_ups_channel_idx on public.follow_ups (channel);


-- ────────────────────────────────────────────────────────────────────
-- 016_whatsapp_status.sql
-- Delivery status for WhatsApp follow-ups.
-- ────────────────────────────────────────────────────────────────────

-- Delivery status for WhatsApp follow-ups.
--
-- SCHEMA CHANGE: adds columns to public.follow_ups and widens one existing
-- function by one allowed value. Nothing is dropped, no policy changes, no
-- data is deleted. Safe to re-run.
--
-- WHY THIS EXISTS. Interakt answers the send API the moment it has ACCEPTED
-- a message — not when WhatsApp delivered it. Recording that as "sent" is
-- honest but thin: it says the message left this company and nothing about
-- whether it arrived. Whether it was delivered, read, or failed comes back
-- later on a webhook, and these columns are where it lands.

alter table public.follow_ups
  add column if not exists provider_message_id text not null default '';

-- What the provider last told us. Deliberately NOT merged into `state`:
-- `state` is what the CRM did (queued it, sent it, gave up on it) and is
-- what the scheduler reads to decide what to do next. This is what happened
-- to the message afterwards, out in the world, and nothing in this product
-- may act on it. Two different facts, two columns.
alter table public.follow_ups
  add column if not exists delivery_state text not null default ''
  check (delivery_state in ('', 'sent', 'delivered', 'read', 'failed'));

alter table public.follow_ups add column if not exists delivered_at timestamptz;
alter table public.follow_ups add column if not exists read_at timestamptz;

-- Why it failed, in the provider's own words, for the one case where a
-- salesperson needs to know: the customer blocked the business, or the
-- number is not on WhatsApp at all.
alter table public.follow_ups add column if not exists delivery_detail text;

-- Matched on when a status callback arrives.
create index if not exists follow_ups_provider_msg_idx
  on public.follow_ups (provider_message_id) where provider_message_id <> '';

-- ── the shared secret in the callback URL ───────────────────────────
--
-- Interakt does not sign its webhooks, so there is no HMAC to verify the way
-- there is for the website sync. What authenticates a caller here is the URL
-- itself: a 32-byte random key that only Interakt and this database hold,
-- and which is compared in constant time.
--
-- That makes the callback URL a credential. It is shown to an admin exactly
-- once, when generated, exactly like the other two — and it can be rotated
-- the moment anyone suspects it has been pasted somewhere it should not be.
create or replace function public.regenerate_webhook_secret(p_kind text default 'main')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can regenerate a webhook signing secret';
  end if;

  if p_kind not in ('main', 'inbound', 'whatsapp') then
    raise exception 'Unknown secret kind';
  end if;

  v_secret := encode(gen_random_bytes(32), 'hex');

  insert into public.webhook_secrets (id, secret, rotated_at)
  values (p_kind, v_secret, now())
  on conflict (id) do update set secret = excluded.secret, rotated_at = excluded.rotated_at;

  return v_secret;
end;
$$;


-- ────────────────────────────────────────────────────────────────────
-- 017_duplicate_lookup.sql
-- Find a duplicate customer across the workspace, without exposing one.
-- ────────────────────────────────────────────────────────────────────

-- Finding a duplicate customer across the whole workspace, without showing
-- anybody a customer they are not allowed to see.
--
-- SCHEMA CHANGE: adds one function. No table, column or policy changes, and
-- no data is touched. Safe to re-run.
--
-- THE PROBLEM THIS SOLVES. Duplicate detection ran against the customers
-- already loaded in the browser — which RLS has scoped to the ones the
-- signed-in person may see. A Sales user therefore checked for duplicates
-- against their OWN customers only, and the case that actually matters —
-- two salespeople entering the same company a week apart — was invisible to
-- both of them. The first they learn of it is two quotations, two prices,
-- and one annoyed customer.
--
-- WHY A FUNCTION AND NOT A RELAXED POLICY. The answer needed is "somebody
-- already has this one, go and talk to them". That is three fields. Widening
-- the SELECT policy to make the local check work would hand every
-- salesperson every other salesperson's book — contacts, values, follow-up
-- dates, the lot. This returns the company name as stored, so the speller
-- can see it, and the owner's name, so they know who to ask. It returns no
-- contact details, no id, no value, and no notes.

create or replace function public.find_duplicate_customer(
  p_company text default '',
  p_phone   text default '',
  p_gstin   text default ''
)
returns table (reason text, company text, owner_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company text := lower(btrim(coalesce(p_company, '')));
  v_phone   text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
  v_gstin   text := upper(btrim(coalesce(p_gstin, '')));
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  -- Same suffix-stripping as the browser does, so the two agree about what
  -- counts as the same name. See normalizeCompanyName in
  -- src/domain/customers/duplicates.ts.
  v_company := btrim(regexp_replace(v_company,
    '\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|corp\.?)\.?$', '', 'gi'));
  v_company := btrim(regexp_replace(v_company,
    '\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|corp\.?)\.?$', '', 'gi'));

  -- Strongest signal first, and at most one row: this answers "is there
  -- one", not "list them".
  return query
  select x.reason, x.company, x.owner_name
  from (
    select
      case
        when v_gstin <> '' and upper(btrim(coalesce(c.data ->> 'gstin', ''))) = v_gstin then 'gstin'
        when v_phone <> '' and right(regexp_replace(coalesce(c.data ->> 'phone', ''), '[^0-9]', '', 'g'), 10) = v_phone then 'phone'
        else 'name'
      end as reason,
      coalesce(c.data ->> 'company', '') as company,
      coalesce(p.name, 'another user') as owner_name,
      case
        when v_gstin <> '' and upper(btrim(coalesce(c.data ->> 'gstin', ''))) = v_gstin then 1
        when v_phone <> '' and right(regexp_replace(coalesce(c.data ->> 'phone', ''), '[^0-9]', '', 'g'), 10) = v_phone then 2
        else 3
      end as rank
    from public.customers c
    left join public.profiles p on p.id = c.owner_id
    where
      (v_gstin <> '' and upper(btrim(coalesce(c.data ->> 'gstin', ''))) = v_gstin)
      or (v_phone <> '' and right(regexp_replace(coalesce(c.data ->> 'phone', ''), '[^0-9]', '', 'g'), 10) = v_phone)
      or (v_company <> '' and btrim(regexp_replace(
            btrim(regexp_replace(lower(btrim(coalesce(c.data ->> 'company', ''))),
              '\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|corp\.?)\.?$', '', 'gi')),
            '\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?|corp\.?)\.?$', '', 'gi')) = v_company)
  ) x
  order by x.rank
  limit 1;
end;
$$;

revoke all on function public.find_duplicate_customer(text, text, text) from public;
grant execute on function public.find_duplicate_customer(text, text, text) to authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 018_document_numbering.sql
-- Quotation, invoice and challan numbers come from the database, so they
-- stop repeating.
-- ────────────────────────────────────────────────────────────────────

-- 018 — document numbers come from the database, not from each browser.
--
-- THE BUG THIS FIXES. The sequence behind a quotation number lived in the
-- shared `settings` row, and the browser bumped it after saving. Two things
-- went wrong with that:
--
--   1. `settings` is writable only by an admin or a manager
--      (settings_update_privileged). A salesperson's bump was rejected, and
--      the rejection was swallowed — so the counter never moved and every
--      quotation they raised carried the same number.
--   2. Even with the rights, read-then-write from two browsers hands the
--      same number to both. A quotation number that is not unique is not a
--      reference; the customer quotes it back at you and nobody knows which
--      document they mean.
--
-- Both go away if the increment happens once, inside the database, in a
-- single statement. This is the same shape as next_customer_code() in 013.
--
-- CONVENTION, PRESERVED. `quoteSeq` means "the number the NEXT document
-- gets", which is what every existing workspace already holds and what the
-- editor reads to preview a number. So this returns the value it found and
-- stores value + 1 — it does not return the incremented value.

create or replace function public.next_doc_seq(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  after integer;
begin
  -- Whitelisted, not interpolated: p_kind reaches a jsonb path, and the
  -- caller is any signed-in user. These are the counters that exist.
  key := case p_kind
           when 'quote' then 'quoteSeq'
           when 'proforma' then 'proformaSeq'
           when 'purchaseOrder' then 'purchaseOrderSeq'
           when 'invoice' then 'invoiceSeq'
           when 'order' then 'orderSeq'
           when 'dispatch' then 'dispatchSeq'
         end;
  if key is null then
    raise exception 'unknown document kind: %', p_kind;
  end if;

  -- A single update, so two callers queue on the row instead of racing.
  -- `greatest(..., 1)` keeps a corrupted or zeroed counter from handing out
  -- number 0, which no document series starts at.
  update public.settings
     set data = jsonb_set(
           coalesce(data, '{}'::jsonb),
           array[key],
           to_jsonb(greatest(coalesce((data ->> key)::integer, 1), 1) + 1)
         ),
         updated_at = now()
   where id = 'main'
  returning (data ->> key)::integer into after;

  -- No settings row means no counter to advance. Null tells the caller to
  -- fall back to its own preview rather than invent a number.
  if after is null then
    return null;
  end if;

  return after - 1;
end;
$$;

revoke all on function public.next_doc_seq(text) from public;
-- Every salesperson raises documents. That is the whole point: the rights
-- to allocate a number are not the rights to edit company settings, and
-- conflating the two is what broke the numbering in the first place.
grant execute on function public.next_doc_seq(text) to authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 019_counters_not_callable_by_anon.sql
-- Close the anon grant Supabase adds to every new function by default.
-- MUST come after 018 and after 013.
-- ────────────────────────────────────────────────────────────────────

-- 019 — the counter functions were callable without signing in.
--
-- FOUND BY LOOKING AT THE LIVE DATABASE, not by reading the migration:
--
--   select routine_name, grantee from information_schema.role_routine_grants
--   where specific_schema = 'public' and routine_name = 'next_doc_seq';
--   -- anon, authenticated, postgres, service_role
--
-- 018 ends with `revoke all on function ... from public`, which reads like
-- it closes this and does not. PUBLIC is the pseudo-role; `anon` is a real
-- one, and Supabase's default privileges grant EXECUTE on every new
-- function in `public` to anon and authenticated as it is created. The
-- revoke removes the pseudo-role's grant and leaves anon's untouched.
--
-- WHAT WAS EXPOSED. Nothing readable — neither function returns anybody's
-- data. But both ADVANCE A COUNTER, so anyone with the anon key (which is
-- in the JavaScript every visitor downloads, by design) could push
-- quotation numbers and customer IDs to arbitrary values by calling them in
-- a loop. next_customer_code has been open since 013; next_doc_seq since
-- 018 earlier the same day.
--
-- find_duplicate_customer and my_lead_code already refuse when auth.uid()
-- is null, so they were never exposed this way. They are revoked here too,
-- because a grant nothing needs is a grant worth not having.
--
-- TWO LAYERS, because the grant comes back on its own: any future
-- `create or replace` of these functions re-triggers those default
-- privileges silently. The in-function check is what still holds then.

revoke execute on function public.next_doc_seq(text) from anon;
revoke execute on function public.next_customer_code() from anon;
revoke execute on function public.find_duplicate_customer(text, text, text) from anon;
revoke execute on function public.my_lead_code() from anon;

-- The guard refuses ANON specifically rather than demanding a signed-in
-- user, and that distinction matters: next_customer_code is also called by
-- the public registration form, which runs server-side as service_role and
-- so has no auth.uid() at all. A "must be signed in" check there would
-- break new customers arriving from the form — the one path nobody would
-- think to test by hand.

create or replace function public.next_doc_seq(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  after integer;
begin
  if coalesce(auth.role(), '') = 'anon' then
    raise exception 'Not signed in.';
  end if;

  key := case p_kind
           when 'quote' then 'quoteSeq'
           when 'proforma' then 'proformaSeq'
           when 'purchaseOrder' then 'purchaseOrderSeq'
           when 'invoice' then 'invoiceSeq'
           when 'order' then 'orderSeq'
           when 'dispatch' then 'dispatchSeq'
         end;
  if key is null then
    raise exception 'unknown document kind: %', p_kind;
  end if;

  update public.settings
     set data = jsonb_set(
           coalesce(data, '{}'::jsonb),
           array[key],
           to_jsonb(greatest(coalesce((data ->> key)::integer, 1), 1) + 1)
         ),
         updated_at = now()
   where id = 'main'
  returning (data ->> key)::integer into after;

  if after is null then
    return null;
  end if;

  return after - 1;
end;
$$;

revoke all on function public.next_doc_seq(text) from public;
revoke execute on function public.next_doc_seq(text) from anon;
grant execute on function public.next_doc_seq(text) to authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 020_broadcasts.sql
-- A message an admin can put on everybody's screen.
-- ────────────────────────────────────────────────────────────────────

-- 020 — a message an admin can put on everybody's screen.
--
-- WHY A TABLE AND NOT A REALTIME BROADCAST. A socket message only reaches
-- whoever happens to be looking. "The GST portal is down, stop raising
-- invoices" has to reach the person who opens the CRM twenty minutes later
-- as well, so it is stored and read on load, not shouted once.
--
-- SCHEMA CHANGE: one table and one index. Nothing existing is touched.
-- Safe to re-run.

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  -- Who sent it. Kept so the popup can say so: an unsigned message on
  -- somebody's screen is a message they cannot ask about.
  from_id uuid not null references public.profiles (id) on delete cascade,
  -- Null means everybody. A profile id means that one person.
  to_id uuid references public.profiles (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  -- How it reads: a notice, something to be careful about, something wrong.
  tone text not null default 'info' check (tone in ('info', 'warn', 'bad')),
  -- After this it stops appearing. A notice about this morning's outage is
  -- noise by Thursday, and nobody goes back to tidy up.
  expires_at timestamptz not null default (now() + interval '2 days'),
  created_at timestamptz not null default now()
);

create index if not exists broadcasts_live_idx
  on public.broadcasts (expires_at desc);

alter table public.broadcasts enable row level security;

-- READ: addressed to you, or to everybody, and not yet expired. Deliberately
-- NOT "everything": a message to one person is between the two of them, and
-- a table anybody can read in full is not that.
drop policy if exists "broadcasts_select_mine" on public.broadcasts;
create policy "broadcasts_select_mine" on public.broadcasts for select
  to authenticated
  using (
    expires_at > now()
    and (to_id is null or to_id = auth.uid() or from_id = auth.uid())
  );

-- WRITE: admins and managers only, and `from_id` must be the person writing
-- — so a message cannot be sent under somebody else's name.
drop policy if exists "broadcasts_insert_privileged" on public.broadcasts;
create policy "broadcasts_insert_privileged" on public.broadcasts for insert
  to authenticated
  with check (public.is_privileged() and from_id = auth.uid());

-- Withdrawing one you sent, for the message that went out with the wrong
-- date in it. Nobody can delete somebody else's.
drop policy if exists "broadcasts_delete_own" on public.broadcasts;
create policy "broadcasts_delete_own" on public.broadcasts for delete
  to authenticated
  using (from_id = auth.uid() or public.is_admin());

-- Live, so a message lands within a second or two rather than at the next
-- poll. The app also reads the table on load and when a tab is refocused,
-- so a project with Realtime switched off still delivers.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'broadcasts'
  ) then
    execute 'alter publication supabase_realtime add table public.broadcasts';
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────
-- 021_portal_tokens.sql
-- The link a customer follows to see their own quotes and invoices.
-- ────────────────────────────────────────────────────────────────────

-- 021 — the link a customer follows to see their own quotes.
--
-- WHAT THIS OPENS. Everything else in this CRM is behind a sign-in. This is
-- not: a customer follows a link out of an email and sees their documents
-- with no account and no password. That is the point of it — a purchase
-- manager will not create an account to look at a quotation — and it is also
-- the whole of the risk, so the design is deliberately narrow:
--
--   · The link is a random 32-byte secret. It is NEVER STORED. Only its
--     SHA-256 is, so this table leaking does not hand anybody a working link,
--     and no server log can ever contain one.
--   · One link is one customer. There is no link that sees two customers,
--     and no link that can be edited into one.
--   · It expires, and it can be revoked the moment somebody leaves a job.
--   · The `anon` key cannot read this table, or the documents behind it, at
--     all — RLS here grants nothing to anon, and the portal endpoint runs on
--     the server with the service role. A customer's browser never talks to
--     the database.
--
-- SCHEMA CHANGE: one table, two indexes, four policies. Nothing existing is
-- touched. Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.portal_tokens (
  id uuid primary key default gen_random_uuid(),

  -- Whose documents this link shows. Cascade: deleting a customer must not
  -- leave a live link pointing at a hole.
  customer_id text not null references public.customers (id) on delete cascade,

  -- SHA-256 of the secret, lowercase hex, 64 characters. The secret itself
  -- exists in exactly one place: the link the salesperson copied.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  -- Who it was issued to, for the salesperson's own benefit — "Ravi in
  -- purchasing" — so revoking the right one later is possible. Never shown
  -- to the customer.
  label text not null default '',

  -- Always set. A portal link with no expiry is a credential with no end,
  -- and these get forwarded inside customer companies.
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  -- Whether the customer ever actually opened it. A quote that was never
  -- looked at and a quote that was read four times are different sales
  -- situations, and this is the cheapest possible way to tell them apart.
  last_seen_at timestamptz,
  view_count integer not null default 0
);

-- The portal endpoint's only lookup: hash → row. Unique already indexes it;
-- this one is for the staff-facing list on a customer.
create index if not exists portal_tokens_customer_idx
  on public.portal_tokens (customer_id, created_at desc);

alter table public.portal_tokens enable row level security;

-- Who may manage a customer's links is exactly who may manage the customer:
-- the owner, or an Admin/Manager. Expressed by looking at the customer row
-- rather than duplicating the rule, so the two cannot drift apart.
create or replace function public.may_manage_customer(p_customer_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer_id
      and (c.owner_id = auth.uid() or public.is_privileged())
  );
$$;

-- REVOKED FROM `anon` BY NAME, and that is not the same thing as revoking
-- from PUBLIC. PUBLIC is a pseudo-role; Supabase separately grants EXECUTE on
-- every new function to the real roles anon/authenticated/service_role via
-- `alter default privileges`. Revoking PUBLIC leaves that grant untouched.
--
-- This file's first version did exactly that and shipped a security-definer
-- function an anonymous caller could invoke — the same mistake 019 was
-- written to close, made one line above a comment about `to authenticated`
-- not being decoration. Caught by asking the live database what anon could
-- actually call, rather than by reading the file again.
revoke all on function public.may_manage_customer(text) from public, anon;
grant execute on function public.may_manage_customer(text) to authenticated;

-- Note what is absent from all four: any grant to `anon`. `to authenticated`
-- is not decoration — without it a policy is evaluated for anon too, and
-- auth.uid() being null there is a thinner defence than simply not applying.
drop policy if exists "portal_tokens_select" on public.portal_tokens;
create policy "portal_tokens_select" on public.portal_tokens for select
  to authenticated
  using (public.may_manage_customer(customer_id));

drop policy if exists "portal_tokens_insert" on public.portal_tokens;
create policy "portal_tokens_insert" on public.portal_tokens for insert
  to authenticated
  with check (public.may_manage_customer(customer_id) and created_by = auth.uid());

-- UPDATE exists for one reason: revoking.
--
-- The `with check` here is NOT what stops a link being repointed, and it is
-- worth saying so, because the first version of this file claimed it was and
-- a test proved otherwise. A policy sees only the row being written, so an
-- Admin — who satisfies may_manage_customer() for every customer — passed
-- both halves while moving a live link from one account to another. RLS
-- cannot express "this column may not change"; a trigger can, and does,
-- immediately below.
drop policy if exists "portal_tokens_update" on public.portal_tokens;
create policy "portal_tokens_update" on public.portal_tokens for update
  to authenticated
  using (public.may_manage_customer(customer_id))
  with check (public.may_manage_customer(customer_id));

-- What a link points at is decided once, when it is issued.
--
-- A link that is already in a customer's inbox must keep meaning what it
-- meant when it was sent. Repointing one is not an operation anybody needs:
-- the way to show a different customer their documents is to issue that
-- customer their own link. Pinning the secret too means a row cannot be
-- turned into a link somebody already knows.
--
-- Enforced in a trigger rather than a policy so it holds for the SERVICE
-- ROLE as well — which is the role the portal endpoint itself runs as, and
-- which bypasses RLS entirely.
create or replace function public.portal_tokens_pin_identity()
returns trigger
language plpgsql
as $$
begin
  if new.customer_id is distinct from old.customer_id
     or new.token_hash is distinct from old.token_hash
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A portal link cannot be repointed. Revoke it and issue a new one.';
  end if;
  return new;
end;
$$;

-- A trigger function needs no EXECUTE grant to fire, so nobody needs to hold
-- one. Revoked for the same reason as above.
revoke all on function public.portal_tokens_pin_identity() from public, anon;

drop trigger if exists portal_tokens_pin_identity on public.portal_tokens;
create trigger portal_tokens_pin_identity
  before update on public.portal_tokens
  for each row execute function public.portal_tokens_pin_identity();

drop policy if exists "portal_tokens_delete" on public.portal_tokens;
create policy "portal_tokens_delete" on public.portal_tokens for delete
  to authenticated
  using (public.may_manage_customer(customer_id));

-- Belt and braces over RLS: anon holds no table privilege here at all, so a
-- future policy written without `to authenticated` still cannot expose it.
revoke all on table public.portal_tokens from anon;


-- ────────────────────────────────────────────────────────────────────
-- 022_outreach_prospects.sql
-- Prospects, imports, email verification and the suppression list.
-- ────────────────────────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────────────────────────
-- 023_email_accounts.sql
-- Many mailboxes across many sending domains, plus domain health.
-- ────────────────────────────────────────────────────────────────────

-- 023 — many mailboxes, across many domains.
--
-- WHAT WAS WRONG. `ms_mail_accounts` is keyed `user_id primary key`: one
-- mailbox per person, full stop. A company selling licensing from India and
-- the UAE sends as sales@company.in, sales@company.ae, procurement@ and
-- it@ — shared inboxes that several people send from, and one person who
-- sends from more than one. None of that fits one row per user.
--
-- BACKWARD COMPATIBILITY IS THE WHOLE DESIGN. `ms_mail_accounts` is NOT
-- dropped and NOT altered. Mailboxes already connected keep working through
-- the existing code on the existing table while this one fills up beside it.
-- A migration that invalidates every live OAuth token is a migration that
-- silently stops every quotation email in the company, and the first anyone
-- knows is a customer asking where their quote went.
--
-- Existing rows are copied in below, so nobody has to reconnect.
--
-- SCHEMA CHANGE: two new tables. Nothing existing is touched. Safe to re-run.

create extension if not exists pgcrypto;

-- ── a sending domain ──────────────────────────────────────────────────
create table if not exists public.email_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  label text not null default '',

  -- §10. Filled by the domain-health check, never typed in by hand: these
  -- are facts about DNS, and a stale hand-entered "yes we have DKIM" is
  -- worse than no answer at all.
  spf_status text not null default 'unknown'
    check (spf_status in ('unknown','pass','warn','fail')),
  dkim_status text not null default 'unknown'
    check (dkim_status in ('unknown','pass','warn','fail')),
  dmarc_status text not null default 'unknown'
    check (dmarc_status in ('unknown','pass','warn','fail')),
  mx_status text not null default 'unknown'
    check (mx_status in ('unknown','pass','warn','fail')),
  -- What the lookup actually saw, so the screen can explain a WARN rather
  -- than just colour it amber.
  health_detail jsonb not null default '{}'::jsonb,
  health_checked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_domains_key on public.email_domains (lower(domain));

-- ── a mailbox somebody can send from ──────────────────────────────────
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid references public.email_domains (id) on delete set null,

  email text not null,
  display_name text not null default '',
  provider text not null default 'microsoft' check (provider in ('microsoft','smtp','resend')),

  -- WHO OWNS THE CONSENT. The person whose Microsoft account granted the
  -- OAuth. Graph sends as them, so this is not decoration — it is whose
  -- mailbox is actually being used and who must reconnect when it expires.
  connected_by uuid not null references public.profiles (id) on delete cascade,

  -- The refresh token. Never readable by any client: there is no select
  -- policy that returns it (see the view below), and the server holds the
  -- service role. Encryption at rest is Azure/Supabase disk-level today; an
  -- application-level envelope goes here when the key management for it
  -- exists, and pretending otherwise in a comment would be worse than the
  -- gap itself.
  refresh_token text,

  -- 'ok' | 'expired' | 'revoked' | 'error'. Set by the sender when a refresh
  -- fails, so Settings can say "reconnect this one" instead of every send
  -- failing quietly.
  status text not null default 'ok' check (status in ('ok','expired','revoked','error')),
  status_detail text not null default '',
  last_ok_at timestamptz,

  -- §11. Sending safety, per mailbox rather than global: Microsoft's own
  -- limits are per mailbox, so a shared sales@ and one person's inbox
  -- cannot sensibly share a budget.
  daily_limit integer not null default 200 check (daily_limit >= 0),
  hourly_limit integer not null default 30 check (hourly_limit >= 0),

  -- Exactly one default sender, enforced by the partial index below.
  is_default boolean not null default false,
  -- Withdrawn without being deleted, so the audit log still resolves it.
  disabled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_accounts_key on public.email_accounts (lower(email));
create index if not exists email_accounts_domain_idx on public.email_accounts (domain_id);
create index if not exists email_accounts_owner_idx  on public.email_accounts (connected_by);

-- ONE DEFAULT, ENFORCED BY THE DATABASE. Doing this in the application means
-- two people setting a default at once leaves two, and then "which mailbox
-- did that go out from" has no answer.
create unique index if not exists email_accounts_one_default
  on public.email_accounts ((true)) where is_default and disabled_at is null;

-- ── carry the existing connections over ───────────────────────────────
-- Nobody reconnects. The old table keeps working; this simply mirrors what
-- is already in it so the new screens show the same mailboxes.
insert into public.email_accounts (email, display_name, connected_by, refresh_token, provider, last_ok_at)
select m.ms_email, m.ms_display_name, m.user_id, m.refresh_token, 'microsoft', m.connected_at
from public.ms_mail_accounts m
where m.ms_email <> ''
  and not exists (select 1 from public.email_accounts a where lower(a.email) = lower(m.ms_email))
on conflict do nothing;

-- Give each carried-over mailbox its domain.
insert into public.email_domains (domain)
select distinct lower(split_part(a.email, '@', 2))
from public.email_accounts a
where split_part(a.email, '@', 2) <> ''
on conflict do nothing;

update public.email_accounts a
set domain_id = d.id
from public.email_domains d
where a.domain_id is null
  and lower(split_part(a.email, '@', 2)) = lower(d.domain);

-- ── who may see what ──────────────────────────────────────────────────
alter table public.email_domains  enable row level security;
alter table public.email_accounts enable row level security;

-- Domains and their health are a shared operational picture: a salesperson
-- choosing a sender needs to know the domain's DKIM is failing. No secrets
-- live here.
drop policy if exists "email_domains_read" on public.email_domains;
create policy "email_domains_read" on public.email_domains for select
  to authenticated using (true);

drop policy if exists "email_domains_write" on public.email_domains;
create policy "email_domains_write" on public.email_domains for all
  to authenticated
  using (public.is_privileged()) with check (public.is_privileged());

-- THE REFRESH TOKEN IS THE REASON THIS POLICY IS NARROW. Postgres has no
-- column-level RLS, so any select policy here exposes every column to
-- whoever it admits. Rather than let the whole team read each other's
-- tokens, the table itself is readable only by the mailbox's own owner and
-- by Admins/Managers — and the app reads the token-free VIEW below instead.
drop policy if exists "email_accounts_read_own" on public.email_accounts;
create policy "email_accounts_read_own" on public.email_accounts for select
  to authenticated
  using (connected_by = auth.uid() or public.is_privileged());

drop policy if exists "email_accounts_manage_own" on public.email_accounts;
create policy "email_accounts_manage_own" on public.email_accounts for all
  to authenticated
  using (connected_by = auth.uid() or public.is_privileged())
  with check (connected_by = auth.uid() or public.is_privileged());

-- ── what the app actually reads ───────────────────────────────────────
-- Every column except the secret. `security_invoker` makes the view run as
-- the caller, so the policies above still apply — without it a view is a
-- hole straight through RLS.
-- DROP BEFORE CREATE, and the dependent function before the view.
--
-- `create or replace view` cannot REMOVE a column, and migration 024
-- replaces this view with an extra one (is_mine). So re-running 023 after
-- 024 failed with "cannot drop columns from view" — which meant
-- RUN_ALL_PENDING.sql, documented as always safe to re-run, failed on its
-- second run. Found by running the whole runbook twice rather than once.
drop function if exists public.my_sending_accounts();
drop view if exists public.email_accounts_safe;
create view public.email_accounts_safe
with (security_invoker = true) as
select a.id, a.domain_id, a.email, a.display_name, a.provider,
       a.connected_by, a.status, a.status_detail, a.last_ok_at,
       a.daily_limit, a.hourly_limit, a.is_default, a.disabled_at,
       a.created_at, a.updated_at,
       d.domain,
       d.spf_status, d.dkim_status, d.dmarc_status, d.mx_status,
       d.health_checked_at
from public.email_accounts a
left join public.email_domains d on d.id = a.domain_id;

grant select on public.email_accounts_safe to authenticated;

revoke all on table public.email_accounts from anon;
revoke all on table public.email_domains  from anon;
revoke all on public.email_accounts_safe  from anon;


-- ────────────────────────────────────────────────────────────────────
-- 024_shared_mailboxes.sql
-- Letting somebody send from a shared mailbox they did not connect.
-- ────────────────────────────────────────────────────────────────────

-- 024 — letting somebody send from a mailbox they did not connect.
--
-- THE GAP THIS CLOSES. 023 tied a mailbox to the person whose Microsoft
-- account granted the OAuth, which is correct — Graph sends as them. But it
-- means only that one person can see or use it, and a shared sales@ or
-- procurement@ exists precisely so several people can. Without this, one
-- person connects the shared inbox and nobody else can send from it.
--
-- WHAT A GRANT IS AND IS NOT. It says "this person may SEND from this
-- mailbox". It does not hand over the refresh token, which stays unreadable
-- to everyone but the owner and Admins (023's narrow select policy, and the
-- token-free view). The actual send happens server-side with the service
-- role, which checks the grant before it uses anybody's token.
--
-- SCHEMA CHANGE: one table, one view replaced. Nothing existing is touched.
-- Safe to re-run.

create table if not exists public.email_account_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists email_account_grants_key
  on public.email_account_grants (account_id, profile_id);
create index if not exists email_account_grants_profile_idx
  on public.email_account_grants (profile_id);

alter table public.email_account_grants enable row level security;

-- WHO MAY GRANT: the mailbox's owner, or an Admin/Manager. Deliberately NOT
-- anyone already granted — otherwise one grant spreads through the company
-- without the owner ever knowing, and "who can send as procurement@" stops
-- having an answer.
create or replace function public.may_manage_email_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.email_accounts a
    where a.id = p_account_id
      and (a.connected_by = auth.uid() or public.is_privileged())
  );
$$;

-- Revoked from anon BY NAME. `revoke ... from public` leaves Supabase's
-- default grant to the real role `anon` in place — the mistake 019 exists to
-- close and 021 repeated.
revoke all on function public.may_manage_email_account(uuid) from public, anon;
grant execute on function public.may_manage_email_account(uuid) to authenticated;

drop policy if exists "email_account_grants_read" on public.email_account_grants;
create policy "email_account_grants_read" on public.email_account_grants for select
  to authenticated
  using (profile_id = auth.uid() or public.may_manage_email_account(account_id));

drop policy if exists "email_account_grants_write" on public.email_account_grants;
create policy "email_account_grants_write" on public.email_account_grants for all
  to authenticated
  using (public.may_manage_email_account(account_id))
  with check (public.may_manage_email_account(account_id));

revoke all on table public.email_account_grants from anon;

-- ── the sender list a person actually sees ────────────────────────────
-- Replaces 023's view: same columns, plus mailboxes granted to the caller.
-- Still `security_invoker`, so email_accounts' own policy applies underneath
-- — and still no refresh_token column, because Postgres has no column-level
-- RLS and a view is the only way to hand out some columns and not others.
-- THE FUNCTION FIRST. my_sending_accounts() returns `setof
-- email_accounts_safe`, which makes it depend on the view — so dropping the
-- view while it exists fails with "other objects depend on it" and the
-- migration stops being safe to re-run. Every other migration in this repo
-- is; found by running this one twice.
drop function if exists public.my_sending_accounts();
drop view if exists public.email_accounts_safe;
create view public.email_accounts_safe
with (security_invoker = true) as
select a.id, a.domain_id, a.email, a.display_name, a.provider,
       a.connected_by, a.status, a.status_detail, a.last_ok_at,
       a.daily_limit, a.hourly_limit, a.is_default, a.disabled_at,
       a.created_at, a.updated_at,
       d.domain, d.spf_status, d.dkim_status, d.dmarc_status, d.mx_status,
       d.health_checked_at,
       (a.connected_by = auth.uid()) as is_mine
from public.email_accounts a
left join public.email_domains d on d.id = a.domain_id;

grant select on public.email_accounts_safe to authenticated;
revoke all on public.email_accounts_safe from anon;

-- WHY A FUNCTION RATHER THAN WIDENING THE POLICY. Letting `email_accounts`
-- be selected by anyone holding a grant would expose the refresh_token
-- column to them too — RLS is per row, not per column. This returns only the
-- safe columns and is the one thing a granted user calls.
create or replace function public.my_sending_accounts()
returns setof public.email_accounts_safe
language sql
stable
security definer
set search_path = public
as $$
  select v.*
  from public.email_accounts_safe v
  where v.disabled_at is null
    and (
      v.connected_by = auth.uid()
      or public.is_privileged()
      or exists (select 1 from public.email_account_grants g
                 where g.account_id = v.id and g.profile_id = auth.uid())
    );
$$;

revoke all on function public.my_sending_accounts() from public, anon;
grant execute on function public.my_sending_accounts() to authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 025_tighten_anon_execute.sql
-- One more function anon should never have been able to reach.
-- ────────────────────────────────────────────────────────────────────

-- 025 — one more function anon should never have been able to reach.
--
-- NOT A VULNERABILITY, and worth saying so plainly rather than dressing it
-- up: regenerate_webhook_secret() guards itself with `if not is_admin()
-- then raise`, and an anonymous caller has no auth.uid(), so is_admin() is
-- false and the call is refused. Verified by calling it as anon.
--
-- It is still reachable, and that is the thing 019 exists to stop. A guard
-- inside a function is one edit away from being weakened; a missing EXECUTE
-- grant is not. Defence in depth costs one line.
--
-- THE SAME OLD TRAP: `revoke ... from public` does NOT remove this. PUBLIC
-- is a pseudo-role; Supabase grants EXECUTE on every new function to the
-- real role `anon` separately through alter default privileges. It has to be
-- revoked from anon BY NAME. That mistake has now been made three times in
-- this repo — in 019, in 021, and here — which is why it is written out
-- again rather than assumed remembered.
--
-- DELIBERATELY NOT TOUCHED: is_privileged() and is_admin() stay callable by
-- anon. Row-level-security policies call them while evaluating an anonymous
-- request — that is how they resolve to false and match no rows. Revoking
-- them makes an anonymous request ERROR instead of quietly seeing nothing,
-- which would break the public registration form and the customer portal.
-- Proven the hard way while testing the Azure bootstrap.
--
-- SCHEMA CHANGE: none. One grant removed. Safe to re-run.

-- THE SIGNATURE MATTERS. 005 created this with no arguments and 006
-- redefined it as (p_kind text). A REVOKE naming the wrong overload does
-- not error loudly — it fails with "function does not exist", which in a
-- long migration is one line among many and easy to scroll past. The first
-- version of this file did exactly that and the sweep still showed the
-- grant in place afterwards.
revoke all on function public.regenerate_webhook_secret(text) from public, anon;
grant execute on function public.regenerate_webhook_secret(text) to authenticated;


-- ════════════════════════════════════════════════════════════════════
-- Done. Nothing else needs running.
--
-- To check it worked, run these on their own:
--
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('purchase_orders', 'invoices', 'attachments',
--                        'follow_ups', 'broadcasts')
--   order by table_name;
--
--   select routine_name from information_schema.routines
--   where routine_schema = 'public'
--     and routine_name in ('my_lead_code', 'next_customer_code',
--                          'find_duplicate_customer', 'next_doc_seq')
--   order by routine_name;
--
--   select count(*) filter (where coalesce(data ->> 'code', '') = '') as without_an_id,
--          count(*) as customers
--   from public.customers;
--
--   select column_name from information_schema.columns
--   where table_name = 'follow_ups'
--     and column_name in ('channel', 'delivery_state')
--   order by column_name;
--
-- Ten tables, four functions, no customer without an ID, and both a
-- channel and a delivery_state column on follow_ups.
-- ════════════════════════════════════════════════════════════════════
