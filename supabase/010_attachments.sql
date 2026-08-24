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
