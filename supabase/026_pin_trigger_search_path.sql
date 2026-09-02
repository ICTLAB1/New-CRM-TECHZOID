-- 026 — pin the search_path on the portal-link integrity trigger.
--
-- `portal_tokens_pin_identity` is the trigger that refuses to let a portal
-- link be repointed at a different customer: revoke it and issue a new one
-- instead. It is SECURITY INVOKER, so an unpinned search_path is not the
-- privilege-escalation hole it would be on a DEFINER function — but this
-- function's whole job is to be un-bypassable, and a resolvable name inside
-- it is a loose thread on exactly the wrong function. Every other function
-- this CRM owns already pins its path; this one was missed.
--
-- `set_updated_at` is flagged by the same linter and is deliberately NOT
-- touched here: it belongs to the other application sharing this database.
--
-- Body unchanged from 021. Safe to re-run.

create or replace function public.portal_tokens_pin_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.customer_id is distinct from old.customer_id
     or new.token_hash is distinct from old.token_hash
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A portal link cannot be repointed. Revoke it and issue a new one.';
  end if;
  return new;
end; $$;
