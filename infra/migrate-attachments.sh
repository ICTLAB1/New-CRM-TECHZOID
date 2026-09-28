#!/usr/bin/env bash
#
# Copy attached files from Supabase Storage into Azure Blob Storage.
#
# The rows move with everything else in `infra/migrate-data.sh` — the
# `attachments` table is just a table. This moves the BYTES those rows point
# at, which nothing else does, and which nothing will notice is missing
# until somebody opens a quotation and the contract is not there.
#
# Usage:
#   export SOURCE_URL='postgresql://...supabase...'     # to list the paths
#   export SUPABASE_URL='https://<project>.supabase.co'
#   export SUPABASE_SERVICE_KEY='...'                   # storage read
#   export AZURE_STORAGE_ACCOUNT='techzoidcrmst...'
#   infra/migrate-attachments.sh
#
# Copies, never moves: Supabase keeps every file, so this can be re-run and
# the old store stays a fallback until you are sure.
#
# The service key is read from the environment and never printed. `az` is
# used with --auth-mode login because the storage account has shared-key
# access disabled, so there is no account key to pass and none to leak.

set -euo pipefail

: "${SOURCE_URL:?export SOURCE_URL (the database holding the attachment rows)}"
: "${SUPABASE_URL:?export SUPABASE_URL}"
: "${SUPABASE_SERVICE_KEY:?export SUPABASE_SERVICE_KEY}"
: "${AZURE_STORAGE_ACCOUNT:?export AZURE_STORAGE_ACCOUNT}"
CONTAINER="${AZURE_STORAGE_CONTAINER:-attachments}"

for tool in psql az curl; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed." >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "Listing the files the database knows about..."
psql "${SOURCE_URL}" -At -v ON_ERROR_STOP=1 \
  -c "select path from public.attachments order by created_at" > "${WORK}/paths.txt"

total=$(wc -l < "${WORK}/paths.txt" | tr -d ' ')
echo "  ${total} file(s)"
[[ "${total}" -eq 0 ]] && { echo "Nothing to move."; exit 0; }

copied=0
skipped=0
failed=0

while IFS= read -r path; do
  [[ -z "${path}" ]] && continue

  # Already there? Copying again would work but re-uploading gigabytes on a
  # re-run is a waste, and this script is meant to be safe to repeat.
  if az storage blob exists --auth-mode login \
       --account-name "${AZURE_STORAGE_ACCOUNT}" --container-name "${CONTAINER}" \
       --name "${path}" --query exists -o tsv 2>/dev/null | grep -qi true; then
    skipped=$((skipped + 1))
    continue
  fi

  local_file="${WORK}/blob.bin"
  # --fail so a 404 or a 403 is an error rather than an HTML page saved as a
  # PDF, which is the shape this goes wrong in if it goes wrong quietly.
  if ! curl -sS --fail \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
        -o "${local_file}" \
        "${SUPABASE_URL}/storage/v1/object/attachments/${path}"; then
    echo "  COULD NOT DOWNLOAD: ${path}" >&2
    failed=$((failed + 1))
    continue
  fi

  if az storage blob upload --auth-mode login \
       --account-name "${AZURE_STORAGE_ACCOUNT}" --container-name "${CONTAINER}" \
       --name "${path}" --file "${local_file}" --overwrite false --only-show-errors >/dev/null; then
    copied=$((copied + 1))
  else
    echo "  COULD NOT UPLOAD: ${path}" >&2
    failed=$((failed + 1))
  fi
done < "${WORK}/paths.txt"

echo
echo "  copied  ${copied}"
echo "  already there  ${skipped}"
echo "  failed  ${failed}"

# Verify against the database rather than against the loop's own counters:
# a counter says what this script believes, a listing says what is there.
echo
echo "Checking every row's file is now in the container..."
az storage blob list --auth-mode login \
  --account-name "${AZURE_STORAGE_ACCOUNT}" --container-name "${CONTAINER}" \
  --query "[].name" -o tsv 2>/dev/null | sort > "${WORK}/in-azure.txt"

missing=$(comm -23 <(sort "${WORK}/paths.txt") "${WORK}/in-azure.txt" | grep -c . || true)

if [[ "${missing}" -eq 0 ]]; then
  cat <<EOF

Every file the database points at is in Azure.

Supabase still holds all of them — nothing was deleted — so the old store
remains a working fallback. Turn the new one on when you are ready:

  VITE_API_BASE=/api VITE_BLOB_STORAGE=on npm run build

and roll back by dropping VITE_BLOB_STORAGE and rebuilding.
EOF
  exit 0
fi

cat >&2 <<EOF

${missing} FILE(S) ARE MISSING FROM AZURE.

Do not turn VITE_BLOB_STORAGE on: those attachments would be dead links.
Supabase is untouched and still serving them. Re-run this script — it skips
what is already copied — and if a file fails repeatedly, the row may point
at bytes that were already gone.
EOF
exit 1
