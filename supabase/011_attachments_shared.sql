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
