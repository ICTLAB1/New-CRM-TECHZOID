-- WhatsApp: every message out and in, and who agreed to receive them.
--
-- SCHEMA CHANGE: adds one table and three indexes. Nothing existing is
-- touched and no policy on another table changes. Safe to re-run.
--
-- ONE ROW PER MESSAGE, both directions. The same shape 027 chose for
-- campaign sends, for the same reason: "did Acme get the overdue reminder,
-- and did they read it?" has to have an answer on a row. A tally would not
-- survive the first time somebody asks about one customer.
--
-- A WHATSAPP MESSAGE IS NOT SENT AND THEN FINISHED. Meta accepts it, then
-- says delivered, then says read, each on a webhook minutes or hours later;
-- a failure can also arrive after the send looked fine. So `status` moves
-- forward on an existing row, found by the id Meta gave us
-- (`wa_message_id`), and that is why it is indexed.
--
-- WHERE THE OTHER TWO PIECES LIVE, and why they are not here:
--
--   · the customer's WhatsApp number and whether they agreed to updates go
--     in the customer record's own `data`, beside their email and phone.
--     They are facts about the customer, they are edited on the customer
--     sheet, and the policies that decide who may see a customer already
--     decide these correctly.
--   · the eight on/off switches go in the settings row, like every other
--     company-wide setting. They default to off by being absent, which is
--     what "default all OFF so I can switch them on one by one" asks for —
--     a switch nobody has touched cannot be on.

create extension if not exists pgcrypto;

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,

  -- 'out' is ours, 'in' is the customer's. One table rather than two
  -- because the Inbox shows a conversation, and a conversation is both
  -- sides in time order.
  direction text not null check (direction in ('out', 'in')),

  -- Who it is with. Null for an inbound message from a number nobody has
  -- on file yet — which is a real case and must not be dropped: it is how
  -- a new enquiry arrives.
  customer_id text,
  -- Always recorded, even when the customer is known, because a customer
  -- may have more than one number and the thread belongs to the number.
  phone text not null,
  contact_name text not null default '',

  -- Outbound only: which approved template, and the blanks it was sent
  -- with. Kept as sent rather than re-derived later, so what a customer
  -- received is a fact and not a re-render of a template somebody has
  -- edited since.
  template text not null default '',
  params jsonb not null default '[]'::jsonb,
  -- What the message actually said, as best we can render it. For an
  -- inbound message this is the customer's own words.
  body text not null default '',

  -- Meta's id for the message. The webhook finds the row by this to move
  -- the status on, so it is unique where present.
  wa_message_id text,

  -- queued -> sent -> delivered -> read, or failed at any point.
  -- 'received' is an inbound message, which has no further states.
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  error text not null default '',

  -- What caused it: 'manual' when somebody pressed the button, otherwise
  -- the automatic rule that fired. Answers "why did this customer get
  -- this?" without anybody having to reason about it.
  trigger text not null default '',
  -- The record it was about, so the same thing is never sent twice for the
  -- same event — see the unique index below.
  record_type text not null default '',
  record_id text not null default '',

  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The Inbox, newest first.
create index if not exists whatsapp_messages_company_idx
  on public.whatsapp_messages (company_id, created_at desc);
-- One customer's history, on their record.
create index if not exists whatsapp_messages_customer_idx
  on public.whatsapp_messages (company_id, customer_id, created_at desc);
-- A thread is a phone number: the Inbox groups by it, and an inbound
-- message is matched to a customer through it.
create index if not exists whatsapp_messages_phone_idx
  on public.whatsapp_messages (company_id, phone, created_at desc);
-- The webhook's lookup: find the row Meta is talking about.
create unique index if not exists whatsapp_messages_wa_id_idx
  on public.whatsapp_messages (wa_message_id) where wa_message_id is not null;

-- NOT TWICE FOR THE SAME THING. A daily job that runs twice, a browser
-- that retries, two people pressing the button within a second of each
-- other: each of those is a customer receiving the same reminder twice,
-- which is worse than not receiving it at all. The database refuses it
-- rather than every caller remembering to check.
--
-- Scoped by the DAY on purpose: the overdue reminder is meant to go out
-- again a week later, and the follow-up may legitimately be sent by hand
-- the day after an automatic one. Same customer, same template, same
-- record, same day = once.
create unique index if not exists whatsapp_messages_once_idx
  on public.whatsapp_messages (
    company_id, template, record_id, phone, ((created_at at time zone 'Asia/Kolkata')::date)
  )
  where direction = 'out' and template <> '' and record_id <> '' and status <> 'failed';

do $$
begin
  execute 'alter table public.whatsapp_messages enable row level security';

  /* ANY MEMBER MAY READ THE CONVERSATION. A salesperson needs to see what
     the customer was told and what they replied; hiding it would mean
     ringing the customer to ask what the CRM already knows. */
  execute 'drop policy if exists whatsapp_messages_select on public.whatsapp_messages';
  execute 'create policy whatsapp_messages_select on public.whatsapp_messages for select
    to authenticated
    using (public.is_member(company_id))';

  /* NOBODY WRITES FROM A BROWSER. Every row here is written by the server:
     the sender when it sends, the webhook when Meta reports. A log a client
     could write is not a log — and a client that could insert a row could
     also record a message that was never sent. There is deliberately no
     insert, update or delete policy, so those commands match nothing
     however the grants below change. */
end $$;

/* ── matching an incoming message to a customer ──────────────────────
   A reply arrives as a bare number: "919810012345". The customer records
   hold whatever somebody typed — "+91 98100 12345", "098100-12345",
   "9810012345" — so the two only meet once both are reduced to digits.

   Done in SQL rather than by reading every customer into the webhook: a
   company with four thousand customers would otherwise pull all of them
   over the wire for each message that arrives.

   MATCHED ON THE LAST TEN DIGITS, because that is the part that identifies
   an Indian subscriber however the country code was written — or not
   written — when the record was created. Ten is long enough that a
   collision is somebody else's problem rather than a plausible accident.

   SECURITY DEFINER with a fixed search_path: it reads customers across the
   company to answer "whose number is this", which is exactly what the
   webhook needs and what no browser should be able to ask. EXECUTE is
   granted to nobody, so only the service role can call it. */
create or replace function public.whatsapp_customer_for(p_company uuid, p_digits text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.id
    from public.customers c
   where c.company_id = p_company
     and length(regexp_replace(coalesce(p_digits, ''), '[^0-9]', '', 'g')) >= 10
     and (
       right(regexp_replace(coalesce(c.data ->> 'whatsappPhone', ''), '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(p_digits, '[^0-9]', '', 'g'), 10)
       or right(regexp_replace(coalesce(c.data ->> 'phone', ''), '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(p_digits, '[^0-9]', '', 'g'), 10)
     )
   /* The one somebody has looked at most recently, when two records hold
      the same number — which every CRM accumulates. */
   order by c.updated_at desc nulls last, c.created_at desc nulls last
   limit 1
$$;

/* WHICH COMPANY A REPLY BELONGS TO.

   The business has one WhatsApp number, and a CRM deployment can hold more
   than one company — this one holds a leftover stub beside the real
   company, which is normal. So "the oldest company" is a guess, and it was
   wrong on the first database it met: every reply was filed under a company
   with no customers in it, where nobody would ever look.

   The number answers it. A reply from a number that is on a customer record
   belongs to that customer's company, whatever else exists. Only when the
   number is on nobody's record is a fallback needed, and then the webhook
   decides. */
create or replace function public.whatsapp_company_for(p_digits text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.company_id
    from public.customers c
   where c.company_id is not null
     and length(regexp_replace(coalesce(p_digits, ''), '[^0-9]', '', 'g')) >= 10
     and (
       right(regexp_replace(coalesce(c.data ->> 'whatsappPhone', ''), '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(p_digits, '[^0-9]', '', 'g'), 10)
       or right(regexp_replace(coalesce(c.data ->> 'phone', ''), '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(p_digits, '[^0-9]', '', 'g'), 10)
     )
   order by c.updated_at desc nulls last, c.created_at desc nulls last
   limit 1
$$;

revoke all on function public.whatsapp_company_for(text) from public;
revoke all on function public.whatsapp_company_for(text) from anon;
revoke all on function public.whatsapp_company_for(text) from authenticated;

revoke all on function public.whatsapp_customer_for(uuid, text) from public;
revoke all on function public.whatsapp_customer_for(uuid, text) from anon;
revoke all on function public.whatsapp_customer_for(uuid, text) from authenticated;

grant select on table public.whatsapp_messages to authenticated;

/* Named, not inherited. Supabase's default privileges handed `anon` a grant
   the moment the table was created, and `revoke from public` does not take
   it back. What a customer said on WhatsApp is not public. */
revoke all on table public.whatsapp_messages from anon;
