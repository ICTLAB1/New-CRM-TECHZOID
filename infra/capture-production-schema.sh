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

# Four adjustments, and no others. This is a filter, not a rewrite: every
# table, constraint, index, function, trigger, policy and view passes
# through exactly as pg_dump produced it.
#
# Each of these was found by running the thing, not by reading it:
#
#   CREATE SCHEMA public    -> IF NOT EXISTS. pg_dump 16 emits it
#     unconditionally, and 000_bootstrap.sql has already run by the time
#     this file is loaded. Made idempotent rather than dropped, so the dump
#     still works on a genuinely empty database.
#
#   COMMENT ON SCHEMA public -> dropped. Only the schema's OWNER may set it,
#     and on Azure Database for PostgreSQL the administrator is not a
#     superuser and does not own `public`. It is a cosmetic string, and
#     losing it is better than a restore that stops on line 32.
#
#   CREATE EXTENSION / COMMENT ON EXTENSION -> dropped. Supabase keeps its
#     extensions in an `extensions` schema; bootstrap has already created
#     the ones the CRM uses, in `public`.
#
#   CREATE SCHEMA extensions -> dropped, for the same reason.
sed -e 's/^CREATE SCHEMA public;$/CREATE SCHEMA IF NOT EXISTS public;/' \
    "${OUT}.raw" \
  | grep -v -E "^(CREATE EXTENSION|COMMENT ON EXTENSION|CREATE SCHEMA extensions|COMMENT ON SCHEMA public)" \
  > "${OUT}"
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
