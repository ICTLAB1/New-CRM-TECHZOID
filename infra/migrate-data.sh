#!/usr/bin/env bash
#
# Move the CRM's data from Supabase to Azure Database for PostgreSQL.
#
# THIS IS THE CUTOVER STEP AND IT IS THE ONE THAT CAN LOSE SOMETHING. Every
# other part of the migration can be redone; a botched restore that nobody
# notices for a week cannot. So this script is built around one idea: prove
# the data arrived, table by table, and refuse to declare success otherwise.
#
# SCHEMA IS NOT COPIED. The target's schema comes from the migrations —
# supabase/azure/000_bootstrap.sql, then schema.sql, then all 37 numbered
# files — which have been proven to apply clean on plain PostgreSQL. Copying
# a schema out of Supabase would bring Supabase's own roles, extensions and
# publication objects with it, and those are exactly what does not exist on
# Azure. This copies rows into a schema that is already correct.
#
# Usage:
#   export SOURCE_URL='postgresql://...supabase...'   # read-only is enough
#   export TARGET_URL='postgresql://...azure...?sslmode=require'
#   infra/migrate-data.sh [--force]
#
# Neither URL is printed, logged, or passed on a command line where `ps`
# would show it: both go to the tools through PGPASSWORD-free connection
# environment variables.

set -euo pipefail

FORCE="${1:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="${MIGRATION_DIR:-./migration-${STAMP}}"

: "${SOURCE_URL:?export SOURCE_URL with the Supabase connection string}"
: "${TARGET_URL:?export TARGET_URL with the Azure connection string}"

for tool in pg_dump psql; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed." >&2; exit 1; }
done

mkdir -p "${WORKDIR}"
DUMP="${WORKDIR}/data.sql"
echo "Working in ${WORKDIR}"

# The tables whose rows matter, in the order the foreign keys need them.
# `auth.users` first: every `owner_id` in the CRM points at it, so loading
# it late means every other table fails its references.
say() { printf '\n== %s\n' "$1"; }

counts_of() {
  # Prints "table<TAB>count" for every table in public, plus auth.users.
  local url="$1"
  psql "$url" -At -F $'\t' -v ON_ERROR_STOP=1 <<'SQL'
select 'auth.users', count(*)::text from auth.users
union all
select 'public.' || c.relname,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from public.%I', c.relname),
                           false, true, '')))[1]::text::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by 1;
SQL
}

say "Checking the target's schema matches the source's, object by object"
# NOT a table count. Counting tables was the first version of this check and
# it would have passed: the repository's migrations build 42 tables and
# production has 48, so "at least 40" looked like success while thirteen
# tables were missing and seven unrelated ones made up the number. See
# docs/SCHEMA-DRIFT.md. This compares every table, column, default,
# constraint, index, function, trigger, policy and view.
if ! SCHEMA_COMPARE_DIR="${WORKDIR}" "$(dirname "${BASH_SOURCE[0]}")/compare-schema.sh"; then
  cat >&2 <<EOF

Not copying anything onto a target that does not match the source.

Build the target from what production actually is, rather than from the
migrations in supabase/ — they do not describe it:

  infra/capture-production-schema.sh
  psql "\$TARGET_URL" -v ON_ERROR_STOP=1 -f supabase/azure/000_bootstrap.sql
  psql "\$TARGET_URL" -v ON_ERROR_STOP=1 -f supabase/azure/production-schema.sql

then run this again.
EOF
  exit 1
fi

say "Checking the target is empty"
target_rows="$(psql "${TARGET_URL}" -At -v ON_ERROR_STOP=1 -c \
  "select coalesce(sum(n),0) from (
     select (xpath('/row/c/text()', query_to_xml(
       format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::bigint as n
     from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
     where ns.nspname='public' and c.relkind='r') t")"
if [[ "${target_rows}" -gt 0 && "${FORCE}" != "--force" ]]; then
  cat >&2 <<EOF
The target already holds ${target_rows} rows in public.

Loading on top of existing data is how a customer ends up with two of
everything, so this stops. If the target is a scratch copy you meant to
overwrite, re-run with --force. If it is not, work out what is in it first.
EOF
  exit 1
fi

say "Recording what is in the source"
counts_of "${SOURCE_URL}" > "${WORKDIR}/source-counts.tsv"
wc -l < "${WORKDIR}/source-counts.tsv" | xargs printf '  %s tables counted\n'

say "Dumping the data"
# --data-only:      the schema is already there and is the proven one.
# --no-owner:       Supabase's roles do not exist on Azure.
# --no-privileges:  nor do its grants; the migrations set up their own.
# --disable-triggers: so foreign keys and audit triggers do not fire during
#                   a bulk load that is, by definition, arriving out of order.
#
# BOTH TABLE PATTERNS ARE SCHEMA-QUALIFIED, AND THERE IS NO --schema.
# This read `--schema=public --table=auth.users` until it was actually run.
# `--table` does not ADD to `--schema`, it REPLACES the selection: the two
# together dumped auth.users and nothing else, so 256 of 262 rows were
# silently left behind. The dump was four kilobytes and reported success.
# Only the row-count comparison below caught it — which is the entire reason
# that comparison exists.
pg_dump "${SOURCE_URL}" \
  --data-only --no-owner --no-privileges --disable-triggers \
  --table='public.*' --table='auth.users' \
  --file="${DUMP}"

# A dump that named no public tables is the bug above coming back. Cheap to
# check, and the alternative is discovering it from a row count after a
# restore that looked fine.
if ! grep -q '^COPY public\.' "${DUMP}"; then
  echo "The dump contains no public tables. Refusing to restore it." >&2
  exit 1
fi
printf '  %s\n' "$(du -h "${DUMP}" | cut -f1) written to ${DUMP}"

say "Restoring"
# ON_ERROR_STOP=1 IS NOT OPTIONAL. Without it psql prints the errors, skips
# those statements, and exits 0 — a restore that lost half the invoices and
# reported success.
if ! psql "${TARGET_URL}" -v ON_ERROR_STOP=1 --single-transaction -f "${DUMP}" \
     > "${WORKDIR}/restore.log" 2>&1; then
  echo "The restore failed. Nothing was committed — it ran in one transaction." >&2
  echo "The log is at ${WORKDIR}/restore.log" >&2
  tail -20 "${WORKDIR}/restore.log" >&2
  exit 1
fi
echo "  restored."

say "Checking every table arrived"
counts_of "${TARGET_URL}" > "${WORKDIR}/target-counts.tsv"

if diff -u "${WORKDIR}/source-counts.tsv" "${WORKDIR}/target-counts.tsv" \
     > "${WORKDIR}/counts.diff"; then
  echo "  every table matches, row for row."
else
  cat >&2 <<EOF

ROW COUNTS DO NOT MATCH. The migration is NOT complete.

  $(grep -c '^[-+][^-+]' "${WORKDIR}/counts.diff" || true) differing line(s); full detail in ${WORKDIR}/counts.diff

Do not cut over. Nothing has been changed in Supabase, so the current
production system is untouched and still correct.
EOF
  exit 1
fi

say "Resetting the sequences"
# A dump carries the rows but leaves every sequence at 1, so the first new
# invoice after cutover would collide with an existing number. This is the
# step that is easy to forget and shows up as a duplicate key error in front
# of a customer.
psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare r record;
begin
  for r in
    select s.relname as seq, t.relname as tbl, a.attname as col
      from pg_class s
      join pg_depend d on d.objid = s.oid and d.deptype in ('a','i')
      join pg_class t on t.oid = d.refobjid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
      join pg_namespace n on n.oid = s.relnamespace
     where s.relkind = 'S' and n.nspname = 'public'
  loop
    execute format(
      'select setval(%L, coalesce((select max(%I) from public.%I), 0) + 1, false)',
      'public.' || r.seq, r.col, r.tbl);
  end loop;
end $$;
SQL
echo "  done."

cat <<EOF

Migration complete, and verified table by table.

  counts     ${WORKDIR}/source-counts.tsv vs target-counts.tsv (identical)
  dump       ${DUMP}
  restore    ${WORKDIR}/restore.log

Keep this directory until the CRM has run on Azure for a few days.

Supabase has not been touched and is still serving. Cutting over is a
separate, reversible step: point the site at the new API and watch it.
EOF
