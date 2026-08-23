-- Per-user Microsoft 365 mailbox connections.
--
-- Deliberately NOT stored on public.profiles: that table is readable by every
-- authenticated user (see profiles_select_authenticated), which is fine for
-- names and roles but would expose one salesperson's mailbox tokens to the
-- whole team. This table is readable only by its owner, and the refresh token
-- is only ever handled server-side by the Netlify functions using the service
-- role key.

create table if not exists public.ms_mail_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ms_email text not null default '',
  ms_display_name text not null default '',
  refresh_token text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ms_mail_accounts enable row level security;

-- A user may see whether THEIR OWN mailbox is connected (used to show
-- "Connected as ..." in Settings). No policy grants read access to anyone
-- else's row, and none grants direct insert/update — those happen only
-- through the server-side functions.
create policy "ms_mail_select_own" on public.ms_mail_accounts for select
  using (auth.uid() = user_id);

-- Let a user disconnect their own mailbox from the UI.
create policy "ms_mail_delete_own" on public.ms_mail_accounts for delete
  using (auth.uid() = user_id);
