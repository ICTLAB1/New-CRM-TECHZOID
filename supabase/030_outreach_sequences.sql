-- 030 — the shape the outreach module actually has to be.
--
-- What was built sends ONE message to a flat pool of prospects. The design
-- this is moving to sends a FOUR-STEP SEQUENCE to a named list, threads
-- steps two to four as replies under the first, and stops the whole sequence
-- the moment somebody answers. That last part is the reason the rest exists:
-- a sequence that keeps chasing a person who already replied is the single
-- most damaging thing this module can do, and there is no way to avoid it
-- without modelling steps and replies as first-class things.
--
-- WHAT CHANGES, AND WHAT DOES NOT.
--
--   outreach_lists         NEW. A list is what somebody uploaded, with a name
--                          and the file it came from. Prospects were a flat
--                          pool, which cannot answer "who was in the Delhi
--                          NCR Autodesk list" — a question asked constantly.
--   outreach_rejects       NEW. Rows an import would not accept, kept with
--                          the reason. Nothing is deleted: if a check
--                          misfired, somebody has to be able to see it did.
--   outreach_sequences     NEW. The steps of a campaign: how many days to
--                          wait, and what to say.
--   outreach_sends         GAINS step_no and the threading identifiers, so
--                          step two can be delivered as a reply to step one
--                          rather than as a second cold email.
--   outreach_replies       NEW. What came back. Writing a reply here is what
--                          cancels the rest of that contact's sequence.
--   email_accounts         GAINS a per-mailbox counter and a ramp. Microsoft
--                          limits per mailbox, so a shared sales@ and one
--                          person's inbox cannot share a budget, and a brand
--                          new mailbox that sends two hundred on its first
--                          day is a mailbox that stops reaching inboxes.
--
-- outreach_prospects keeps its name and its rows. It is the contact table;
-- it simply gains a list.
--
-- WHAT IS DELIBERATELY ABSENT: open tracking and click tracking. A tracking
-- pixel is a spam signal, link wrapping is a stronger one, and Apple's Mail
-- Privacy Protection made open rates meaningless in 2021 by fetching every
-- image whether or not anybody looked. Reply rate is the only number here
-- worth managing, so it is the only one measured.
--
-- SCHEMA CHANGE: four new tables, columns on two existing ones. Nothing is
-- dropped and no row is rewritten. Safe to re-run.

create extension if not exists pgcrypto;


-- ── a list somebody uploaded ──────────────────────────────────────────
create table if not exists public.outreach_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default '',
  source_file text not null default '',
  /* The counts as they stood at import. Kept rather than derived: rows get
     suppressed and quarantined afterwards, and "how many did I upload" is a
     different question from "how many can I write to today". */
  rows_read integer not null default 0,
  imported integer not null default 0,
  rejected integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists outreach_lists_owner_idx
  on public.outreach_lists (owner_id, created_at desc);

alter table public.outreach_prospects
  add column if not exists list_id uuid references public.outreach_lists (id) on delete set null;

create index if not exists outreach_prospects_list_idx
  on public.outreach_prospects (list_id);


-- ── rows an import would not take ─────────────────────────────────────
create table if not exists public.outreach_rejects (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.outreach_lists (id) on delete cascade,
  email text not null default '',
  reason text not null default '',
  /* Whatever the row actually held, so somebody can see what was wrong
     rather than being told a category. */
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists outreach_rejects_list_idx
  on public.outreach_rejects (list_id, created_at);


-- ── the steps of a campaign ───────────────────────────────────────────
create table if not exists public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns (id) on delete cascade,

  step_no integer not null check (step_no between 1 and 12),
  /* Working days after the PREVIOUS step, not after the start. Somebody
     editing "wait 3 days" should not have to recompute every later step. */
  delay_days integer not null default 0 check (delay_days between 0 and 365),

  /* Null on steps 2 and up: they are replies inside the thread the first
     step opened, and a reply that changes the subject line starts a new
     conversation in most mail clients, which defeats the point. */
  subject text,
  body text not null default '',

  created_at timestamptz not null default now()
);

create unique index if not exists outreach_sequences_step_key
  on public.outreach_sequences (campaign_id, step_no);


-- ── which step a queued message is, and what it replies to ────────────
alter table public.outreach_sends
  add column if not exists step_no integer not null default 1;

/* THE THREADING IDENTIFIERS. Microsoft Graph returns a conversationId and a
   message id when a message is sent; quoting the latter in In-Reply-To is
   what makes step two land under step one rather than beside it. Stored per
   CONTACT rather than per send, on the first step's row, and read back when
   the later steps go out. */
alter table public.outreach_sends
  add column if not exists conversation_id text not null default '';
alter table public.outreach_sends
  add column if not exists internet_message_id text not null default '';

/* A send is due at a moment, not merely queued. Without this every step of
   a four-step sequence would be eligible the instant the campaign launched. */
alter table public.outreach_sends
  add column if not exists due_at timestamptz not null default now();

create index if not exists outreach_sends_due_idx
  on public.outreach_sends (state, due_at) where state = 'queued';

/* The old unique index was one row per (campaign, prospect), which was right
   for a single send and is wrong for a sequence: the same person now gets
   four. One per step instead. */
drop index if exists public.outreach_sends_once_key;
create unique index if not exists outreach_sends_once_key
  on public.outreach_sends (campaign_id, prospect_id, step_no);


-- ── what came back ────────────────────────────────────────────────────
create table if not exists public.outreach_replies (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.outreach_prospects (id) on delete cascade,
  campaign_id uuid references public.outreach_campaigns (id) on delete set null,

  subject text not null default '',
  /* A short excerpt only. The full text lives in the mailbox it arrived in;
     copying a stranger's words into this database wholesale would be storing
     correspondence nobody agreed to have stored. */
  preview text not null default '',

  /* 'reply' | 'bounce' | 'auto-reply' — an out-of-office is not an answer
     and must not stop a sequence, which is the whole reason this is a column
     and not a boolean. */
  kind text not null default 'reply' check (kind in ('reply','bounce','auto-reply')),

  message_id text not null default '',
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists outreach_replies_message_key
  on public.outreach_replies (message_id) where message_id <> '';
create index if not exists outreach_replies_prospect_idx
  on public.outreach_replies (prospect_id, received_at desc);


/**
 * A REPLY CANCELS THE REST OF THE SEQUENCE. Immediately, in the database,
 * rather than in whichever code path happens to notice.
 *
 * Doing this in the application means every future writer has to remember,
 * and the cost of forgetting is a message chasing somebody for a decision
 * they already gave. An out-of-office is excluded on purpose: it is not an
 * answer, and treating it as one would silently drop people who were merely
 * on holiday.
 */
create or replace function public.outreach_stop_on_reply()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'auto-reply' then return new; end if;

  update public.outreach_sends s
     set state = 'skipped',
         note  = case when new.kind = 'bounce'
                   then 'Stopped — the previous message bounced.'
                   else 'Stopped — they replied.' end
   where s.prospect_id = new.prospect_id
     and s.state = 'queued';

  update public.outreach_prospects
     set status = case when new.kind = 'bounce' then 'Bounced' else 'Replied' end,
         updated_at = now()
   where id = new.prospect_id;

  /* A bounce is a fact about the address, not about this campaign, so it
     also goes on the suppression list — no later campaign should find it
     again. A reply does not: somebody who answered is a lead, not a
     do-not-contact. */
  if new.kind = 'bounce' then
    insert into public.outreach_suppressions (email, reason, source)
    select p.email, 'hard-bounce', 'reply-watch'
      from public.outreach_prospects p
     where p.id = new.prospect_id
       and not exists (
         select 1 from public.outreach_suppressions x
          where lower(x.email) = lower(p.email)
       );
  end if;

  return new;
end; $$;

drop trigger if exists outreach_replies_stop on public.outreach_replies;
create trigger outreach_replies_stop
  after insert on public.outreach_replies
  for each row execute function public.outreach_stop_on_reply();


-- ── per-mailbox sending budget ────────────────────────────────────────
--
-- Microsoft's limits are per mailbox. A shared sales@ and one person's inbox
-- cannot sensibly share a budget, and a brand new mailbox that sends two
-- hundred on its first day is a mailbox that stops reaching inboxes by the
-- end of the week.

alter table public.email_accounts
  add column if not exists sent_today integer not null default 0;
alter table public.email_accounts
  add column if not exists cap_reset_on date;
/* When this mailbox first sent anything through the CRM. The ramp is
   measured from here rather than from when the row was created, because a
   mailbox connected in January and first used in June is new to sending. */
alter table public.email_accounts
  add column if not exists warmup_started_on date;

/**
 * What this mailbox may send today.
 *
 * Fifteen on day one, rising to the configured limit over three weeks. The
 * numbers are not precise science — no published figure is — but the shape
 * is what matters: a new mailbox that starts slowly and climbs looks like a
 * person, and one that opens at two hundred looks like a list.
 */
create or replace function public.mailbox_daily_allowance(p_account_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select greatest(0, least(
    a.daily_limit,
    case
      when a.warmup_started_on is null then 15
      else 15 + floor((current_date - a.warmup_started_on) * (a.daily_limit - 15) / 21.0)::int
    end
  ))
  from public.email_accounts a
  where a.id = p_account_id;
$$;

grant execute on function public.mailbox_daily_allowance(uuid) to authenticated;


-- ── who may see what ──────────────────────────────────────────────────
alter table public.outreach_lists     enable row level security;
alter table public.outreach_rejects   enable row level security;
alter table public.outreach_sequences enable row level security;
alter table public.outreach_replies   enable row level security;

drop policy if exists "outreach_lists_rw" on public.outreach_lists;
create policy "outreach_lists_rw" on public.outreach_lists for all
  to authenticated
  using (owner_id = auth.uid() or public.is_privileged())
  with check (owner_id = auth.uid() or public.is_privileged());

drop policy if exists "outreach_rejects_read" on public.outreach_rejects;
create policy "outreach_rejects_read" on public.outreach_rejects for select
  to authenticated
  using (exists (select 1 from public.outreach_lists l
                  where l.id = outreach_rejects.list_id
                    and (l.owner_id = auth.uid() or public.is_privileged())));

drop policy if exists "outreach_rejects_write" on public.outreach_rejects;
create policy "outreach_rejects_write" on public.outreach_rejects for insert
  to authenticated
  with check (exists (select 1 from public.outreach_lists l
                       where l.id = outreach_rejects.list_id
                         and (l.owner_id = auth.uid() or public.is_privileged())));

drop policy if exists "outreach_sequences_rw" on public.outreach_sequences;
create policy "outreach_sequences_rw" on public.outreach_sequences for all
  to authenticated
  using (exists (select 1 from public.outreach_campaigns c
                  where c.id = outreach_sequences.campaign_id
                    and (c.owner_id = auth.uid() or public.is_privileged())))
  with check (exists (select 1 from public.outreach_campaigns c
                       where c.id = outreach_sequences.campaign_id
                         and (c.owner_id = auth.uid() or public.is_privileged())));

/* Replies are READ by people and WRITTEN by the server. A client that could
   insert one could cancel anybody's sequence. */
drop policy if exists "outreach_replies_read" on public.outreach_replies;
create policy "outreach_replies_read" on public.outreach_replies for select
  to authenticated
  using (exists (select 1 from public.outreach_prospects p
                  where p.id = outreach_replies.prospect_id
                    and (p.owner_id = auth.uid() or public.is_privileged())));

grant select, insert, update, delete on table public.outreach_lists     to authenticated;
grant select, insert                 on table public.outreach_rejects   to authenticated;
grant select, insert, update, delete on table public.outreach_sequences to authenticated;
grant select                         on table public.outreach_replies   to authenticated;
revoke insert, update, delete, truncate on table public.outreach_replies from authenticated;

revoke all on table public.outreach_lists     from anon;
revoke all on table public.outreach_rejects   from anon;
revoke all on table public.outreach_sequences from anon;
revoke all on table public.outreach_replies   from anon;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='outreach_replies') then
    execute 'alter publication supabase_realtime add table public.outreach_replies';
  end if;
end $$;
