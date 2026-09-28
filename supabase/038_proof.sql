\set ON_ERROR_STOP on
-- A second company, and a user who belongs only to it.
insert into auth.users(id,email,raw_user_meta_data) values
  ('22222222-2222-2222-2222-222222222222','b@x','{"name":"B"}'::jsonb) on conflict do nothing;
insert into public.profiles(id,name,email,role) values
  ('22222222-2222-2222-2222-222222222222','B','b@x','Admin') on conflict (id) do update set role='Admin';
insert into public.companies(id,name) values ('99999999-9999-9999-9999-999999999999','Rival Co') on conflict do nothing;
insert into public.company_members(company_id,user_id,role)
  values ('99999999-9999-9999-9999-999999999999','22222222-2222-2222-2222-222222222222','Admin') on conflict do nothing;
insert into public.deals(id,owner_id,company_id,customer_id,stage,value,currency)
  values ('deal_rival','22222222-2222-2222-2222-222222222222','99999999-9999-9999-9999-999999999999','x','lead',999999,'INR')
  on conflict (id) do nothing;

grant select,insert,update,delete on public.deals, public.contacts, public.tasks, public.activities, public.automation_rules to authenticated;
grant select on public.audit_log, public.automation_runs to authenticated;

-- USER A: member of company 1 only.
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
  set local "request.jwt.claim.role" = 'authenticated';
  select 'A sees ' || count(*) || ' deals (want 4, its own)' from public.deals;
  select 'A sees rival deals: ' || count(*) || ' (want 0)' from public.deals where company_id='99999999-9999-9999-9999-999999999999';
commit;

-- USER B: member of company 2 only.
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
  set local "request.jwt.claim.role" = 'authenticated';
  select 'B sees ' || count(*) || ' deals (want 1, its own)' from public.deals;
  select 'B sees company 1 contacts: ' || count(*) || ' (want 0)' from public.contacts;
commit;

-- B must not be able to WRITE into company 1 either.
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
  set local "request.jwt.claim.role" = 'authenticated';
  do $$ begin
    insert into public.deals(id,owner_id,company_id,customer_id,stage)
      values ('deal_intrusion','22222222-2222-2222-2222-222222222222',
              (select id from public.companies where name <> 'Rival Co' limit 1),'c1','lead');
    raise exception 'INTRUSION ALLOWED — RLS IS BROKEN';
  exception when insufficient_privilege or check_violation then
    raise notice 'cross-company insert refused, correctly';
  end $$;
rollback;

-- The audit trail must not be writable by a signed-in user.
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
  set local "request.jwt.claim.role" = 'authenticated';
  do $$ begin
    insert into public.audit_log(company_id,subject_type,subject_id,field)
      values ((select id from public.companies limit 1),'deal','deal_c1','stage');
    raise exception 'AUDIT LOG IS WRITABLE — IT IS NOT AN AUDIT LOG';
  exception when insufficient_privilege then
    raise notice 'audit log refused a client write, correctly';
  end $$;
rollback;

-- Anon must see nothing at all.
begin;
  set local role anon;
  set local "request.jwt.claim.role" = 'anon';
  do $$ declare n int; begin
    select count(*) into n from public.deals;
    raise exception 'ANON READ % DEALS', n;
  exception when insufficient_privilege then
    raise notice 'anon refused, correctly';
  end $$;
rollback;

-- One primary contact per account, enforced not hoped for.
do $$ begin
  insert into public.contacts(id,owner_id,company_id,customer_id,name,is_primary)
    values ('contact_dupe','11111111-1111-1111-1111-111111111111',
            (select company_id from public.contacts where id='contact_c1'),'c1','Second Primary',true);
  raise exception 'TWO PRIMARY CONTACTS ALLOWED';
exception when unique_violation then
  raise notice 'second primary contact refused, correctly';
end $$;
