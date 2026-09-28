-- The outbound engine: campaigns, prospects, sequences, touches, enquiries
-- and the partner intake.
--
-- WHY THIS MIGRATION EXISTS AT NUMBER 39 FOR WORK THAT HAS BEEN LIVE FOR
-- WEEKS. It was applied to production through the Supabase dashboard and the
-- SQL was never committed. Nobody noticed until the Azure migration compared
-- the two databases and found thirteen tables, nineteen functions and six
-- views in production that no file here creates — see docs/SCHEMA-DRIFT.md.
--
-- So this is not a change. It is the missing description of a change that
-- already happened. Everything in it was read back out of the live database,
-- and `infra/compare-schema.sh` is what proves the reading was faithful.
--
-- THE NUMBER IS BUILD ORDER, NOT HISTORY. This ran in production before
-- 038_crm_objects.sql was written, and 038 has never been applied anywhere.
-- Renumbering to reflect the true sequence would change files that are
-- already applied elsewhere, which is worse than a number that is merely out
-- of order.
--
-- Idempotent throughout, because it has to be re-runnable against a database
-- that already has some of it.

begin;

-- ---------------------------------------------------------------------
-- sequences
-- ---------------------------------------------------------------------

-- Enquiry reference numbers, printed on what customers see: ENQ-2026-1001.
-- Starting at 1001 rather than 1 for the same reason the invoice series
-- does — a first enquiry numbered 0001 tells a customer exactly how much
-- business has come before them.
create sequence if not exists public.enquiry_ref_seq as bigint start with 1001 increment by 1;

-- ---------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------

create table if not exists public.campaigns (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  vendor text not null,
  segment text not null,
  track text not null,
  status text default 'draft'::text not null,
  daily_cap integer default 40 not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.prospects (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  campaign_id uuid,
  track text not null,
  vendor_focus text[] default '{}'::text[] not null,
  company_name text not null,
  domain text,
  country text default 'India'::text not null,
  region text,
  industry text,
  employee_band text,
  contact_name text,
  title text,
  email text,
  phone text,
  linkedin_url text,
  source text default 'manual'::text not null,
  source_ref text,
  stage text default 'new'::text not null,
  score integer default 0 not null,
  next_action_on date,
  last_touch_at timestamp with time zone,
  do_not_contact boolean default false not null,
  -- GENERATED, not defaulted. A default is evaluated once at insert and can
  -- then be updated to anything; a generated column is recomputed on every
  -- write, so the unique index below catches a duplicate however the row
  -- arrived — import, form, by hand, or by an update that changed the email
  -- to one already in the table. An address wins over a company name when
  -- both are present.
  dedupe_key text generated always as (COALESCE(lower(email), ((lower(domain) || '|'::text) || lower(company_name)))) stored,
  data jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.sequence_steps (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  step_no integer not null,
  delay_days integer default 0 not null,
  channel text default 'email'::text not null,
  subject text,
  body_text text,
  body_html text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.touches (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  prospect_id uuid not null,
  campaign_id uuid,
  step_no integer,
  direction text not null,
  channel text default 'email'::text not null,
  to_email text,
  from_email text,
  subject text,
  body text,
  message_id text,
  thread_id text,
  status text default 'queued'::text not null,
  error text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

-- Unsubscribes and bounced domains. Separate from outreach_suppressions,
-- which belongs to the other sending path; both exist and both are used.
create table if not exists public.suppressions (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  value text not null,
  reason text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.enquiries (
  id uuid default gen_random_uuid() not null,
  ref_no text,
  owner_id uuid default auth.uid() not null,
  prospect_id uuid,
  track text default 'customer'::text not null,
  vendor text not null,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  country text default 'India'::text not null,
  customer_type text,
  requirement text,
  products jsonb default '[]'::jsonb not null,
  quantity integer,
  budget_band text,
  timeline text,
  source text default 'outbound_reply'::text not null,
  status text default 'new'::text not null,
  -- Four working hours, set on insert. An enquiry with no deadline is an
  -- enquiry nobody is late on.
  sla_due_at timestamp with time zone default (now() + '04:00:00'::interval) not null,
  quote_id text,
  customer_id text,
  notes text,
  data jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.partner_profiles (
  prospect_id uuid not null,
  legal_entity_name text,
  registration_no text,
  gstin text,
  vat_tax_id text,
  country text,
  existing_authorisations text[] default '{}'::text[] not null,
  vendor_partner_ids jsonb default '{}'::jsonb not null,
  annual_volume_band text,
  target_end_customers text,
  payment_terms_sought text,
  currency text,
  kyc_status text default 'pending'::text not null,
  kyc_docs jsonb default '{}'::jsonb not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- One application per address per day. Keyed on (email, day) so the row
-- expires by being a different row tomorrow, with nothing to clean up.
create table if not exists public.partner_application_throttle (
  email text not null,
  day date default CURRENT_DATE not null,
  hits integer default 1 not null
);

-- Email the CRM owes somebody, queued rather than sent inline: a trigger
-- that sent mail would hold the transaction open on somebody else's SMTP.
create table if not exists public.notification_outbox (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  to_email text not null,
  cc_email text,
  subject text not null,
  body_text text not null,
  body_html text,
  ref_table text,
  ref_id uuid,
  state text default 'queued'::text not null,
  attempts integer default 0 not null,
  error text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

-- ---------------------------------------------------------------------
-- constraints
--
-- Added separately and guarded, because `create table if not exists` does
-- nothing at all on a table that already exists — including adding a
-- constraint it has since grown.
-- ---------------------------------------------------------------------

do $$
declare
  stmt text;
begin
  foreach stmt in array array[
    'alter table public.campaigns add constraint campaigns_pkey primary key (id)',
    'alter table public.campaigns add constraint campaigns_vendor_check check ((vendor = any (array[''autodesk''::text, ''microsoft''::text, ''both''::text])))',
    'alter table public.campaigns add constraint campaigns_segment_check check ((segment = any (array[''india_corporate''::text, ''india_smb''::text, ''india_government''::text, ''india_education''::text, ''india_reseller''::text, ''intl_reseller''::text])))',
    'alter table public.campaigns add constraint campaigns_track_check check ((track = any (array[''customer''::text, ''reseller''::text])))',
    'alter table public.campaigns add constraint campaigns_status_check check ((status = any (array[''draft''::text, ''active''::text, ''paused''::text, ''done''::text])))',

    'alter table public.prospects add constraint prospects_pkey primary key (id)',
    'alter table public.prospects add constraint prospects_campaign_id_fkey foreign key (campaign_id) references public.campaigns(id) on delete set null',
    'alter table public.prospects add constraint prospects_track_check check ((track = any (array[''customer''::text, ''reseller''::text])))',
    'alter table public.prospects add constraint prospects_source_check check ((source = any (array[''lusha''::text, ''manual''::text, ''import''::text, ''referral''::text, ''inbound''::text])))',
    'alter table public.prospects add constraint prospects_stage_check check ((stage = any (array[''new''::text, ''queued''::text, ''contacted''::text, ''opened''::text, ''replied''::text, ''enquiry''::text, ''disqualified''::text, ''unsubscribed''::text])))',

    'alter table public.sequence_steps add constraint sequence_steps_pkey primary key (id)',
    'alter table public.sequence_steps add constraint sequence_steps_campaign_id_fkey foreign key (campaign_id) references public.campaigns(id) on delete cascade',
    'alter table public.sequence_steps add constraint sequence_steps_campaign_id_step_no_key unique (campaign_id, step_no)',
    'alter table public.sequence_steps add constraint sequence_steps_channel_check check ((channel = any (array[''email''::text, ''linkedin''::text, ''call''::text, ''whatsapp''::text])))',

    'alter table public.touches add constraint touches_pkey primary key (id)',
    'alter table public.touches add constraint touches_prospect_id_fkey foreign key (prospect_id) references public.prospects(id) on delete cascade',
    'alter table public.touches add constraint touches_campaign_id_fkey foreign key (campaign_id) references public.campaigns(id) on delete set null',
    'alter table public.touches add constraint touches_direction_check check ((direction = any (array[''out''::text, ''in''::text])))',
    'alter table public.touches add constraint touches_status_check check ((status = any (array[''queued''::text, ''sent''::text, ''failed''::text, ''bounced''::text, ''received''::text])))',

    'alter table public.suppressions add constraint suppressions_pkey primary key (id)',
    'alter table public.suppressions add constraint suppressions_kind_value_key unique (kind, value)',
    'alter table public.suppressions add constraint suppressions_kind_check check ((kind = any (array[''email''::text, ''domain''::text])))',

    'alter table public.enquiries add constraint enquiries_pkey primary key (id)',
    'alter table public.enquiries add constraint enquiries_ref_no_key unique (ref_no)',
    'alter table public.enquiries add constraint enquiries_prospect_id_fkey foreign key (prospect_id) references public.prospects(id) on delete set null',
    'alter table public.enquiries add constraint enquiries_track_check check ((track = any (array[''customer''::text, ''reseller''::text])))',
    'alter table public.enquiries add constraint enquiries_vendor_check check ((vendor = any (array[''autodesk''::text, ''microsoft''::text, ''both''::text, ''other''::text])))',
    'alter table public.enquiries add constraint enquiries_customer_type_check check ((customer_type = any (array[''corporate''::text, ''smb''::text, ''government''::text, ''education''::text, ''reseller''::text, ''individual''::text])))',
    'alter table public.enquiries add constraint enquiries_source_check check ((source = any (array[''outbound_reply''::text, ''inbound_form''::text, ''referral''::text, ''manual''::text, ''marketplace''::text])))',
    'alter table public.enquiries add constraint enquiries_status_check check ((status = any (array[''new''::text, ''qualifying''::text, ''quoted''::text, ''won''::text, ''lost''::text, ''spam''::text])))',

    'alter table public.partner_profiles add constraint partner_profiles_pkey primary key (prospect_id)',
    'alter table public.partner_profiles add constraint partner_profiles_prospect_id_fkey foreign key (prospect_id) references public.prospects(id) on delete cascade',
    'alter table public.partner_profiles add constraint partner_profiles_kyc_status_check check ((kyc_status = any (array[''pending''::text, ''submitted''::text, ''verified''::text, ''rejected''::text])))',

    'alter table public.partner_application_throttle add constraint partner_application_throttle_pkey primary key (email, day)',

    'alter table public.notification_outbox add constraint notification_outbox_pkey primary key (id)',
    'alter table public.notification_outbox add constraint notification_outbox_state_check check ((state = any (array[''queued''::text, ''sent''::text, ''failed''::text])))'
  ]
  loop
    begin
      execute stmt;
    exception
      when duplicate_table or duplicate_object or invalid_table_definition then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------

create index if not exists prospects_campaign_idx on public.prospects using btree (campaign_id);
create index if not exists prospects_stage_idx on public.prospects using btree (stage);
create index if not exists prospects_next_action_idx on public.prospects using btree (next_action_on)
  where (stage = any (array['queued'::text, 'contacted'::text, 'opened'::text]));
-- The duplicate guard. A unique INDEX rather than a constraint because the
-- key is a generated column and the two behave the same to a writer.
create unique index if not exists prospects_dedupe_idx on public.prospects using btree (dedupe_key);

create index if not exists touches_prospect_idx on public.touches using btree (prospect_id, created_at desc);
create index if not exists touches_status_idx on public.touches using btree (status) where (status = 'queued'::text);

create index if not exists enquiries_status_idx on public.enquiries using btree (status, created_at desc);
create index if not exists enquiries_track_idx on public.enquiries using btree (track);

create index if not exists notification_outbox_state_idx on public.notification_outbox using btree (state, created_at);

-- ---------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end $function$;

-- Placeholders in a sequence step, filled from the prospect and the sender.
-- Takes the whole prospect row rather than a dozen arguments so a new
-- placeholder needs one edit here and none at the call sites.
create or replace function public.render_merge(tpl text, p public.prospects, sender_name text, sender_designation text)
returns text
language sql
immutable
as $function$
  select replace(replace(replace(replace(replace(replace(
           coalesce(tpl,''),
           '{{first_name}}',  coalesce(split_part(p.contact_name,' ',1), 'there')),
           '{{company}}',     coalesce(p.company_name,'your company')),
           '{{country}}',     coalesce(p.country,'your market')),
           '{{industry}}',    coalesce(lower(p.industry),'your')),
           '{{sender_name}}', coalesce(sender_name,'TechZoid Sales')),
           '{{sender_designation}}', coalesce(sender_designation,'Sales'))
$function$;

-- Checked on the way IN, not on the way out. A suppressed address that
-- reaches the prospects table is one a later import can quietly re-enable.
create or replace function public.enforce_suppression()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.email is not null and exists (
     select 1 from public.suppressions
      where (kind='email'  and value = lower(new.email))
         or (kind='domain' and value = lower(split_part(new.email,'@',2)))
  ) then
    new.do_not_contact := true;
    new.stage := 'unsubscribed';
  end if;
  return new;
end $function$;

create or replace function public.suppress_contact(p_email text, p_reason text default 'unsubscribe'::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.suppressions (kind, value, reason)
  values ('email', lower(p_email), p_reason) on conflict do nothing;
  update public.prospects
     set do_not_contact = true, stage = 'unsubscribed'
   where lower(email) = lower(p_email);
end $function$;

-- A reply moves the prospect forward; a send moves it along. Neither drags
-- one back out of a terminal stage, which is why the CASE exists.
create or replace function public.on_touch_received()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.direction = 'in' then
    update public.prospects
       set stage = case when stage in ('enquiry','disqualified','unsubscribed') then stage else 'replied' end,
           last_touch_at = now()
     where id = new.prospect_id;
  elsif new.status = 'sent' then
    update public.prospects
       set stage = case when stage in ('new','queued') then 'contacted' else stage end,
           last_touch_at = coalesce(new.sent_at, now())
     where id = new.prospect_id;
  end if;
  return new;
end $function$;

create or replace function public.on_enquiry_created()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  owner_email text;
  alert_to    text;
begin
  if new.ref_no is null then
    new.ref_no := 'ENQ-' || to_char(now(),'YYYY') || '-' || nextval('public.enquiry_ref_seq');
  end if;
  select email into owner_email from public.profiles where id = new.owner_id;
  alert_to := coalesce(owner_email, 'abhinav.jain@techzoidtechnologies.com');

  insert into public.notification_outbox (kind, to_email, cc_email, subject, body_text, ref_table, ref_id)
  values (
    'new_enquiry',
    alert_to,
    'abhinav.jain@techzoidtechnologies.com',
    '[' || upper(new.track) || '] New ' || initcap(new.vendor) || ' enquiry - ' || new.company_name
      || ' (' || new.country || ')',
    'Ref: ' || new.ref_no || E'\n'
      || 'Company: ' || new.company_name || E'\n'
      || 'Contact: ' || coalesce(new.contact_name,'-') || ' | ' || coalesce(new.email,'-') || ' | ' || coalesce(new.phone,'-') || E'\n'
      || 'Track: ' || new.track || ' | Type: ' || coalesce(new.customer_type,'-') || E'\n'
      || 'Vendor: ' || new.vendor || ' | Country: ' || new.country || E'\n'
      || 'Requirement: ' || coalesce(new.requirement,'-') || E'\n'
      || 'Qty: ' || coalesce(new.quantity::text,'-') || ' | Budget: ' || coalesce(new.budget_band,'-')
      || ' | Timeline: ' || coalesce(new.timeline,'-') || E'\n'
      || 'Source: ' || new.source || E'\n'
      || 'Respond by: ' || to_char(new.sla_due_at at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI') || ' IST',
    'enquiries', new.id
  );
  return new;
end $function$;

-- Records an inbound reply, and optionally turns it into an enquiry. One
-- call rather than three, so a reply cannot be logged without the prospect
-- moving with it.
create or replace function public.log_reply(p_prospect_id uuid, p_subject text, p_body text, p_make_enquiry boolean default false, p_requirement text default null::text, p_vendor text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare pr record; t_id uuid; e_id uuid; e_ref text;
begin
  select * into pr from public.prospects where id = p_prospect_id;
  if not found then raise exception 'prospect not found'; end if;

  insert into public.touches (owner_id, prospect_id, campaign_id, direction, channel,
                              from_email, to_email, subject, body, status, sent_at)
  values (pr.owner_id, pr.id, pr.campaign_id, 'in', 'email',
          pr.email, (select email from public.profiles where id = pr.owner_id),
          p_subject, p_body, 'received', now())
  returning id into t_id;

  if p_make_enquiry then
    insert into public.enquiries (owner_id, prospect_id, track, vendor, company_name, contact_name,
                                  email, country, customer_type, requirement, source)
    values (pr.owner_id, pr.id, pr.track,
            coalesce(p_vendor, case when array_length(pr.vendor_focus,1) = 1
                                    then pr.vendor_focus[1] else 'both' end),
            pr.company_name, pr.contact_name, pr.email, pr.country,
            case when pr.track='reseller' then 'reseller' else 'corporate' end,
            coalesce(p_requirement, p_body), 'outbound_reply')
    returning id, ref_no into e_id, e_ref;
    update public.prospects set stage = 'enquiry' where id = pr.id;
  end if;

  return jsonb_build_object('touch_id', t_id, 'enquiry_id', e_id, 'enquiry_ref', e_ref);
end $function$;

create or replace function public.import_prospects(p_campaign_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r jsonb; owners uuid[]; i int := 0; inserted int := 0; skipped int := 0; c record;
begin
  select * into c from public.campaigns where id = p_campaign_id;
  if not found then raise exception 'campaign not found'; end if;

  select array_agg(id order by name) into owners
    from public.profiles where role in ('Sales','Admin');

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      insert into public.prospects
        (owner_id, campaign_id, track, vendor_focus, company_name, domain, country, region,
         industry, contact_name, title, email, phone, linkedin_url, source, source_ref,
         stage, next_action_on, data)
      values (
        owners[(i % array_length(owners,1)) + 1],
        p_campaign_id,
        c.track,
        coalesce((select array_agg(x) from jsonb_array_elements_text(r->'vendor_focus') x),
                 case c.vendor when 'both' then array['autodesk','microsoft'] else array[c.vendor] end),
        r->>'company_name',
        nullif(lower(r->>'domain'),''),
        coalesce(nullif(r->>'country',''),'India'),
        r->>'region', r->>'industry', r->>'contact_name', r->>'title',
        nullif(lower(r->>'email'),''), r->>'phone', r->>'linkedin_url',
        coalesce(nullif(r->>'source',''),'import'), r->>'source_ref',
        'new', current_date,
        coalesce(r->'data','{}'::jsonb)
      );
      inserted := inserted + 1;
    exception when unique_violation then
      skipped := skipped + 1;
    end;
    i := i + 1;
  end loop;

  return jsonb_build_object('inserted', inserted, 'skipped_duplicates', skipped);
end $function$;

create or replace function public.submit_partner_application(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email      text := lower(nullif(trim(payload->>'email'), ''));
  v_company    text := nullif(trim(payload->>'company_name'), '');
  v_contact    text := nullif(trim(payload->>'contact_name'), '');
  v_country    text := coalesce(nullif(trim(payload->>'country'), ''), 'India');
  v_vendors    text[];
  v_owner      uuid;
  v_prospect   uuid;
  v_enquiry    uuid;
  v_ref        text;
  v_campaign   uuid;
  v_hits       integer;
  v_domestic   boolean;
  v_vendor     text;
begin
  if v_company is null or v_contact is null or v_email is null then
    return jsonb_build_object('ok', false, 'error', 'Company, contact name and email are required.');
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'That email address does not look valid.');
  end if;
  if length(v_company) > 200 or length(v_contact) > 120 or length(v_email) > 200 then
    return jsonb_build_object('ok', false, 'error', 'One of the fields is too long.');
  end if;

  insert into public.partner_application_throttle (email) values (v_email)
  on conflict (email, day) do update set hits = partner_application_throttle.hits + 1
  returning hits into v_hits;
  if v_hits > 1 then
    return jsonb_build_object('ok', false,
      'error', 'We have already received an application from this address today — our partner team will be in touch shortly.');
  end if;

  if exists (select 1 from public.suppressions
             where (kind='email'  and value = v_email)
                or (kind='domain' and value = split_part(v_email,'@',2))) then
    return jsonb_build_object('ok', true, 'ref', null);
  end if;

  v_domestic := lower(v_country) in ('india','in','bharat');
  select id into v_campaign from public.campaigns
   where segment = case when v_domestic then 'india_reseller' else 'intl_reseller' end
   order by created_at limit 1;

  select id into v_owner from public.profiles
   where role = 'Sales'
   order by (select count(*) from public.prospects p
              where p.owner_id = profiles.id and p.track = 'reseller'), name
   limit 1;
  if v_owner is null then
    select id into v_owner from public.profiles where role = 'Admin' order by name limit 1;
  end if;

  v_vendors := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(payload->'vendors') x
      where x in ('autodesk','microsoft')),
    array['autodesk','microsoft']);
  v_vendor := case when array_length(v_vendors,1) = 1 then v_vendors[1] else 'both' end;

  insert into public.prospects
    (owner_id, campaign_id, track, vendor_focus, company_name, domain, country, region,
     contact_name, title, email, phone, linkedin_url, source, stage, next_action_on, data)
  values
    (v_owner, v_campaign, 'reseller', v_vendors, v_company,
     nullif(lower(payload->>'website'),''), v_country, nullif(payload->>'city',''),
     v_contact, nullif(payload->>'title',''), v_email, nullif(payload->>'phone',''),
     nullif(payload->>'linkedin_url',''), 'inbound', 'enquiry', current_date,
     jsonb_build_object('form', 'partner_registration'))
  on conflict (dedupe_key) do update
     set contact_name = excluded.contact_name,
         phone        = coalesce(excluded.phone, prospects.phone),
         stage        = 'enquiry',
         updated_at   = now()
  returning id, owner_id into v_prospect, v_owner;

  insert into public.partner_profiles
    (prospect_id, legal_entity_name, registration_no, gstin, vat_tax_id, country,
     existing_authorisations, annual_volume_band, target_end_customers,
     payment_terms_sought, currency, notes)
  values
    (v_prospect,
     coalesce(nullif(payload->>'legal_entity_name',''), v_company),
     nullif(payload->>'registration_no',''), nullif(payload->>'gstin',''),
     nullif(payload->>'vat_tax_id',''), v_country,
     coalesce((select array_agg(x) from jsonb_array_elements_text(payload->'authorisations') x),
              '{}'::text[]),
     nullif(payload->>'annual_volume_band',''), nullif(payload->>'target_end_customers',''),
     nullif(payload->>'payment_terms_sought',''), nullif(payload->>'currency',''),
     left(coalesce(payload->>'notes',''), 4000))
  on conflict (prospect_id) do update
     set registration_no        = coalesce(excluded.registration_no, partner_profiles.registration_no),
         gstin                  = coalesce(excluded.gstin, partner_profiles.gstin),
         vat_tax_id             = coalesce(excluded.vat_tax_id, partner_profiles.vat_tax_id),
         existing_authorisations= excluded.existing_authorisations,
         annual_volume_band     = coalesce(excluded.annual_volume_band, partner_profiles.annual_volume_band),
         target_end_customers   = coalesce(excluded.target_end_customers, partner_profiles.target_end_customers),
         payment_terms_sought   = coalesce(excluded.payment_terms_sought, partner_profiles.payment_terms_sought),
         currency               = coalesce(excluded.currency, partner_profiles.currency),
         notes                  = coalesce(excluded.notes, partner_profiles.notes),
         updated_at             = now();

  -- one open enquiry per prospect: update rather than stack a duplicate on the queue
  select id, ref_no into v_enquiry, v_ref
    from public.enquiries
   where prospect_id = v_prospect and status in ('new','qualifying')
   order by created_at limit 1;

  if v_enquiry is not null then
    update public.enquiries
       set vendor      = v_vendor,
           company_name= v_company,
           contact_name= v_contact,
           phone       = coalesce(nullif(payload->>'phone',''), phone),
           requirement = coalesce(nullif(payload->>'requirement',''), requirement),
           timeline    = coalesce(nullif(payload->>'timeline',''), timeline),
           notes       = concat_ws(E'\n', notes,
                          'Resubmitted via partner form ' || to_char(now(),'DD Mon YYYY HH24:MI')),
           updated_at  = now()
     where id = v_enquiry;
  else
    insert into public.enquiries
      (owner_id, prospect_id, track, vendor, company_name, contact_name, email, phone,
       country, customer_type, requirement, timeline, source, data)
    values
      (v_owner, v_prospect, 'reseller', v_vendor, v_company, v_contact, v_email,
       nullif(payload->>'phone',''), v_country, 'reseller',
       coalesce(nullif(payload->>'requirement',''), 'Partner registration - reseller supply'),
       nullif(payload->>'timeline',''), 'inbound_form',
       jsonb_build_object('annual_volume_band', payload->>'annual_volume_band',
                          'authorisations',     payload->'authorisations',
                          'currency',           payload->>'currency'))
    returning id, ref_no into v_enquiry, v_ref;
  end if;

  return jsonb_build_object('ok', true, 'ref', v_ref);
end $function$;

-- ---------------------------------------------------------------------
-- views
-- ---------------------------------------------------------------------

-- What is due to go out right now: the campaign active, the step's delay
-- elapsed, the prospect neither suppressed nor already past this step. The
-- sender reads this rather than working it out itself, so "why did this not
-- send" is one query anybody can run.
create or replace view public.v_send_queue as
 WITH sent AS (
         SELECT touches.prospect_id,
            count(*) FILTER (WHERE touches.direction = 'out'::text AND touches.status = 'sent'::text) AS sent_count,
            max(touches.sent_at) FILTER (WHERE touches.direction = 'out'::text AND touches.status = 'sent'::text) AS last_sent_at
           FROM touches
          GROUP BY touches.prospect_id
        )
 SELECT p.id AS prospect_id,
    p.owner_id,
    pr.name AS owner_name,
    pr.email AS owner_email,
    c.id AS campaign_id,
    c.name AS campaign,
    c.daily_cap,
    p.track,
    p.company_name,
    p.contact_name,
    p.title,
    p.email,
    p.country,
    p.stage,
    COALESCE(s.sent_count, 0::bigint) + 1 AS next_step_no,
    ss.delay_days,
    COALESCE(s.last_sent_at, p.created_at) AS last_sent_at,
    render_merge(ss.subject, p.*, pr.name, pr.designation) AS subject,
    render_merge(ss.body_text, p.*, pr.name, pr.designation) AS body_text
   FROM prospects p
     JOIN campaigns c ON c.id = p.campaign_id AND c.status = 'active'::text
     JOIN profiles pr ON pr.id = p.owner_id
     LEFT JOIN sent s ON s.prospect_id = p.id
     JOIN sequence_steps ss ON ss.campaign_id = c.id AND ss.step_no = (COALESCE(s.sent_count, 0::bigint) + 1)
  WHERE p.do_not_contact = false AND p.email IS NOT NULL AND (p.stage = ANY (ARRAY['new'::text, 'queued'::text, 'contacted'::text, 'opened'::text])) AND (COALESCE(s.last_sent_at, p.created_at) + ((ss.delay_days || ' days'::text)::interval)) <= now();

create or replace function public.queue_next_touch(p_prospect_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; new_id uuid;
begin
  select * into r from public.v_send_queue where prospect_id = p_prospect_id;
  if not found then return null; end if;

  insert into public.touches (owner_id, prospect_id, campaign_id, step_no, direction, channel,
                              to_email, from_email, subject, body, status)
  values (r.owner_id, r.prospect_id, r.campaign_id, r.next_step_no, 'out', 'email',
          r.email, r.owner_email, r.subject, r.body_text, 'queued')
  returning id into new_id;

  update public.prospects set stage = case when stage='new' then 'queued' else stage end
   where id = p_prospect_id;
  return new_id;
end $function$;

create or replace view public.v_outbound_funnel as
 SELECT c.name AS campaign,
    c.track,
    c.status,
    count(*) AS prospects,
    count(*) FILTER (WHERE p.stage = 'contacted'::text) AS contacted,
    count(*) FILTER (WHERE p.stage = 'replied'::text) AS replied,
    count(*) FILTER (WHERE p.stage = 'enquiry'::text) AS enquiries,
    count(*) FILTER (WHERE p.stage = 'unsubscribed'::text) AS opted_out
   FROM campaigns c
     LEFT JOIN prospects p ON p.campaign_id = c.id
  GROUP BY c.name, c.track, c.status;

-- ---------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------

drop trigger if exists trg_campaigns_updated on public.campaigns;
create trigger trg_campaigns_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

drop trigger if exists trg_prospects_updated on public.prospects;
create trigger trg_prospects_updated before update on public.prospects
  for each row execute function public.set_updated_at();

drop trigger if exists trg_prospect_suppression on public.prospects;
create trigger trg_prospect_suppression before insert or update of email on public.prospects
  for each row execute function public.enforce_suppression();

drop trigger if exists trg_sequence_steps_updated on public.sequence_steps;
create trigger trg_sequence_steps_updated before update on public.sequence_steps
  for each row execute function public.set_updated_at();

drop trigger if exists trg_touch_received on public.touches;
create trigger trg_touch_received after insert or update of status on public.touches
  for each row execute function public.on_touch_received();

drop trigger if exists trg_enquiries_updated on public.enquiries;
create trigger trg_enquiries_updated before update on public.enquiries
  for each row execute function public.set_updated_at();

drop trigger if exists trg_enquiry_created on public.enquiries;
create trigger trg_enquiry_created before insert on public.enquiries
  for each row execute function public.on_enquiry_created();

drop trigger if exists trg_partner_profiles_updated on public.partner_profiles;
create trigger trg_partner_profiles_updated before update on public.partner_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- row-level security
--
-- The two throttle tables get RLS ENABLED AND NO POLICIES, which is not an
-- oversight: nothing may read or write them except the SECURITY DEFINER
-- functions above, and a table with RLS on and no policy denies everyone
-- else by default. That is the intended access, stated the only way
-- Postgres states it.
-- ---------------------------------------------------------------------

alter table public.campaigns                    enable row level security;
alter table public.prospects                    enable row level security;
alter table public.sequence_steps               enable row level security;
alter table public.touches                      enable row level security;
alter table public.suppressions                 enable row level security;
alter table public.enquiries                    enable row level security;
alter table public.partner_profiles             enable row level security;
alter table public.partner_application_throttle enable row level security;
alter table public.notification_outbox          enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select * from (values
      ('campaigns','campaigns_select','select','((owner_id = auth.uid()) OR is_privileged())',null),
      ('campaigns','campaigns_insert','insert',null,'((owner_id = auth.uid()) OR is_privileged())'),
      ('campaigns','campaigns_update','update','((owner_id = auth.uid()) OR is_privileged())','((owner_id = auth.uid()) OR is_privileged())'),
      ('campaigns','campaigns_delete','delete','((owner_id = auth.uid()) OR is_privileged())',null),

      ('prospects','prospects_select','select','((owner_id = auth.uid()) OR is_privileged())',null),
      ('prospects','prospects_insert','insert',null,'((owner_id = auth.uid()) OR is_privileged())'),
      ('prospects','prospects_update','update','((owner_id = auth.uid()) OR is_privileged())','((owner_id = auth.uid()) OR is_privileged())'),
      ('prospects','prospects_delete','delete','((owner_id = auth.uid()) OR is_privileged())',null),

      ('touches','touches_select','select','((owner_id = auth.uid()) OR is_privileged())',null),
      ('touches','touches_insert','insert',null,'((owner_id = auth.uid()) OR is_privileged())'),
      ('touches','touches_update','update','((owner_id = auth.uid()) OR is_privileged())','((owner_id = auth.uid()) OR is_privileged())'),
      ('touches','touches_delete','delete','((owner_id = auth.uid()) OR is_privileged())',null),

      ('enquiries','enquiries_select','select','((owner_id = auth.uid()) OR is_privileged())',null),
      ('enquiries','enquiries_insert','insert',null,'((owner_id = auth.uid()) OR is_privileged())'),
      ('enquiries','enquiries_update','update','((owner_id = auth.uid()) OR is_privileged())','((owner_id = auth.uid()) OR is_privileged())'),
      ('enquiries','enquiries_delete','delete','((owner_id = auth.uid()) OR is_privileged())',null),

      ('sequence_steps','sequence_steps_all','all','true','true'),
      ('suppressions','suppressions_all','all','true','true'),
      ('partner_profiles','partner_profiles_all','all','true','true'),
      ('notification_outbox','notification_outbox_all','all','true','true')
    ) as t(tbl, name, cmd, using_expr, check_expr)
  loop
    execute format('drop policy if exists %I on public.%I', pol.name, pol.tbl);
    execute format('create policy %I on public.%I for %s to authenticated %s %s',
      pol.name, pol.tbl, pol.cmd,
      case when pol.using_expr is null then '' else 'using (' || pol.using_expr || ')' end,
      case when pol.check_expr is null then '' else 'with check (' || pol.check_expr || ')' end);
  end loop;
end $$;

commit;
