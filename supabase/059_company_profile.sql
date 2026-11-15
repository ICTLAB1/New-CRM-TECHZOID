-- The company profile, and a record of who it was sent to.
--
-- SCHEMA CHANGE: adds two tables. Nothing existing is touched and no policy
-- on another table changes. Safe to re-run.
--
-- WHY THE FILE LIVES IN THE DATABASE. Sending the profile to thirty
-- customers means thirty separate messages, each carrying the same PDF. The
-- browser must not upload it thirty times — that is sixty megabytes up a
-- hotel wifi to send one mailshot, and the send would fail halfway through
-- for reasons nobody could see. So the file is stored once and the sending
-- function reads it.
--
-- Not in the settings row: every member of the company loads that on every
-- page, and a three-megabyte PDF in it would be three megabytes added to
-- every sign-in (see 058, which took the catalog's cost figures out of it
-- for a related reason). Not in the attachments bucket either: no function
-- in this codebase reads from object storage, every one of them reaches the
-- database, and the profile is a single small row — a table is the thing
-- that already works everywhere this has to work.
--
-- ONE ROW PER COMPANY. There is one current profile; replacing it is an
-- upsert, and the one before it is not kept. A version history for a
-- marketing PDF is a feature nobody asked for and a megabyte a month
-- forever.

create extension if not exists pgcrypto;

create table if not exists public.company_profiles (
  company_id uuid primary key references public.companies (id) on delete cascade,
  /* What the customer sees as the attachment's name. Not the storage key:
     there is no storage key, and "Company-Profile-v4-FINAL(2).pdf" is not
     what should land in an inbox. */
  file_name text not null,
  mime text not null default 'application/pdf',
  /* The real byte count, so a screen can say the size without decoding
     three megabytes of base64 to find out. */
  bytes integer not null default 0,
  /* Base64, which is how both mail transports want it anyway — Microsoft
     Graph's contentBytes and Resend's content are both base64, so storing
     the decoded bytes would mean encoding them again on every send. */
  content text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- One row per recipient per send. The same shape 027 chose for campaigns,
-- and for the same reason: "what was sent to Ravi at Acme, and did it
-- arrive?" has to have an answer on a row. A tally would not survive the
-- first time somebody asks whether a particular customer was included.
create table if not exists public.profile_sends (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  /* Everything sent in one press of Send shares this. Minted by the browser
     so the chunks of a long list land under one id. */
  batch_id uuid not null,
  /* The customer this went to, when it was one of theirs. Pasted addresses
     have none, and that is not an error — it is how a profile gets sent to
     somebody who is not in the CRM yet. */
  customer_id text,
  email text not null,
  recipient_name text not null default '',
  subject text not null default '',
  /* 'sent' | 'failed'. Nothing is written until the transport has answered,
     so there is no queued state to get stuck in: this table records what
     happened, it does not drive the sending. */
  status text not null default 'sent' check (status in ('sent', 'failed')),
  /* Which transport carried it, for the day somebody asks why a message
     came from the wrong address. */
  via text not null default '',
  error text not null default '',
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists profile_sends_company_idx
  on public.profile_sends (company_id, created_at desc);
create index if not exists profile_sends_batch_idx
  on public.profile_sends (batch_id);
/* "Have we already sent this customer the profile?" — the question the
   screen asks before it offers to send it again. */
create index if not exists profile_sends_customer_idx
  on public.profile_sends (company_id, customer_id);

do $$
begin
  execute 'alter table public.company_profiles enable row level security';
  execute 'alter table public.profile_sends enable row level security';

  /* ANY MEMBER MAY READ THE PROFILE. It is the company's own marketing
     material, written to be given away — the whole point of the feature is
     that a salesperson sends it. They get the bytes as well as the name,
     because a salesperson who wants to attach it to a mail they are writing
     by hand should be able to download it. */
  execute 'drop policy if exists company_profiles_select on public.company_profiles';
  execute 'create policy company_profiles_select on public.company_profiles for select
    to authenticated
    using (public.is_member(company_id))';

  /* REPLACING IT IS AN ADMIN OR MANAGER''S JOB. This is the document that
     represents the company to every customer who asks about it; a wrong
     file here goes out under everybody''s name. */
  execute 'drop policy if exists company_profiles_insert on public.company_profiles';
  execute 'create policy company_profiles_insert on public.company_profiles for insert
    to authenticated
    with check (public.is_privileged_in(company_id))';

  execute 'drop policy if exists company_profiles_update on public.company_profiles';
  execute 'create policy company_profiles_update on public.company_profiles for update
    to authenticated
    using (public.is_privileged_in(company_id))
    with check (public.is_privileged_in(company_id))';

  execute 'drop policy if exists company_profiles_delete on public.company_profiles';
  execute 'create policy company_profiles_delete on public.company_profiles for delete
    to authenticated
    using (public.is_privileged_in(company_id))';

  /* THE LOG IS READ-ONLY FROM A BROWSER. Every member can see who was
     sent the profile — that is what stops two salespeople sending the same
     customer the same PDF in one week. Nobody can write a row: the sending
     function writes them with the service role, and a log a client could
     write around is not a log. There is deliberately no insert, update or
     delete policy, so those commands match nothing however the grants
     below change. */
  execute 'drop policy if exists profile_sends_select on public.profile_sends';
  execute 'create policy profile_sends_select on public.profile_sends for select
    to authenticated
    using (public.is_member(company_id))';
end $$;

grant select, insert, update, delete on table public.company_profiles to authenticated;
/* READ ONLY, and the policies above are the second wall behind it. */
grant select on table public.profile_sends to authenticated;

/* Named, not inherited. Supabase's default privileges handed `anon` a grant
   on both tables the moment they were created, and `revoke from public`
   does not take it back because anon is a real role holding a real grant.
   The profile is public-facing material, but who it was sent to is not. */
revoke all on table public.company_profiles from anon;
revoke all on table public.profile_sends from anon;
