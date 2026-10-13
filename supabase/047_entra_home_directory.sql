-- Sign-in moves to the company's own Microsoft 365 directory.
--
-- Until now staff signed in as GUESTS of the ttpldelhi directory, and each
-- profile was linked to that guest account's object id. In their own
-- directory the same people have different object ids, so every link is
-- cleared here and made again, by email, on each person's next sign-in
-- (link_entra_identity, 042). Nothing else on any profile changes: the
-- internal id that owns every customer, quotation and order stays the same.
--
-- Safe because the server stops trusting the old directory before this
-- runs (deploy workflow), so an old sign-in cannot take a link back.
begin;
update public.profiles set entra_oid = null where entra_oid is not null;
commit;
