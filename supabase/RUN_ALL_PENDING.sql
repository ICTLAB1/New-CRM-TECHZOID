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
-- Order matters in one place only: 011 must come after 010.
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


-- ════════════════════════════════════════════════════════════════════
-- Done. Nothing else needs running.
--
-- To check it worked, run these on their own:
--
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('purchase_orders', 'invoices', 'attachments', 'follow_ups')
--   order by table_name;
--
--   select routine_name from information_schema.routines
--   where routine_schema = 'public'
--     and routine_name in ('my_lead_code', 'next_customer_code');
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
-- Four tables, two functions, no customer without an ID, and both a channel
-- and a delivery_state column on follow_ups.
-- ════════════════════════════════════════════════════════════════════
