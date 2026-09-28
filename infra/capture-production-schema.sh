#!/usr/bin/env bash
#
# Take the real production schema, so Azure can be built from what is
# actually running rather than from what the repository believes.
#
# WHY NOT JUST REPLAY THE MIGRATIONS. Because they do not describe
# production. Thirteen tables, nineteen functions, six views, two sequences
# and a dozen triggers exist in Supabase and in no file here: applied through
# the dashboard, never committed. `infra/compare-schema.sh` shows the whole
# list. Replaying supabase/*.sql builds a database that is missing all of it.
#
# WHY NOT RECONSTRUCT THE MISSING PIECES BY HAND. That was tried. Reading
# them back out of the catalog one kind at a time gets the tables, then the
# constraints, then the indexes, then the policies — and then a function body
# turns out to reference a VIEW that was never on the list, because nobody
# thought to look for views. `pg_dump` does not have opinions about what to
# look for. Use the tool that cannot forget.
#
# Usage:
#   export SOURCE_URL='postgresql://...supabase...'
#   infra/capture-production-schema.sh [output-file]
#
# The output is committed on purpose: it is the record of what production was
# on the day it moved, and the thing to diff against if Azure ever drifts.
# It contains no rows — schema only.

set -euo pipefail

: "${SOURCE_URL:?export SOURCE_URL with the Supabase connection string}"
OUT="${1:-supabase/azure/production-schema.sql}"

command -v pg_dump >/dev/null || { echo "pg_dump is not installed." >&2; exit 1; }

mkdir -p "$(dirname "${OUT}")"

echo "Dumping the production schema..."
# --schema-only:    no rows; the data is a separate, later step.
# --no-owner:       Supabase's roles do not exist on Azure.
# --no-privileges:  nor do its grants. 000_bootstrap.sql issues the ones the
#                   policies need, to roles it creates itself.
# --schema=public:  `auth` and the rest are Supabase's own plumbing, and
#                   bootstrap supplies the parts the CRM actually uses.
pg_dump "${SOURCE_URL}" \
  --schema-only --no-owner --no-privileges --schema=public \
  --file="${OUT}.raw"

# Supabase's dump refers to extensions that live in its own `extensions`
# schema. On Azure they go in `public`, which bootstrap has already created
# them in, so the CREATE EXTENSION lines are dropped rather than left to fail.
# Everything else passes through untouched: this is a filter, not a rewrite.
grep -v -E '^(CREATE EXTENSION|COMMENT ON EXTENSION|CREATE SCHEMA extensions)' \
  "${OUT}.raw" > "${OUT}"
rm -f "${OUT}.raw"

printf '  %s lines written to %s\n' "$(wc -l < "${OUT}")" "${OUT}"

cat <<EOF

Next:

  psql "\$TARGET_URL" -v ON_ERROR_STOP=1 -f supabase/azure/000_bootstrap.sql
  psql "\$TARGET_URL" -v ON_ERROR_STOP=1 -f ${OUT}

Then PROVE it landed, rather than assuming:

  infra/compare-schema.sh

-v ON_ERROR_STOP=1 on both, and not optional: without it psql prints each
error, skips that statement, and exits 0 — a schema that is quietly
incomplete and a script that reported success.
EOF
