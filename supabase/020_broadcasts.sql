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
