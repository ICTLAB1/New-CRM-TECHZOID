-- Function bodies with comments and whitespace normalised away.
--
-- WHY A SECOND DIGEST. The strict one in schema-digest.sql hashes the exact
-- stored text, which is right — but it reports as different two functions
-- that do the same thing and are written the same way, differing only in a
-- comment or a line break. Running it against production found fifteen such
-- functions and exactly ONE real difference, and there was no way to tell
-- them apart without looking at all fifteen by hand.
--
-- Two causes, both harmless and both common:
--   · CRLF. Eight functions were pasted into the Supabase dashboard from a
--     Windows editor and carry \r inside their bodies.
--   · Comments. A migration in this repository explains a tricky line in a
--     /* */ block; the copy applied to production had it stripped.
--
-- So: when the strict digest says a function differs, this one says whether
-- the CODE differs. Only the second is worth anybody's afternoon.
--
--   psql "$URL" -At -f infra/schema-digest-code.sql

select p.proname || '/' || p.pronargs || '|' ||
       md5(regexp_replace(
             regexp_replace(
               regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
               '--[^' || chr(10) || ']*', '', 'g'),
             '\s+', ' ', 'g'))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind in ('f','p')
   -- Extension functions are excluded: Supabase keeps pgcrypto in its own
   -- `extensions` schema and the Azure bootstrap puts it in `public`. Same
   -- functions, different address, and not a migration's business.
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
 order by 1;
