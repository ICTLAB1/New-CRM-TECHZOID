-- Add Amit K and Umesh Kumar Gupta as CRM users (Microsoft sign-in).
-- Idempotent: running it twice changes nothing the second time.
begin;
set local request.jwt.claim.role = 'service_role';

-- 1. A local identity row each. The on_auth_user_created trigger creates
--    the matching profile (as Sales). Their Entra id is filled in by
--    link_entra_identity on first sign-in, matching on email.
insert into auth.users (email, raw_user_meta_data)
select v.email, jsonb_build_object('name', v.name)
from (values ('amit.k@techzoidtechnologies.com', 'Amit K'),
             ('umesh.g@techzoidtechnologies.com', 'Umesh Kumar Gupta')) v(email, name)
where not exists (select 1 from public.profiles p where lower(p.email) = v.email);

-- 2. Roles: Umesh is Senior Sales Manager -> Manager; Amit -> Sales.
update public.profiles set role = 'Manager', designation = coalesce(nullif(designation, ''), 'Senior Sales Manager')
 where lower(email) = 'umesh.g@techzoidtechnologies.com';
update public.profiles set role = 'Sales'
 where lower(email) = 'amit.k@techzoidtechnologies.com';

-- 3. Same companies as the existing sales team (taken from Chandan Singh),
--    so they see the same company's records rather than an empty CRM.
insert into public.company_members (company_id, user_id, role)
select cm.company_id, p.id, p.role
from public.company_members cm
join public.profiles ref on ref.id = cm.user_id and lower(ref.email) = 'chandan.s@techzoidtechnologies.com'
cross join public.profiles p
where lower(p.email) in ('amit.k@techzoidtechnologies.com', 'umesh.g@techzoidtechnologies.com')
on conflict (company_id, user_id) do nothing;

-- 4. Show the result.
select p.name, p.email, p.role, count(cm.company_id) as companies
from public.profiles p left join public.company_members cm on cm.user_id = p.id
where lower(p.email) in ('amit.k@techzoidtechnologies.com', 'umesh.g@techzoidtechnologies.com')
group by 1, 2, 3 order by 1;

commit;
