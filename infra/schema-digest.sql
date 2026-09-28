-- A stable fingerprint of everything in `public`, for comparing two databases.
--
-- WHY THIS EXISTS. The plan was to build the Azure database by replaying the
-- migrations in supabase/ and then copy the rows in. Running this against
-- production and against a database built that way shows why that would not
-- have worked: production carries 13 tables, 19 functions, 6 views, 2
-- sequences and a dozen triggers that no file in this repository creates.
-- They were applied through the Supabase dashboard and the SQL was never
-- committed. A restore into the replayed schema would have failed on the
-- first row of `prospects` — or, worse, succeeded for everything else and
-- left the failure looking like a single bad table.
--
-- The lesson is not "be careful". It is that a migration you cannot VERIFY
-- is a migration you are guessing at. So: run this on both databases, diff
-- the output, and only cut over when it is empty.
--
--   infra/compare-schema.sh          (does all of this)
--
-- or by hand:
--
--   psql "$SOURCE_URL" -At -f infra/schema-digest.sql > /tmp/source.txt
--   psql "$TARGET_URL" -At -f infra/schema-digest.sql > /tmp/target.txt
--   diff -u /tmp/source.txt /tmp/target.txt && echo "identical"
--
-- Every line is `kind|name|fingerprint`, sorted, so a plain diff names
-- exactly what differs. The fingerprints are of definitions, not data —
-- nothing here reads a customer record.

-- Pure SQL, no psql directives: the formatting flags belong on the command
-- line (-At), so this also runs from any other client.

with everything as (

  -- Tables and their columns: name, type, nullability, default. Ordered by
  -- position, because a column added in the middle on one side and at the
  -- end on the other is a real difference that a sorted list would hide.
  select 'table' as kind, c.relname as name,
         md5(string_agg(
           a.attname||' '||format_type(a.atttypid, a.atttypmod)
           ||coalesce(' default '||pg_get_expr(ad.adbin, ad.adrelid), '')
           ||case when a.attnotnull then ' not null' else '' end,
           E'\n' order by a.attnum)) as fingerprint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
   where n.nspname = 'public' and c.relkind in ('r','p')
   group by c.relname

  union all

  -- Views, by their compiled definition rather than their source text, so
  -- whitespace and comments do not show up as differences.
  select 'view', c.relname, md5(pg_get_viewdef(c.oid, true))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v','m')

  union all

  -- Constraints: primary keys, foreign keys, uniques and checks.
  select 'constraint', c.relname||'.'||con.conname, md5(pg_get_constraintdef(con.oid))
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'

  union all

  select 'index', c.relname||'.'||i.relname, md5(pg_get_indexdef(i.oid))
    from pg_index x
    join pg_class c on c.oid = x.indrelid
    join pg_class i on i.oid = x.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'

  union all

  -- Functions, including the body. A function whose body changed is a
  -- function that behaves differently, and that matters more here than
  -- almost anything else: eight of them ARE the document numbering.
  select 'function', p.proname||'/'||p.pronargs, md5(pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f','p')

  union all

  select 'trigger', c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid))
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal

  union all

  -- Policies. These are the access control: 89 of them, and a missing one
  -- does not error, it shows somebody another company's records.
  select 'policy', c.relname||'.'||pol.polname,
         md5(case pol.polcmd when 'r' then 'select' when 'a' then 'insert'
                             when 'w' then 'update' when 'd' then 'delete' else 'all' end
             ||'|'||coalesce((select string_agg(r.rolname, ',' order by r.rolname)
                                from pg_roles r where r.oid = any(pol.polroles)), 'public')
             ||'|'||coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
             ||'|'||coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'

  union all

  -- Whether RLS is on at all. A table with policies but RLS disabled reads
  -- as fully open and looks, in every listing, exactly like one that is not.
  select 'rls', c.relname, md5(c.relrowsecurity::text||'|'||c.relforcerowsecurity::text)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')

  union all

  select 'sequence', c.relname, md5(c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
)
select kind||'|'||name||'|'||fingerprint
  from everything
 order by kind, name;
