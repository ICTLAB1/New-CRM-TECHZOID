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


-- ════════════════════════════════════════════════════════════════════
-- Done. Nothing else needs running.
--
-- To check it worked, run this on its own:
--
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('purchase_orders', 'invoices', 'attachments')
--   order by table_name;
--
-- Three rows back means everything is in place.
-- ════════════════════════════════════════════════════════════════════
