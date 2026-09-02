-- 027 — campaigns, and the queue that actually sends them.
--
-- 022 built the front of the funnel: who the prospects are. This is the part
-- that puts mail in front of them, and it is the part that can do damage, so
-- the shape of it is defensive on purpose.
--
-- WHY A ROW PER RECIPIENT AND NOT A LIST ON THE CAMPAIGN. A campaign to 400
-- people is 400 rows in outreach_sends, each with its own state. That costs
-- storage nobody will notice and buys three things worth far more:
--
--   * Sending twice becomes impossible rather than unlikely. A row moves
--     queued -> sending -> sent and the move is conditional on its current
--     state, so two overlapping runs cannot both claim it.
--   * "What happened to Ravi at Acme?" has an answer — the row carries the
--     subject he was sent, when, from which mailbox, and any error.
--   * Stopping a campaign is one update. The rows already sent stay sent;
--     the rest simply never leave the queue.
--
-- WHAT IS DELIBERATELY NOT HERE. There is no "send now" flag a screen can
-- set to bypass the queue, and no column that lets a campaign target an
-- address that is not already a prospect row. Every send is traceable back
-- to a prospect somebody imported and a campaign somebody launched.
--
-- Prefixed `outreach_` for the reason 022 explains: this database is shared
-- with another application that owns the unprefixed names, `campaigns`
-- among them. Safe to re-run.

create extension if not exists pgcrypto;


-- ── the campaign ──────────────────────────────────────────────────────
create table if not exists public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,

  name text not null default '',

  -- Which mailbox it sends from. Not the owner's by assumption: 024 exists
  -- precisely so somebody can send from a shared mailbox they were granted.
  from_account_id uuid references public.email_accounts (id) on delete set null,

  subject text not null default '',
  body text not null default '',
  html text not null default '',
  -- Which of the built-in templates this started from, for reporting. The
  -- words above are what sends; this is a label, never re-rendered.
  template_id text not null default '',

  reply_to text not null default '',

  -- 'draft' | 'sending' | 'paused' | 'done' | 'cancelled'
  --
  -- Free text with a check, not an enum: the states are few and unlikely to
  -- grow, and a bad value here would send mail nobody approved.
  status text not null default 'draft'
    check (status in ('draft','sending','paused','done','cancelled')),

  -- THE THROTTLE, per campaign. Defaults chosen to be survivable rather than
  -- fast: a new domain sending 400 cold emails in an hour is a domain that
  -- stops reaching inboxes by Thursday.
  daily_cap integer not null default 50 check (daily_cap between 1 and 500),
  -- Seconds between two messages. 90 is roughly 40 an hour.
  min_gap_seconds integer not null default 90 check (min_gap_seconds between 5 and 3600),

  -- Send only inside the working day, in the workspace's timezone. Nobody
  -- believes a cold email that arrives at 03:12.
  send_from_hour integer not null default 9  check (send_from_hour between 0 and 23),
  send_to_hour   integer not null default 18 check (send_to_hour   between 1 and 24),
  -- 1 = Monday .. 7 = Sunday, ISO. Weekends off by default.
  send_days integer[] not null default '{1,2,3,4,5}',
  timezone text not null default 'Asia/Kolkata',

  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A window has to be a window. Without this a typo of 18-9 would mean
  -- "never", and the campaign would sit at 'sending' forever looking healthy.
  constraint outreach_campaigns_window check (send_to_hour > send_from_hour)
);

create index if not exists outreach_campaigns_owner_idx
  on public.outreach_campaigns (owner_id, created_at desc);
create index if not exists outreach_campaigns_status_idx
  on public.outreach_campaigns (status) where status in ('sending','paused');


-- ── one row per person the campaign will write to ─────────────────────
create table if not exists public.outreach_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns (id) on delete cascade,
  prospect_id uuid not null references public.outreach_prospects (id) on delete cascade,

  -- Copied from the prospect at queue time, not joined at send time. The
  -- address a campaign was aimed at is a fact about that moment; if somebody
  -- corrects a typo in the prospect afterwards, the record of what was
  -- actually sent must not silently change with it.
  send_to text not null,

  -- Rendered per recipient when the campaign was queued, with that person's
  -- name and company already in it. The sender does not template anything —
  -- see the note in netlify/functions/outreach-run.mjs.
  subject text not null default '',
  body text not null default '',
  html text not null default '',

  -- 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'
  state text not null default 'queued'
    check (state in ('queued','sending','sent','failed','skipped')),

  -- Why it was not sent, in words a salesperson can read on the screen.
  note text not null default '',

  -- Set when a run claims the row, so a run that dies mid-flight leaves
  -- evidence rather than a row stuck at 'sending' with no explanation.
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text not null default '',

  created_at timestamptz not null default now()
);

-- ONE SEND PER PERSON PER CAMPAIGN. The database refuses a duplicate rather
-- than trusting every code path that will ever queue a row to check first.
create unique index if not exists outreach_sends_once_key
  on public.outreach_sends (campaign_id, prospect_id);

-- The sender's own query: the next queued rows for a live campaign.
create index if not exists outreach_sends_queue_idx
  on public.outreach_sends (campaign_id, state, created_at);
create index if not exists outreach_sends_state_idx
  on public.outreach_sends (state) where state in ('queued','sending');


-- ── who may see what ──────────────────────────────────────────────────
alter table public.outreach_campaigns enable row level security;
alter table public.outreach_sends     enable row level security;

drop policy if exists "outreach_campaigns_rw" on public.outreach_campaigns;
create policy "outreach_campaigns_rw" on public.outreach_campaigns for all
  to authenticated
  using (owner_id = auth.uid() or public.is_privileged())
  with check (owner_id = auth.uid() or public.is_privileged());

-- A send row follows its campaign. Written by the server (service role) at
-- launch and updated only by the sender; a person may READ theirs, which is
-- what the progress screen needs, and may not write one by hand.
drop policy if exists "outreach_sends_read" on public.outreach_sends;
create policy "outreach_sends_read" on public.outreach_sends for select
  to authenticated
  using (exists (
    select 1 from public.outreach_campaigns c
     where c.id = outreach_sends.campaign_id
       and (c.owner_id = auth.uid() or public.is_privileged())
  ));

grant select, insert, update, delete on table public.outreach_campaigns to authenticated;

-- SELECT ONLY on the queue, and that is the point: it is the server's to
-- write. A browser that could insert here could send mail to anyone.
--
-- The revoke is the half that does the work. Supabase's default privileges
-- had ALREADY granted authenticated insert/update/delete when the table was
-- created, so granting select adds nothing and takes nothing away — without
-- the revoke, the only thing standing between a signed-in user and an
-- arbitrary send row is the RLS policy. That policy is correct and it does
-- hold, but a feature this dangerous should not rest on one control.
grant select on table public.outreach_sends to authenticated;
revoke insert, update, delete, truncate on table public.outreach_sends from authenticated;

revoke all on table public.outreach_campaigns from anon;
revoke all on table public.outreach_sends     from anon;

-- Live, so a progress bar moves while a campaign runs.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='outreach_sends') then
    execute 'alter publication supabase_realtime add table public.outreach_sends';
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='outreach_campaigns') then
    execute 'alter publication supabase_realtime add table public.outreach_campaigns';
  end if;
end $$;
