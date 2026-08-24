-- Each person's own job title, for the signature on email they send.
--
-- SCHEMA CHANGE: adds one column to public.profiles. Nothing else is
-- touched, no policy changes, and no data is deleted. Safe to re-run.
--
-- Distinct from settings.signatoryDesignation, which is NOT the same thing
-- and stays where it is: that one names whoever signs quotations on behalf
-- of the company, and prints in the "For {company} / Authorised signatory"
-- block on the document itself. It is a property of the company. This is a
-- property of a person — what goes under their name when THEY email a
-- customer — so one shared value put the same job title under everybody's
-- signature.
--
-- No policy is needed: profiles_update_self_or_admin already lets a person
-- edit their own row and an Admin edit anyone's, and that policy's `with
-- check` clause continues to be what stops anyone changing their own role.

alter table public.profiles add column if not exists designation text not null default '';
