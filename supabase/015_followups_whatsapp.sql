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
