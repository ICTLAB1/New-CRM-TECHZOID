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

# ── reaching the database ────────────────────────────────────────────────
#
# THREE DEPLOYS IN A ROW DIED HERE, on runs 151, 159 and 161, every one of
# them with the same message and none of them with a fault in the SQL:
#
#   psql: error: connection to server at "techzoid-pg-….postgres.database
#   .azure.com" (4.213.127.116), port 5432 failed: Connection timed out
#
# About one deploy in four. A migration that was ready to apply did not,
# the API deploy after it was skipped, and the change sat unreleased until
# somebody noticed — once it went a whole run unnoticed, which is the real
# cost: the deploy is red for a reason that has nothing to do with the
# commit, so a red deploy stops meaning anything.
#
# ONLY A CONNECTION FAILURE IS RETRIED. psql exits 2 when "connection to
# the server went bad", 3 when a statement failed under ON_ERROR_STOP, and
# 1 on a fault of its own such as a missing file. Retrying 3 would run a
# broken migration again and again and report the same error more slowly;
# retrying 1 would do it with no connection at all. So 2, and nothing else.
#
# RETRYING THE APPLY IS SAFE because -1 wraps each file in one transaction:
# a connection that dies mid-file takes the whole file's work with it, so
# the next attempt starts from the same place the first did.
#
# PGCONNECT_TIMEOUT bounds each attempt. Without it libpq waited about 145
# seconds before giving up, so even one retry would have doubled the time
# a genuinely unreachable database takes to be reported. Four attempts at
# 15 seconds, with 5s/10s/20s between them, is about 95 seconds in total —
# still less than the single attempt this replaces.
PSQL_TRIES="${PSQL_TRIES:-4}"
PSQL_BACKOFF="${PSQL_BACKOFF:-5}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"

# SQL GOES IN WITH -c OR -f, NEVER ON STDIN. A heredoc is a single file
# offset shared by every attempt: whichever attempt reads it leaves the
# next one at EOF, and psql given an empty script exits 0 having done
# nothing — a retry that "succeeds" without running anything.
#
# Whether that can actually bite depends on how the connection fails, and
# the one we have been seeing cannot: a connect timeout gives up before
# psql reads a byte of stdin, which I checked, and the heredoc survived.
# A connection lost AFTER the script was read is the case that would, and
# I could not reproduce it here to say so from evidence rather than from
# reading the manual. -c and -f are re-read in full by every attempt, so
# the question does not arise — which is the reason to use them.
run_psql() {
  local attempt=1 delay="$PSQL_BACKOFF" rc=0
  while :; do
    set +e
    psql "$@"
    rc=$?
    set -e
    [ "$rc" -ne 2 ] && return "$rc"
    [ "$attempt" -ge "$PSQL_TRIES" ] && {
      echo "could not reach the database after $PSQL_TRIES attempts" >&2
      return "$rc"
    }
    # To stderr: these calls are read through $( ) and their stdout is data.
    echo "could not reach the database (attempt $attempt of $PSQL_TRIES); retrying in ${delay}s" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

run_psql "$DB" -v ON_ERROR_STOP=1 -q -c "
create table if not exists public.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
revoke all on public.schema_migrations from public;
"

if [ "$(run_psql "$DB" -tAc "select count(*) from public.schema_migrations")" = "0" ]; then
  for f in "$ROOT"/supabase/[0-9][0-9][0-9]_*.sql; do
    n=$((10#$(basename "$f" | cut -c1-3)))
    [ "$n" -le "$BASELINE" ] && run_psql "$DB" -qc "insert into public.schema_migrations(name) values ('$(basename "$f")') on conflict do nothing"
  done
  echo "ledger created; baseline up to $(printf %03d $BASELINE)"
fi

applied=0
for f in "$ROOT"/supabase/[0-9][0-9][0-9]_*.sql; do
  name="$(basename "$f")"
  done_already="$(run_psql "$DB" -tAc "select 1 from public.schema_migrations where name = '$name'")"
  [ "$done_already" = "1" ] && continue
  echo "applying $name"
  run_psql "$DB" -v ON_ERROR_STOP=1 -q -1 -f "$f"
  run_psql "$DB" -qc "insert into public.schema_migrations(name) values ('$name')"
  applied=$((applied + 1))
done
echo "database up to date ($applied applied this run)"
