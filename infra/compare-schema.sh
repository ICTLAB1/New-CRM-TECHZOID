#!/usr/bin/env bash
#
# Prove that two databases have the same schema — before trusting one of them
# with the other's data.
#
# THIS IS THE CHECK THAT WAS MISSING. The Azure plan was to replay the
# migrations in supabase/ and copy the rows across. Running this against
# production and against a database built that way is how it came out that
# production carries 13 tables, 19 functions, 6 views, 2 sequences and a
# dozen triggers that NO FILE IN THIS REPOSITORY CREATES — applied through
# the Supabase dashboard, never committed. The restore would have failed on
# the first row of `prospects`, and the parts that did land would have looked
# fine.
#
# Run it before the data migration. Run it again after. An empty diff is the
# only evidence worth having.
#
# Usage:
#   export SOURCE_URL='postgresql://...supabase...'
#   export TARGET_URL='postgresql://...azure...?sslmode=require'
#   infra/compare-schema.sh
#
# Reads definitions only — no customer data is queried, printed or stored.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIGEST="${HERE}/schema-digest.sql"
OUT="${SCHEMA_COMPARE_DIR:-$(mktemp -d)}"

: "${SOURCE_URL:?export SOURCE_URL (the database to copy FROM)}"
: "${TARGET_URL:?export TARGET_URL (the database to copy TO)}"
command -v psql >/dev/null || { echo "psql is not installed." >&2; exit 1; }

echo "Reading the source schema..."
psql "${SOURCE_URL}" -At -v ON_ERROR_STOP=1 -f "${DIGEST}" | sort > "${OUT}/source.txt"

echo "Reading the target schema..."
psql "${TARGET_URL}" -At -v ON_ERROR_STOP=1 -f "${DIGEST}" | sort > "${OUT}/target.txt"

printf '  source: %s objects\n  target: %s objects\n' \
  "$(wc -l < "${OUT}/source.txt")" "$(wc -l < "${OUT}/target.txt")"

if diff -u "${OUT}/source.txt" "${OUT}/target.txt" > "${OUT}/schema.diff"; then
  echo
  echo "IDENTICAL. Every table, column, default, constraint, index, function,"
  echo "trigger, policy and view matches. Safe to migrate the data."
  exit 0
fi

# Summarise before dumping the detail: "47 lines differ" is not actionable,
# "12 tables missing from the target" is.
summarise() {
  local marker="$1" label="$2"
  local n; n=$(grep -c "^${marker}[a-z]" "${OUT}/schema.diff" || true)
  [[ "$n" -eq 0 ]] && return
  echo "  ${label} (${n}):"
  grep "^${marker}[a-z]" "${OUT}/schema.diff" | cut -d'|' -f1-2 | sed "s/^${marker}/    /" | sort | uniq
}

echo
echo "THE SCHEMAS DO NOT MATCH. Do not migrate data onto this target yet."
echo
summarise "-" "only in the SOURCE, so the target cannot hold its data"
summarise "+" "only in the TARGET, which is usually harmless"
echo
echo "Full detail: ${OUT}/schema.diff"
echo
echo "An object in the source and not the target means the migrations in"
echo "supabase/ do not describe the source. The fix is to capture the real"
echo "thing — infra/capture-production-schema.sh — rather than to edit a"
echo "migration until the counts agree."
exit 1
