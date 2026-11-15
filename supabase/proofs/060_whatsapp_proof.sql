/*
 * THE TESTS 060 EXISTS TO PASS.
 *
 * Three promises are made to the customer and to the business, and all
 * three are kept by the database rather than by a caller remembering:
 *
 *   1. NOBODY RECEIVES THE SAME MESSAGE TWICE for the same event on the
 *      same day, however many jobs, retries or people fire it.
 *   2. NO BROWSER CAN WRITE TO THE MESSAGE LOG. Every row is written by
 *      the server. A log a client can write is not a log.
 *   3. WHAT A CUSTOMER SAID ON WHATSAPP IS NOT PUBLIC, and is not
 *      readable by another company.
 *
 * Not "the screen does not offer it". api/lib/query.mjs lets a browser
 * compose its own query over any table — it picks the table, the columns,
 * the filters and the order — so row-level security and the grants are the
 * only things standing in the way. This file asks by every route a browser
 * has, under each role the API tier can stamp on a request, and RAISES on
 * anything that should not have worked. A pass is silence.
 *
 *   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/proofs/060_whatsapp_proof.sql
 *
 * Run it on a throwaway copy of the schema, never on the live database: it
 * writes a fixture and it runs the migration.
 */
\set ON_ERROR_STOP on

\ir ../060_whatsapp.sql

/* ── the fixture ────────────────────────────────────────────────────── */

set request.jwt.claim.role = 'service_role';

insert into auth.users(id, email, raw_user_meta_data) values
  ('d0000000-0000-0000-0000-000000000001', 'wa-admin@t', '{"name":"Admin"}'::jsonb),
  ('d0000000-0000-0000-0000-000000000002', 'wa-sales@t', '{"name":"Sales"}'::jsonb),
  ('d0000000-0000-0000-0000-000000000003', 'wa-rival@t', '{"name":"Rival"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles(id, name, email, role) values
  ('d0000000-0000-0000-0000-000000000001', 'Admin', 'wa-admin@t', 'Admin'),
  ('d0000000-0000-0000-0000-000000000002', 'Sales', 'wa-sales@t', 'Sales'),
  ('d0000000-0000-0000-0000-000000000003', 'Rival', 'wa-rival@t', 'Admin')
on conflict (id) do update set role = excluded.role;

insert into public.companies(id, name) values
  ('c0a00000-0000-0000-0000-00000000000a', 'WhatsApp Test Co'),
  ('c0a00000-0000-0000-0000-00000000000b', 'Rival Reseller Ltd')
on conflict (id) do nothing;

insert into public.company_members(company_id, user_id, role) values
  ('c0a00000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'Admin'),
  ('c0a00000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'Sales'),
  ('c0a00000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000003', 'Admin')
on conflict (company_id, user_id) do update set role = excluded.role;

/* Three customers, with their numbers written the three ways people
   actually write them. */
insert into public.customers(id, owner_id, company_id, data) values
  ('wa-cust-1', 'd0000000-0000-0000-0000-000000000002', 'c0a00000-0000-0000-0000-00000000000a',
   '{"company":"Sharma Architects LLP","phone":"+91 98100 12345","whatsappOptIn":true}'::jsonb),
  ('wa-cust-2', 'd0000000-0000-0000-0000-000000000002', 'c0a00000-0000-0000-0000-00000000000a',
   '{"company":"Acme Industries","phone":"011-4455 6677","whatsappPhone":"098765-43210","whatsappOptIn":true}'::jsonb),
  ('wa-cust-3', 'd0000000-0000-0000-0000-000000000003', 'c0a00000-0000-0000-0000-00000000000b',
   '{"company":"Rival Customer","phone":"9810012345"}'::jsonb)
on conflict (id) do update set data = excluded.data, company_id = excluded.company_id;

/* ── 1. the same message twice ──────────────────────────────────────── */

insert into public.whatsapp_messages
  (company_id, direction, customer_id, phone, template, record_type, record_id, status, body)
values
  ('c0a00000-0000-0000-0000-00000000000a', 'out', 'wa-cust-1', '919810012345',
   'quotation_sent', 'quote', 'q-1', 'sent', 'first');

do $$
begin
  begin
    insert into public.whatsapp_messages
      (company_id, direction, customer_id, phone, template, record_type, record_id, status, body)
    values
      ('c0a00000-0000-0000-0000-00000000000a', 'out', 'wa-cust-1', '919810012345',
       'quotation_sent', 'quote', 'q-1', 'queued', 'second');
    raise exception 'BROKEN: the same quotation message went to the same number twice on one day';
  exception when unique_violation then
    null;
  end;
end $$;

/* A DIFFERENT TEMPLATE about the same quotation is a different message —
   "we have sent your quotation" and "any thoughts on it?" are not the
   same thing, and both may legitimately go out. */
insert into public.whatsapp_messages
  (company_id, direction, customer_id, phone, template, record_type, record_id, status)
values
  ('c0a00000-0000-0000-0000-00000000000a', 'out', 'wa-cust-1', '919810012345',
   'quotation_followup', 'quote', 'q-1', 'sent');

/* A DIFFERENT CUSTOMER'S NUMBER is a different message. */
insert into public.whatsapp_messages
  (company_id, direction, customer_id, phone, template, record_type, record_id, status)
values
  ('c0a00000-0000-0000-0000-00000000000a', 'out', 'wa-cust-2', '919876543210',
   'quotation_sent', 'quote', 'q-1', 'sent');

/* A FAILED ATTEMPT MUST NOT BLOCK A REAL ONE. The index ignores failures
   on purpose: a message Meta refused is a message the customer never got,
   and somebody fixing the number must be able to send it. */
insert into public.whatsapp_messages
  (company_id, direction, customer_id, phone, template, record_type, record_id, status, error)
values
  ('c0a00000-0000-0000-0000-00000000000a', 'out', 'wa-cust-1', '910000000000',
   'order_delivered', 'order', 'o-1', 'failed', 'wrong number');
insert into public.whatsapp_messages
  (company_id, direction, customer_id, phone, template, record_type, record_id, status, error)
values
  ('c0a00000-0000-0000-0000-00000000000a', 'out', 'wa-cust-1', '910000000000',
   'order_delivered', 'order', 'o-1', 'failed', 'wrong number again');
insert into public.whatsapp_messages
  (company_id, direction, customer_id, phone, template, record_type, record_id, status)
values
  ('c0a00000-0000-0000-0000-00000000000a', 'out', 'wa-cust-1', '910000000000',
   'order_delivered', 'order', 'o-1', 'sent');

/* AND NOW IT IS BLOCKED, because it arrived. */
do $$
begin
  begin
    insert into public.whatsapp_messages
      (company_id, direction, customer_id, phone, template, record_type, record_id, status)
    values
      ('c0a00000-0000-0000-0000-00000000000a', 'out', 'wa-cust-1', '910000000000',
       'order_delivered', 'order', 'o-1', 'queued');
    raise exception 'BROKEN: a delivered-order message went twice once one had succeeded';
  exception when unique_violation then
    null;
  end;
end $$;

/* INBOUND IS NEVER BLOCKED. A customer may send ten messages in a minute
   and every one of them must be kept. */
insert into public.whatsapp_messages (company_id, direction, customer_id, phone, status, body) values
  ('c0a00000-0000-0000-0000-00000000000a', 'in', 'wa-cust-1', '919810012345', 'received', 'yes please'),
  ('c0a00000-0000-0000-0000-00000000000a', 'in', 'wa-cust-1', '919810012345', 'received', 'how soon?'),
  ('c0a00000-0000-0000-0000-00000000000a', 'in', null, '919000000001', 'received', 'who is this');

/* META'S OWN ID IS UNIQUE, so a webhook delivered twice updates one row
   rather than making a second. */
update public.whatsapp_messages set wa_message_id = 'wamid.AAA'
 where body = 'first';
do $$
begin
  begin
    update public.whatsapp_messages set wa_message_id = 'wamid.AAA' where body = 'yes please';
    raise exception 'BROKEN: two rows can hold the same Meta message id';
  exception when unique_violation then
    null;
  end;
end $$;

/* The rival's own conversation, so cross-company reads can be tested. */
insert into public.whatsapp_messages
  (company_id, direction, customer_id, phone, template, record_type, record_id, status, body)
values
  ('c0a00000-0000-0000-0000-00000000000b', 'out', 'wa-cust-3', '919810012345',
   'quotation_sent', 'quote', 'rq-1', 'sent', 'rival secret');

/* ── 2. what each role can do, by every route a browser has ─────────── */

create or replace function pg_temp.act_as(p_user text) returns void
language plpgsql as $$
begin
  execute format('set local role authenticated');
  execute format('set local request.jwt.claim.sub = %L', p_user);
  execute format('set local request.jwt.claim.role = %L', 'authenticated');
end $$;

/* ── a member of the company ── */
do $$
declare n integer;
begin
  perform pg_temp.act_as('d0000000-0000-0000-0000-000000000002');   -- Sales

  /* READS the company's own conversations: this is the point of the log. */
  select count(*) into n from public.whatsapp_messages;
  if n = 0 then
    raise exception 'BROKEN: a member of the company cannot read its own WhatsApp log';
  end if;

  /* AND SEES NOTHING OF ANOTHER COMPANY'S. */
  select count(*) into n from public.whatsapp_messages where body = 'rival secret';
  if n <> 0 then
    raise exception 'BROKEN: a salesperson can read another company''s WhatsApp messages';
  end if;

  /* CANNOT WRITE. Not an insert, not an update, not a delete — there is no
     policy for any of them, so each matches nothing. An insert raises; an
     update and a delete silently affect no rows, which is why the count is
     checked rather than the absence of an error. */
  begin
    insert into public.whatsapp_messages (company_id, direction, phone, status, body)
    values ('c0a00000-0000-0000-0000-00000000000a', 'out', '919810012345', 'sent', 'forged');
    raise exception 'BROKEN: a browser can write rows into the WhatsApp log';
  exception when insufficient_privilege then
    null;
  end;

  update public.whatsapp_messages set body = 'tampered' where body = 'first';
  if found then
    raise exception 'BROKEN: a browser can rewrite what a customer was sent';
  end if;

  delete from public.whatsapp_messages where body = 'yes please';
  if found then
    raise exception 'BROKEN: a browser can delete a customer''s reply';
  end if;

  /* CANNOT ASK WHOSE NUMBER THIS IS. The webhook's lookup reads customers
     across the whole company; a browser must not be able to call it. */
  begin
    perform public.whatsapp_customer_for('c0a00000-0000-0000-0000-00000000000a', '919810012345');
    raise exception 'BROKEN: a browser can run the number-matching function';
  exception when insufficient_privilege then
    null;
  end;
end $$;

/* ── somebody at another company ── */
do $$
declare n integer;
begin
  perform pg_temp.act_as('d0000000-0000-0000-0000-000000000003');   -- Rival Admin

  select count(*) into n from public.whatsapp_messages
   where company_id = 'c0a00000-0000-0000-0000-00000000000a';
  if n <> 0 then
    raise exception 'BROKEN: another company''s Admin can read this company''s WhatsApp log';
  end if;

  /* Being an Admin somewhere is not being a member here. */
  select count(*) into n from public.whatsapp_messages where body = 'how soon?';
  if n <> 0 then
    raise exception 'BROKEN: an outsider can read a customer''s reply';
  end if;
end $$;

/* ── a signed-out visitor ── */
do $$
declare n integer;
begin
  set local role anon;
  begin
    select count(*) into n from public.whatsapp_messages;
    raise exception 'BROKEN: anon can read the WhatsApp log at all (count was %)', n;
  exception when insufficient_privilege then
    null;
  end;
end $$;

/* ── 3. matching an incoming number to a customer ───────────────────── */
reset role;
set request.jwt.claim.role = 'service_role';

do $$
declare got text;
begin
  /* "+91 98100 12345" on the record, "919810012345" from Meta. */
  got := public.whatsapp_customer_for('c0a00000-0000-0000-0000-00000000000a', '919810012345');
  if got is distinct from 'wa-cust-1' then
    raise exception 'BROKEN: a reply from a known customer was not matched (got %)', got;
  end if;

  /* The WhatsApp number, written with a leading zero and a hyphen. */
  got := public.whatsapp_customer_for('c0a00000-0000-0000-0000-00000000000a', '919876543210');
  if got is distinct from 'wa-cust-2' then
    raise exception 'BROKEN: the WhatsApp number on the record was not matched (got %)', got;
  end if;

  /* A NUMBER NOBODY HAS ON FILE matches nobody, rather than the nearest
     thing — a new enquiry must arrive as a new enquiry. */
  got := public.whatsapp_customer_for('c0a00000-0000-0000-0000-00000000000a', '919000000001');
  if got is not null then
    raise exception 'BROKEN: an unknown number was matched to % ', got;
  end if;

  /* ANOTHER COMPANY'S CUSTOMER IS NOT MATCHED, even though the digits are
     identical — this is the one that would put a reply in the wrong
     company's Inbox. */
  got := public.whatsapp_customer_for('c0a00000-0000-0000-0000-00000000000a', '9810012345');
  if got is distinct from 'wa-cust-1' then
    raise exception 'BROKEN: a ten-digit number was not matched within the company (got %)', got;
  end if;
  got := public.whatsapp_customer_for('c0a00000-0000-0000-0000-00000000000b', '919876543210');
  if got is not null then
    raise exception 'BROKEN: a customer was matched across companies (got %)', got;
  end if;

  /* TOO SHORT TO IDENTIFY ANYBODY matches nobody. Five digits would
     otherwise match every number ending in them. */
  got := public.whatsapp_customer_for('c0a00000-0000-0000-0000-00000000000a', '12345');
  if got is not null then
    raise exception 'BROKEN: a five-digit number matched % ', got;
  end if;
  got := public.whatsapp_customer_for('c0a00000-0000-0000-0000-00000000000a', '');
  if got is not null then
    raise exception 'BROKEN: an empty number matched % ', got;
  end if;
end $$;

/* ── the service role, which is how the server writes ───────────────── */
do $$
declare n integer;
begin
  insert into public.whatsapp_messages
    (company_id, direction, customer_id, phone, template, record_type, record_id, status)
  values
    ('c0a00000-0000-0000-0000-00000000000a', 'out', 'wa-cust-1', '919810012345',
     'renewal_reminder', 'subscription', 's-1', 'sent');

  update public.whatsapp_messages set status = 'delivered' where wa_message_id = 'wamid.AAA';
  select count(*) into n from public.whatsapp_messages where status = 'delivered';
  if n <> 1 then
    raise exception 'BROKEN: the server cannot move a message on to delivered';
  end if;
end $$;

/* ── teardown ───────────────────────────────────────────────────────── */
alter table public.company_members disable trigger company_members_keep_one_admin;
delete from public.whatsapp_messages
 where company_id in ('c0a00000-0000-0000-0000-00000000000a', 'c0a00000-0000-0000-0000-00000000000b');
delete from public.customers where id like 'wa-cust-%';
delete from public.companies
 where id in ('c0a00000-0000-0000-0000-00000000000a', 'c0a00000-0000-0000-0000-00000000000b');
delete from public.profiles where email like 'wa-%@t';
delete from auth.users where email like 'wa-%@t';
alter table public.company_members enable trigger company_members_keep_one_admin;

select 'PROOF 060 PASSED — nobody is messaged twice, no browser writes the log, and no company reads another''s' as result;
