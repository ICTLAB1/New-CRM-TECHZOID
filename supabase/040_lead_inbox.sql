-- The lead inbox: leads, their assignment, their SLA clock, and the four
-- views the pipeline screens read.
--
-- Like 039, this describes work that has been live for weeks and was never
-- committed — applied through the Supabase dashboard as `lead_inbox_schema`,
-- `lead_inbox_logic`, `website_enquiry_rpc` and `lead_inbox_hardening`. See
-- docs/SCHEMA-DRIFT.md. It was read back out of the live database and
-- `infra/compare-schema.sh` is what proves the reading was faithful.
--
-- Depends on 036's `default_company_id()` and on `is_member` /
-- `is_privileged_in` from the multi-company migration, which is why it sits
-- here rather than earlier.

begin;

-- ---------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------

-- Per-company working hours and the SLA clock. One row per company, created
-- on demand by capture_lead so a company that never opened the settings
-- screen still gets a deadline.
create table if not exists public.lead_config (
  company_id uuid not null,
  sla_minutes integer default 120 not null,
  day_start time without time zone default '10:00:00'::time without time zone not null,
  day_end time without time zone default '19:00:00'::time without time zone not null,
  -- ISO day numbers. Six days by default: Saturday is a working day here.
  workdays integer[] default '{1,2,3,4,5,6}'::integer[] not null,
  timezone text default 'Asia/Kolkata'::text not null,
  assign_roles text[] default '{Sales,Admin}'::text[] not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.leads (
  id uuid default gen_random_uuid() not null,
  company_id uuid default public.default_company_id() not null,
  source text default 'manual'::text not null,
  source_ref text,
  status text default 'new'::text not null,
  stage_reason text,
  company_name text,
  contact_name text,
  email text,
  phone text,
  city text,
  state text,
  country text default 'India'::text,
  customer_id text,
  product_interest text[],
  seats integer,
  est_value numeric(14,2),
  currency text default 'INR'::text,
  score integer default 0 not null,
  notes text,
  data jsonb default '{}'::jsonb not null,
  owner_id uuid,
  assigned_at timestamp with time zone,
  sla_due_at timestamp with time zone,
  -- The moment somebody actually made contact. Nullable on purpose: it is
  -- what the SLA is measured against, and a default would stop the clock
  -- before anybody had done anything.
  first_contact_at timestamp with time zone,
  escalated_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- An append-only trail: created, assigned, contacted, status changed, SLA
-- breached, duplicate suppressed. Never updated, so "who did what when" on a
-- lead survives any later edit to the lead itself.
create sequence if not exists public.lead_events_id_seq as bigint start with 1 increment by 1;

create table if not exists public.lead_events (
  id bigint default nextval('public.lead_events_id_seq'::regclass) not null,
  lead_id uuid not null,
  company_id uuid not null,
  kind text not null,
  actor_id uuid,
  detail jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

alter sequence public.lead_events_id_seq owned by public.lead_events.id;

-- Three website submissions per address per day. Keyed on (email, day) in
-- the workspace's own timezone, so "today" means today in Delhi and the row
-- expires by being a different row tomorrow.
create table if not exists public.lead_submission_throttle (
  email text not null,
  day date default ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date not null,
  hits integer default 1 not null
);

-- ---------------------------------------------------------------------
-- constraints
-- ---------------------------------------------------------------------

do $$
declare
  stmt text;
begin
  foreach stmt in array array[
    'alter table public.lead_config add constraint lead_config_pkey primary key (company_id)',
    'alter table public.lead_config add constraint lead_config_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade',

    'alter table public.leads add constraint leads_pkey primary key (id)',
    'alter table public.leads add constraint leads_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade',
    'alter table public.leads add constraint leads_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete set null',
    'alter table public.leads add constraint leads_customer_id_fkey foreign key (customer_id) references public.customers(id) on delete set null',
    'alter table public.leads add constraint leads_source_chk check ((source = any (array[''renewal''::text, ''inbound''::text, ''outbound''::text, ''signal''::text, ''tender''::text, ''referral''::text, ''partner''::text, ''manual''::text, ''import''::text])))',
    'alter table public.leads add constraint leads_status_chk check ((status = any (array[''new''::text, ''assigned''::text, ''contacted''::text, ''qualified''::text, ''quoted''::text, ''won''::text, ''lost''::text, ''disqualified''::text])))',

    'alter table public.lead_events add constraint lead_events_pkey primary key (id)',
    'alter table public.lead_events add constraint lead_events_lead_id_fkey foreign key (lead_id) references public.leads(id) on delete cascade',

    'alter table public.lead_submission_throttle add constraint lead_submission_throttle_pkey primary key (email, day)'
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

create index if not exists leads_company_status_idx on public.leads using btree (company_id, status);
create index if not exists leads_source_idx on public.leads using btree (company_id, source, created_at desc);
create index if not exists leads_email_idx on public.leads using btree (company_id, lower(email));
-- Partial: the escalation sweep only ever looks at leads nobody has
-- contacted and nobody has closed, and that is a small slice of the table.
create index if not exists leads_sla_idx on public.leads using btree (sla_due_at)
  where ((first_contact_at is null) and (closed_at is null));
create index if not exists leads_owner_idx on public.leads using btree (owner_id) where (closed_at is null);

create index if not exists lead_events_lead_idx on public.lead_events using btree (lead_id, created_at desc);
create index if not exists lead_events_co_idx on public.lead_events using btree (company_id, kind, created_at desc);

-- ---------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------

create or replace function public.touch_lead_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end $function$;

-- Add working minutes to a timestamp, skipping non-working days and the
-- hours outside the working day. This is why an enquiry at 18:55 on a
-- Saturday is not due at 20:55 on a Saturday.
--
-- The guard counter is not decoration: a `workdays` array with no valid day
-- in it would otherwise loop for ever, and a configuration screen can
-- produce one.
create or replace function public.add_working_minutes(p_from timestamp with time zone, p_mins integer, p_start time without time zone default '10:00:00'::time without time zone, p_end time without time zone default '19:00:00'::time without time zone, p_workdays integer[] default '{1,2,3,4,5,6}'::integer[], p_tz text default 'Asia/Kolkata'::text)
returns timestamp with time zone
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  cur timestamptz := p_from; remaining integer := greatest(p_mins, 0);
  d date; ws timestamptz; we timestamptz; avail integer; guard integer := 0;
begin
  loop
    guard := guard + 1;
    if guard > 400 then return cur; end if;
    d  := (cur at time zone p_tz)::date;
    ws := (d + p_start) at time zone p_tz;
    we := (d + p_end)   at time zone p_tz;
    if not (extract(isodow from d)::int = any(p_workdays)) then
      cur := ((d + 1) + p_start) at time zone p_tz; continue;
    end if;
    if cur < ws then cur := ws; end if;
    if cur >= we then cur := ((d + 1) + p_start) at time zone p_tz; continue; end if;
    avail := floor(extract(epoch from (we - cur)) / 60)::int;
    if avail >= remaining then return cur + make_interval(mins => remaining); end if;
    remaining := remaining - avail;
    cur := ((d + 1) + p_start) at time zone p_tz;
  end loop;
end $function$;

-- Round-robin by open workload, not by turn. Whoever is carrying the fewest
-- open leads gets the next one; ties go to whoever has waited longest.
create or replace function public.pick_lead_owner(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  with pool as (
    select pr.id
    from public.company_members cm
    join public.profiles pr on pr.id = cm.user_id
    left join public.lead_config lc on lc.company_id = cm.company_id
    where cm.company_id = p_company_id
      and pr.role = any (coalesce(lc.assign_roles, '{Sales,Admin}'::text[]))
  )
  select pool.id
  from pool
  left join public.leads l
    on l.owner_id = pool.id and l.company_id = p_company_id and l.closed_at is null
  group by pool.id
  order by count(l.id) asc,
           coalesce(max(l.assigned_at), 'epoch'::timestamptz) asc,
           pool.id
  limit 1;
$function$;

-- The one way a lead gets created. Deduplicates, assigns, sets the clock and
-- writes the event, so none of those can be skipped by a caller that forgot.
--
-- The same address enquiring twice in a month is treated as the same
-- enquiry: recorded against the open lead rather than filed as a second
-- one, so two salespeople do not ring the same person about the same thing.
-- And no owner means no clock — a deadline nobody is responsible for is a
-- number on a screen.
--
-- The comments that explain the tricky lines live HERE, outside the body,
-- and not inside it. A comment inside the body becomes part of the stored
-- function text, so it makes this file stop matching production byte for
-- byte — which is exactly what infra/compare-schema.sh is for.
create or replace function public.capture_lead(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_cfg     public.lead_config%rowtype;
  v_email   text := nullif(lower(trim(p->>'email')), '');
  v_existing uuid;
  v_owner   uuid;
  v_id      uuid;
  v_due     timestamptz;
  v_products text[];
begin
  v_company := coalesce(nullif(p->>'company_id','')::uuid, public.default_company_id());
  if v_company is null then
    select id into v_company from public.companies order by created_at limit 1;
  end if;

  select * into v_cfg from public.lead_config where company_id = v_company;
  if not found then
    insert into public.lead_config (company_id) values (v_company)
    on conflict (company_id) do nothing;
    select * into v_cfg from public.lead_config where company_id = v_company;
  end if;

  if v_email is not null then
    select id into v_existing
    from public.leads
    where company_id = v_company
      and lower(email) = v_email
      and closed_at is null
      and created_at > now() - interval '30 days'
    order by created_at desc
    limit 1;

    if v_existing is not null then
      insert into public.lead_events (lead_id, company_id, kind, detail)
      values (v_existing, v_company, 'duplicate_suppressed',
              jsonb_build_object('source', p->>'source', 'source_ref', p->>'source_ref'));
      return v_existing;
    end if;
  end if;

  if jsonb_typeof(p->'product_interest') = 'array' then
    v_products := array(select jsonb_array_elements_text(p->'product_interest'));
  elsif nullif(p->>'product_interest','') is not null then
    v_products := array[p->>'product_interest'];
  end if;

  v_owner := public.pick_lead_owner(v_company);
  v_due := case when v_owner is null then null
                else public.add_working_minutes(now(), v_cfg.sla_minutes,
                       v_cfg.day_start, v_cfg.day_end, v_cfg.workdays, v_cfg.timezone) end;

  insert into public.leads (
    company_id, source, source_ref, company_name, contact_name, email, phone,
    city, state, country, customer_id, product_interest, seats, est_value,
    score, notes, data, owner_id, assigned_at, sla_due_at, status
  ) values (
    v_company,
    coalesce(nullif(p->>'source',''), 'manual'),
    nullif(p->>'source_ref',''),
    nullif(p->>'company_name',''),
    nullif(p->>'contact_name',''),
    v_email,
    nullif(p->>'phone',''),
    nullif(p->>'city',''),
    nullif(p->>'state',''),
    coalesce(nullif(p->>'country',''), 'India'),
    nullif(p->>'customer_id',''),
    v_products,
    nullif(p->>'seats','')::integer,
    nullif(p->>'est_value','')::numeric,
    coalesce(nullif(p->>'score','')::integer, 0),
    nullif(p->>'notes',''),
    case when jsonb_typeof(p->'data') = 'object' then p->'data' else '{}'::jsonb end,
    v_owner,
    case when v_owner is null then null else now() end,
    v_due,
    case when v_owner is null then 'new' else 'assigned' end
  ) returning id into v_id;

  insert into public.lead_events (lead_id, company_id, kind, detail)
  values (v_id, v_company, 'created',
          jsonb_build_object('source', p->>'source', 'owner_id', v_owner, 'sla_due_at', v_due));

  return v_id;
end $function$;

create or replace function public.mark_lead_contacted(p_lead_id uuid, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_co uuid; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select company_id, owner_id into v_co, v_owner from public.leads where id = p_lead_id;
  if v_co is null then raise exception 'lead not found'; end if;
  if not (is_member(v_co) and (v_owner = auth.uid() or v_owner is null or is_privileged_in(v_co)))
    then raise exception 'not permitted on this lead'; end if;

  update public.leads
     set first_contact_at = coalesce(first_contact_at, now()),
         status = case when status in ('new','assigned') then 'contacted' else status end
   where id = p_lead_id;

  insert into public.lead_events (lead_id, company_id, kind, actor_id, detail)
  values (p_lead_id, v_co, 'contacted', auth.uid(), jsonb_build_object('note', p_note));
end $function$;

create or replace function public.set_lead_status(p_lead_id uuid, p_status text, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_co uuid; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_status not in ('new','assigned','contacted','qualified','quoted','won','lost','disqualified')
    then raise exception 'invalid status %', p_status; end if;

  select company_id, owner_id into v_co, v_owner from public.leads where id = p_lead_id;
  if v_co is null then raise exception 'lead not found'; end if;
  if not (is_member(v_co) and (v_owner = auth.uid() or v_owner is null or is_privileged_in(v_co)))
    then raise exception 'not permitted on this lead'; end if;

  update public.leads
     set status = p_status,
         stage_reason = p_reason,
         closed_at = case when p_status in ('won','lost','disqualified') then now() else null end
   where id = p_lead_id;

  insert into public.lead_events (lead_id, company_id, kind, actor_id, detail)
  values (p_lead_id, v_co, 'status_changed', auth.uid(),
          jsonb_build_object('status', p_status, 'reason', p_reason));
end $function$;

-- Run on a schedule. Stamps escalated_at ONCE per lead — the `escalated_at
-- is null` guard is what stops a lead that stays overdue generating an
-- event every time the sweep runs.
create or replace function public.escalate_overdue_leads()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  with overdue as (
    update public.leads
       set escalated_at = now()
     where first_contact_at is null
       and closed_at is null
       and escalated_at is null
       and sla_due_at is not null
       and sla_due_at < now()
     returning id, company_id, owner_id, sla_due_at
  )
  insert into public.lead_events (lead_id, company_id, kind, detail)
  select id, company_id, 'sla_breached',
         jsonb_build_object('owner_id', owner_id, 'sla_due_at', sla_due_at)
  from overdue;

  get diagnostics v_n = row_count;
  return v_n;
end $function$;

-- The public website form. Unauthenticated by design, which is why the
-- honeypot and the throttle are both here rather than in the caller.
create or replace function public.submit_website_enquiry(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := nullif(lower(trim(p->>'email')), '');
  v_hits  integer;
  v_id    uuid;
begin
  -- honeypot: bots fill hidden fields, humans don't
  if coalesce(trim(p->>'website'), '') <> '' then
    return jsonb_build_object('ok', true);
  end if;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'error', 'A valid email address is required.');
  end if;

  if coalesce(trim(p->>'contact_name'), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Please tell us your name.');
  end if;

  insert into public.lead_submission_throttle (email, hits)
  values (v_email, 1)
  on conflict (email, day) do update set hits = public.lead_submission_throttle.hits + 1
  returning hits into v_hits;

  if v_hits > 3 then
    return jsonb_build_object('ok', false,
      'error', 'We already have your enquiry today — our team will be in touch shortly.');
  end if;

  v_id := public.capture_lead(jsonb_build_object(
    'source',           'inbound',
    'source_ref',       nullif(p->>'page', ''),
    'company_name',     nullif(p->>'company_name', ''),
    'contact_name',     trim(p->>'contact_name'),
    'email',            v_email,
    'phone',            nullif(p->>'phone', ''),
    'city',             nullif(p->>'city', ''),
    'state',            nullif(p->>'state', ''),
    'country',          coalesce(nullif(p->>'country', ''), 'India'),
    'product_interest', p->'product_interest',
    'seats',            nullif(p->>'seats', ''),
    'notes',            left(coalesce(p->>'message', ''), 4000),
    'score',            30,
    'data',             jsonb_build_object(
                          'page',      nullif(p->>'page', ''),
                          'sku',       nullif(p->>'sku', ''),
                          'referrer',  nullif(p->>'referrer', ''),
                          'utm',       p->'utm')
  ));

  return jsonb_build_object('ok', true, 'lead_id', v_id);
end $function$;

-- ---------------------------------------------------------------------
-- views
-- ---------------------------------------------------------------------

-- What is open, who has it, and how long they have left. `sla_state` is
-- computed here rather than on each screen so two screens cannot disagree
-- about whether the same lead is late.
create or replace view public.v_lead_inbox as
 SELECT l.id,
    l.company_id,
    l.source,
    l.status,
    l.company_name,
    l.contact_name,
    l.email,
    l.phone,
    l.city,
    l.state,
    l.product_interest,
    l.seats,
    l.est_value,
    l.score,
    l.notes,
    l.owner_id,
    pr.name AS owner_name,
    l.created_at,
    l.assigned_at,
    l.sla_due_at,
    l.first_contact_at,
    l.escalated_at,
        CASE
            WHEN l.first_contact_at IS NOT NULL THEN 'done'::text
            WHEN l.sla_due_at IS NULL THEN 'unassigned'::text
            WHEN l.sla_due_at < now() THEN 'breached'::text
            WHEN l.sla_due_at < (now() + '00:30:00'::interval) THEN 'due_soon'::text
            ELSE 'on_track'::text
        END AS sla_state,
    floor(EXTRACT(epoch FROM l.sla_due_at - now()) / 60::numeric)::integer AS minutes_left
   FROM leads l
     LEFT JOIN profiles pr ON pr.id = l.owner_id
  WHERE l.closed_at IS NULL;

create or replace view public.v_lead_sla_breaches as
 SELECT id, company_id, source, status, company_name, contact_name, email, phone,
    city, state, product_interest, seats, est_value, score, notes, owner_id,
    owner_name, created_at, assigned_at, sla_due_at, first_contact_at,
    escalated_at, sla_state, minutes_left
   FROM v_lead_inbox
  WHERE sla_state = 'breached'::text;

create or replace view public.v_lead_funnel as
 SELECT company_id,
    source,
    status,
    count(*) AS leads,
    sum(est_value) AS pipeline_value,
    min(created_at) AS first_seen,
    max(created_at) AS last_seen
   FROM leads
  GROUP BY company_id, source, status;

create or replace view public.v_lead_scoreboard as
 SELECT l.company_id,
    date_trunc('week'::text, l.created_at) AS week,
    l.owner_id,
    pr.name AS owner_name,
    count(*) AS assigned,
    count(*) FILTER (WHERE l.first_contact_at IS NOT NULL) AS contacted,
    count(*) FILTER (WHERE l.first_contact_at IS NOT NULL AND l.first_contact_at <= l.sla_due_at) AS within_sla,
    count(*) FILTER (WHERE l.status = ANY (ARRAY['quoted'::text, 'won'::text])) AS quoted,
    count(*) FILTER (WHERE l.status = 'won'::text) AS won,
    sum(l.est_value) FILTER (WHERE l.status = 'won'::text) AS won_value
   FROM leads l
     LEFT JOIN profiles pr ON pr.id = l.owner_id
  GROUP BY l.company_id, (date_trunc('week'::text, l.created_at)), l.owner_id, pr.name;

-- ---------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------

drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at before update on public.leads
  for each row execute function public.touch_lead_updated_at();

-- ---------------------------------------------------------------------
-- row-level security
--
-- `lead_submission_throttle` gets RLS with NO POLICIES on purpose: only
-- submit_website_enquiry, which is SECURITY DEFINER, may touch it, and a
-- table with RLS on and no policy denies everyone else.
-- ---------------------------------------------------------------------

alter table public.lead_config               enable row level security;
alter table public.leads                     enable row level security;
alter table public.lead_events               enable row level security;
alter table public.lead_submission_throttle  enable row level security;

drop policy if exists lead_config_select on public.lead_config;
create policy lead_config_select on public.lead_config for select to authenticated
  using (is_member(company_id));

drop policy if exists lead_config_update on public.lead_config;
create policy lead_config_update on public.lead_config for update to authenticated
  using ((is_member(company_id) and is_privileged_in(company_id)));

-- An UNOWNED lead is visible to every member: a lead nobody has been given
-- has to be visible to somebody, or it sits in the inbox unseen.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using ((is_member(company_id) and ((owner_id = auth.uid()) or (owner_id is null) or is_privileged_in(company_id))));

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated
  with check (is_member(company_id));

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using ((is_member(company_id) and ((owner_id = auth.uid()) or (owner_id is null) or is_privileged_in(company_id))));

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using ((is_member(company_id) and is_privileged_in(company_id)));

-- Select only. The trail is written by the SECURITY DEFINER functions and
-- by nobody else, which is what makes it a trail.
drop policy if exists lead_events_select on public.lead_events;
create policy lead_events_select on public.lead_events for select to authenticated
  using (is_member(company_id));

commit;
