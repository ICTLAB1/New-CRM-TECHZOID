-- A company must always have at least one Admin.
--
-- WHY THE DATABASE AND NOT A CHECK IN THE SCREEN. Losing the last Admin of a
-- company is not an inconvenience, it is a dead end. Adding a member —
-- including adding an Admin back — requires being privileged IN THAT
-- COMPANY, so once the last one is gone or demoted there is nobody left who
-- may put one there. The company still holds its customers, its quotations
-- and its invoices; they simply become unreachable through the CRM, and only
-- somebody with the service key and a SQL prompt can undo it. A rule whose
-- violation cannot be fixed from inside the application belongs in the
-- database, not in a button's disabled state.
--
-- The screen checks too, so somebody is told before they try rather than
-- after. This is what makes the answer true.

create or replace function public.keep_one_admin()
returns trigger language plpgsql set search_path = public as $$
declare
  company uuid;
  admins_left integer;
begin
  company := coalesce(old.company_id, new.company_id);

  /* Only removals and demotions can take the last one away. An insert, or a
     change that leaves an Admin an Admin, cannot. */
  if tg_op = 'UPDATE' and old.role = 'Admin' and new.role = 'Admin' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.role <> 'Admin' then
    return new;
  end if;
  if tg_op = 'DELETE' and old.role <> 'Admin' then
    return old;
  end if;

  select count(*) into admins_left
    from public.company_members m
   where m.company_id = company
     and m.role = 'Admin'
     and not (m.user_id = old.user_id);

  if admins_left = 0 then
    raise exception
      'That is the only admin of this company. Make somebody else an admin first.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists company_members_keep_one_admin on public.company_members;
create trigger company_members_keep_one_admin
  before update or delete on public.company_members
  for each row execute function public.keep_one_admin();
