-- Nobody may promote themselves.
--
-- Live in production since the `harden_outbound_tables_against_anon` era and
-- never committed — see docs/SCHEMA-DRIFT.md. Read back out of the live
-- database; `infra/compare-schema.sh` proves the reading was faithful.
--
-- WHY A TRIGGER AND NOT A POLICY. A policy on `profiles` can say who may
-- update a row. It cannot say which COLUMN changed, so a policy permissive
-- enough to let somebody fix their own phone number is permissive enough to
-- let them set their own role to Admin. The check has to see the old value
-- next to the new one, and only a trigger does.

begin;

create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.role is distinct from OLD.role then
    if auth.role() = 'service_role' then
      return NEW;
    end if;
    if not public.is_admin() then
      raise exception 'Only an Admin can change a user''s role';
    end if;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_prevent_self_role_escalation on public.profiles;
create trigger trg_prevent_self_role_escalation before update on public.profiles
  for each row execute function public.prevent_self_role_escalation();

commit;
