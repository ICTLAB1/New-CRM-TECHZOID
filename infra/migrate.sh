#!/usr/bin/env bash
#
# Apply every database change in supabase/NNN_*.sql that the Azure database
# has not had yet, in order, each exactly once.
#
# The ledger is public.schema_migrations. The first time it is created it is
# seeded with everything up to BASELINE, which was applied by hand during the
# move to Azure. Everything after that is applied here, from the deploy
# workflow, so the database can never fall behind the code again.
#
# Every file from 043 on is idempotent ("if not exists", "create or replace",
# revoke/grant), so a file that was in fact already applied by hand is
# harmless to run once more.
#
# Usage:  DB="postgresql://…" bash infra/migrate.sh
set -euo pipefail

BASELINE=42
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${DB:?DB connection string required}"

psql "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
create table if not exists public.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
revoke all on public.schema_migrations from public;
SQL

if [ "$(psql "$DB" -tAc "select count(*) from public.schema_migrations")" = "0" ]; then
  for f in "$ROOT"/supabase/[0-9][0-9][0-9]_*.sql; do
    n=$((10#$(basename "$f" | cut -c1-3)))
    [ "$n" -le "$BASELINE" ] && psql "$DB" -qc "insert into public.schema_migrations(name) values ('$(basename "$f")') on conflict do nothing"
  done
  echo "ledger created; baseline up to $(printf %03d $BASELINE)"
fi

applied=0
for f in "$ROOT"/supabase/[0-9][0-9][0-9]_*.sql; do
  name="$(basename "$f")"
  done_already="$(psql "$DB" -tAc "select 1 from public.schema_migrations where name = '$name'")"
  [ "$done_already" = "1" ] && continue
  echo "applying $name"
  psql "$DB" -v ON_ERROR_STOP=1 -q -1 -f "$f"
  psql "$DB" -qc "insert into public.schema_migrations(name) values ('$name')"
  applied=$((applied + 1))
done
echo "database up to date ($applied applied this run)"
