#!/usr/bin/env bash
#
# Apply the whole migration, in order, with a gate after every step.
#
# WHY THIS EXISTS. infra/README.md is eight steps of copy-and-paste, and the
# steps are not independent: step 2 needs a password that step 1 generated
# and never printed, step 5 refuses to run unless step 2 can be PROVEN to
# have landed, and step 6 needs a storage account name from step 1. Done by
# hand on the day of a cutover, the failure mode is not an error — it is
# step 5 being run against a schema that is quietly incomplete, which is
# exactly the mistake this repository already made once.
#
# WHAT IT WILL NOT DO. It will not touch Supabase or Netlify. Every step
# COPIES; nothing is moved or deleted, so the live CRM keeps serving
# throughout and rolling back is rebuilding without three environment
# variables. And it will not cut over without being told to in as many
# words: --cutover, typed on purpose.
#
# Usage:
#   az login
#   export SOURCE_URL='postgresql://...supabase...'   # steps 2, 5, 6
#   export JWT_SECRET='...'                            # step 3
#   export SUPABASE_URL='https://<project>.supabase.co' SUPABASE_SERVICE_KEY='...'
#   infra/apply-all.sh --plan        # what it would do, touching nothing
#   infra/apply-all.sh               # steps 1-6
#   infra/apply-all.sh --cutover     # ...and step 8, the move
#   infra/apply-all.sh --from 5      # resume
#
# Every step is idempotent. Re-running a completed step detects that it is
# done and skips it rather than failing, because the run that matters is the
# one where something went wrong in the middle.
#
# Reads and writes schema definitions and rows. It prints NO secret and no
# customer data — the connection string holding the database password is
# fetched into a variable straight from Key Vault and never echoed.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

RESOURCE_GROUP="${RESOURCE_GROUP:-techzoid-crm}"
LOCATION="${LOCATION:-centralindia}"
NAME_PREFIX="${NAME_PREFIX:-techzoid}"
DEPLOYMENT="${DEPLOYMENT:-crm-infra}"
FIREWALL_RULE="migration-runner"

FROM=1 TO=8 PLAN=0 CUTOVER=0 ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from)    FROM="${2:?--from needs a step number}"; shift 2 ;;
    --to)      TO="${2:?--to needs a step number}"; shift 2 ;;
    --only)    FROM="${2:?--only needs a step number}"; TO="$2"; shift 2 ;;
    --plan)    PLAN=1; shift ;;
    --cutover) CUTOVER=1; shift ;;
    --check)   FROM=9; TO=9; shift ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,36p' "${BASH_SOURCE[0]}" | sed 's/^#\s\?//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "${FROM}${TO}" in *[!0-9]*) echo "--from and --to take step numbers." >&2; exit 2 ;; esac

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }
runs() { [ "$1" -ge "$FROM" ] && [ "$1" -le "$TO" ]; }

# A step that changes something outside this machine asks first, unless the
# whole run was approved up front. The prompt names what is about to happen
# rather than asking "are you sure", because "are you sure" is answered yes
# by reflex.
confirm() {
  [ "${PLAN:-0}" = 1 ] && { note "would ask for confirmation before this"; return 0; }
  [ "$ASSUME_YES" = 1 ] && return 0
  printf '\n%s\n  Type "yes" to continue: ' "$1"
  local answer; read -r answer
  [ "$answer" = "yes" ] || die "Stopped."
}

if [ "$PLAN" = 1 ]; then
  say "PLAN — nothing below will be executed."
fi

# ONE exit trap, installed before anything has a secret to spill. It runs
# however the script ends — the end of the last step, a `die`, a failed `az`
# under set -e, or a Ctrl-C. Registering cleanup next to the thing that
# needs cleaning up does not survive `set -e`: the line after the failing
# command is the line that does not run.
CLEANUP_FILES=()
RULE_ADDED=0
cleanup() {
  local f
  for f in ${CLEANUP_FILES+"${CLEANUP_FILES[@]}"}; do
    [ -n "$f" ] && rm -f "$f"
  done
  if [ "$RULE_ADDED" = 1 ]; then
    az postgres flexible-server firewall-rule delete \
      -g "$RESOURCE_GROUP" -n "${PG_HOST%%.*}" -r "$FIREWALL_RULE" --yes -o none 2>/dev/null || true
    note "firewall: closed ${FIREWALL_RULE} again"
  fi
}
trap cleanup EXIT INT TERM

# A plan that prints the command prints the CONNECTION STRING, which carries
# the database password, and `-p postgresAdminPassword=...`, which is the
# password itself. A dry run is the mode somebody uses to show a colleague
# what is about to happen, over their shoulder or in a screenshot, so it is
# the last place either belongs.
redact() {
  local a out=()
  for a in "$@"; do
    case "$a" in
      postgres://*|postgresql://*) a='postgresql://<redacted>' ;;
      *[Pp]assword=*|*[Ss]ecret=*|*[Kk]ey=*|*[Tt]oken=*) a="${a%%=*}=<redacted>" ;;
    esac
    out+=("$a")
  done
  printf '%s' "${out[*]}"
}
do_it() { [ "$PLAN" = 1 ] && { note "would run: $(redact "$@")"; return 0; }; "$@"; }

# -- preflight ---------------------------------------------------------

for tool in az psql pg_dump npm node; do
  command -v "$tool" >/dev/null || die "${tool} is not installed."
done

az account show >/dev/null 2>&1 || die "Not signed in to Azure. Run: az login"
note "subscription: $(az account show --query name -o tsv)"

# Whose steps need what. Checked NOW, all of them, rather than three minutes
# into a provisioning run — the point of a preflight is that a missing
# variable costs a retype and not a half-built resource group.
# Anything still sitting in the terminal's input buffer -- the rest of a
# pasted block, say -- would otherwise be read as the ANSWER to the first
# prompt. Paste a runbook in one go and your database password becomes the
# next command line, silently, and the failure surfaces three steps later
# as an authentication error that makes no sense. Drained before every
# prompt, and the prompt reads from /dev/tty rather than from stdin.
drain_input() {
  local junk
  while IFS= read -r -t 0 2>/dev/null; do
    IFS= read -r -t 0.1 junk 2>/dev/null || break
  done
}

# Ask for a value rather than refusing to start without it. Exporting
# secrets by hand puts them in ~/.bash_history, which on Cloud Shell lives
# on the persistent share and outlives the session.
ask_for() {
  local var="$1" why="$2" value=""
  [ -n "${!var:-}" ] && return 0
  if [ ! -t 0 ] || [ ! -r /dev/tty ]; then
    die "${var} is not set, and there is no terminal to ask on. Export it and run again."
  fi
  while [ -z "$value" ]; do
    drain_input
    printf '\n  %s\n  %s: ' "$why" "$var" > /dev/tty
    IFS= read -rs value < /dev/tty
    printf '\n' > /dev/tty
    [ -n "$value" ] || printf '  (that one is needed)\n' > /dev/tty
  done
  printf -v "$var" '%s' "$value"
  export "${var?}"
}

if [ "$PLAN" != 1 ] || runs 2 || runs 5; then
  { runs 2 || runs 5; } && ask_for SOURCE_URL "The Supabase connection string, port 5432 -- NOT the 6543 pooler."
fi
runs 3 && ask_for JWT_SECRET "Supabase -> Settings -> API -> JWT Secret. It is what verifies every token."
if runs 6; then
  ask_for SUPABASE_URL         "Supabase -> Settings -> API -> Project URL (https://<ref>.supabase.co)."
  ask_for SUPABASE_SERVICE_KEY "Supabase -> Settings -> API -> service_role key."
fi

# A placeholder left in from the runbook is worse than a missing value: it
# reaches step 6 and fails there, after the rows have already moved.
case "${SUPABASE_URL:-}" in
  *"<"*|*">"*) die "SUPABASE_URL still has a placeholder in it: ${SUPABASE_URL}" ;;
esac

# pg_dump must be at least as new as the server it reads.
#
# This is the one that wastes an afternoon. Azure Cloud Shell is the obvious
# place to run this from -- it has az, it is inside Azure's network -- and
# the psql it ships can be older than the Supabase server. pg_dump refuses
# outright with "server version mismatch", but only after step 1 has built a
# resource group, and the message does not say what to do about it. Asked
# here instead, before anything exists.
if { runs 2 || runs 5; } && [ "$PLAN" != 1 ]; then
  dump_major="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
  src_num="$(psql "$SOURCE_URL" -At -c 'show server_version_num' 2>/dev/null || true)"
  if [ -z "$src_num" ]; then
    die "Could not reach the source database with SOURCE_URL. Check the string, and that this machine is allowed to connect."
  fi
  src_major=$(( src_num / 10000 ))
  note "postgres: source is ${src_major}, pg_dump here is ${dump_major}"
  if [ "$dump_major" -lt "$src_major" ]; then
    die "pg_dump is ${dump_major} and the source server is ${src_major}. It will refuse to read it.

  On Cloud Shell or Ubuntu:
    sudo sh -c 'echo \"deb http://apt.postgresql.org/pub/repos/apt \$(lsb_release -cs)-pgdg main\" > /etc/apt/sources.list.d/pgdg.list'
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
    sudo apt-get update && sudo apt-get install -y postgresql-client-${src_major}
    export PATH=/usr/lib/postgresql/${src_major}/bin:\$PATH"
  fi
fi

# -- step 1: the resources ---------------------------------------------

if runs 1; then
  say "1. Creating the resources"
  do_it az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none

  # The password is generated ONCE, on the first run. A re-run must reuse
  # it: rotating it would leave the vault, the function app and a database
  # already holding rows disagreeing about what the password is, and the
  # symptom is the API failing to connect long after this script said it
  # succeeded. So the existing secret is the source of truth, and a new
  # password is only invented when there is no vault entry to find.
  existing_vault="$(az deployment group show -g "$RESOURCE_GROUP" -n "$DEPLOYMENT" \
    --query properties.outputs.keyVaultName.value -o tsv 2>/dev/null || true)"
  pg_password=""
  if [ -n "$existing_vault" ]; then
    pg_password="$(az keyvault secret show --vault-name "$existing_vault" \
      -n pg-connection-string --query value -o tsv 2>/dev/null \
      | sed -e 's|^postgresql://[^:]*:||' -e 's|@.*$||' \
      | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.stdin.read().strip()))' \
      2>/dev/null || true)"
  fi
  if [ -n "$pg_password" ]; then
    note "already provisioned — reusing the existing password, not rotating it"
  else
    note "generating a database password — it goes to Key Vault and nowhere else"
    pg_password="$(openssl rand -base64 24)"
  fi

  # Through a file, not through `-p postgresAdminPassword=...`. An argument
  # is visible in /proc/<pid>/cmdline to every other process on the machine
  # for as long as the deployment runs, which on a Flexible Server is about
  # eight minutes. The file is created with no group or other permission at
  # all and removed however this step ends.
  params_file="$(mktemp)"; chmod 600 "$params_file"
  CLEANUP_FILES+=("$params_file")
  python3 - "$params_file" "$NAME_PREFIX" "$pg_password" <<'PYJSON'
import json, sys
path, prefix, password = sys.argv[1], sys.argv[2], sys.argv[3]
json.dump({
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "namePrefix": {"value": prefix},
    "postgresAdminPassword": {"value": password},
  },
}, open(path, "w"))
PYJSON
  unset pg_password

  do_it az deployment group create -g "$RESOURCE_GROUP" -n "$DEPLOYMENT" \
    -f "${HERE}/main.bicep" -p "@${params_file}" -o none
  rm -f "$params_file"
fi

# -- what step 1 made ---------------------------------------------------

if [ "$PLAN" = 1 ] && ! az deployment group show -g "$RESOURCE_GROUP" -n "$DEPLOYMENT" >/dev/null 2>&1; then
  note "(the rest of the plan needs step 1's outputs, which do not exist yet)"
  exit 0
fi

out() {
  az deployment group show -g "$RESOURCE_GROUP" -n "$DEPLOYMENT" \
    --query "properties.outputs.$1.value" -o tsv 2>/dev/null
}
FUNCTION_APP="$(out functionAppName)"
STATIC_SITE="$(out staticSiteName)"
STATIC_HOST="$(out staticSiteHost)"
KEY_VAULT="$(out keyVaultName)"
PG_HOST="$(out postgresHost)"
STORAGE="$(out storageAccount)"
[ -n "$FUNCTION_APP" ] || die "Cannot read deployment '$DEPLOYMENT' in '$RESOURCE_GROUP'. Run step 1 first."

note "function app:  $FUNCTION_APP"
note "static site:   https://$STATIC_HOST"
note "postgres:      $PG_HOST"
note "storage:       $STORAGE"

# The connection string, straight from the vault into a variable. It carries
# the database password, so it is never printed, never written to a file and
# never passed as a command-line argument — /proc/<pid>/cmdline is readable.
TARGET_URL="$(az keyvault secret show --vault-name "$KEY_VAULT" \
                -n pg-connection-string --query value -o tsv 2>/dev/null || true)"
if [ -z "$TARGET_URL" ] && [ "$PLAN" != 1 ]; then
  die "Could not read pg-connection-string from ${KEY_VAULT}. Does your account have Key Vault Secrets User on it?"
fi
export TARGET_URL

# -- the firewall, which is what actually stops this working ------------
#
# The template opens the server to Azure services, because that is what the
# function app needs and it has no fixed address on Flex Consumption. It
# does NOT open it to whoever is running this script, and `psql` from a
# laptop or from Cloud Shell is exactly that. Opened here for the length of
# the run and closed again on the way out, however the run ends.

# Through the environment, not through --deployment-token. A command-line
# argument is readable in /proc/<pid>/cmdline by every other process on the
# machine while it runs, and this token is enough to publish anything to the
# live site. The same reason the database password goes in via a file.
deploy_site() {
  local token
  token="$(az staticwebapp secrets list -n "$STATIC_SITE" -g "$RESOURCE_GROUP" \
    --query properties.apiKey -o tsv)"
  [ -n "$token" ] || die "Could not read the deployment token for ${STATIC_SITE}."
  SWA_CLI_DEPLOYMENT_TOKEN="$token" \
    npx --yes @azure/static-web-apps-cli deploy "${ROOT}/dist" --env default
}

# -- is it actually working ---------------------------------------------
#
# "Deployed" and "live" are not the same claim, and the gap between them is
# where this will go wrong. A zip can upload cleanly to a function app that
# then answers 500 on every request because the Key Vault reference did not
# resolve -- the managed identity's role assignment takes a minute or two to
# propagate, and until it does the app starts, serves, and cannot reach the
# database. Nothing in the deployment output says so.
#
# So: a real request, over the real URL, through the linked backend.
#
# An anonymous select on `settings` is the one worth making. It touches
# every part of the path -- routing, the function host, the connection
# string from the vault, the catalog, the translator and the policies -- and
# the CORRECT answer is `{"data":[]}`, because `settings_select_member`
# compares against auth.uid() and an anonymous caller is nobody. Empty is
# proof the policy ran. Rows coming back would be the alarming outcome.
smoke_test() {
  [ "$PLAN" = 1 ] && { note "would check the site and the API actually answer"; return 0; }
  local base="https://${STATIC_HOST}" raw code body attempt=0
  local max="${SMOKE_TRIES:-10}" gap="${SMOKE_GAP:-15}"

  printf '  checking %s ... ' "$base"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$base/" || echo 000)"
  if [ "$code" != "200" ]; then
    printf '%s\n' "$code"
    die "The site is not serving. Deploy it (step 4) before checking."
  fi
  printf 'serving\n'

  # Retried, because a Flex Consumption app cold-starts and the role
  # assignment it needs may still be propagating. A failure on the first
  # try means nothing; a failure on the tenth is real.
  while [ "$attempt" -lt "$max" ]; do
    attempt=$(( attempt + 1 ))
    printf '  checking %s/api/q (try %s/%s) ... ' "$base" "$attempt" "$max"

    # ONE request. The body and the status must describe the same call --
    # asking twice can answer differently, and then the body printed in a
    # failure is not the body of the request that failed.
    raw="$(curl -s -w '\n%{http_code}' --max-time 45 -X POST "${base}/api/q" \
      -H 'content-type: application/json' \
      -d '{"table":"settings","op":"select","select":"id","filters":[{"col":"id","op":"eq","value":"main"}]}' \
      2>/dev/null || printf '\n000')"
    code="${raw##*$'\n'}"
    body="${raw%$'\n'*}"

    case "$code" in
      200)
        printf 'answered\n'
        case "$(printf '%s' "$body" | tr -d ' ')" in
          '{"data":[]}')
            note "live: it reached the database, and the policies refused an anonymous caller -- which is the correct answer"
            return 0 ;;
          *'"data"'*)
            note "the API answered 200 but returned ROWS to an anonymous caller."
            die "Row-level security is not being applied. Do NOT cut over. Check that 000_bootstrap.sql loaded, and that the API connects as a role without BYPASSRLS." ;;
          *)
            note "unexpected body: ${body:0:200}"
            die "The API answered 200 with something unrecognisable." ;;
        esac ;;
      404) printf '404\n'
           die "The API is not routed. The Static Web App's linked backend is not wired to ${FUNCTION_APP}, or the zip deployed without registering any function." ;;
      000) printf 'no answer\n' ;;
      *)   printf '%s\n' "$code" ;;
    esac
    [ "$attempt" -lt "$max" ] && sleep "$gap"
  done

  note "last response: ${code} ${body:0:200}"
  die "The API never answered correctly. Most often this is the Key Vault reference: run
  az functionapp config appsettings list -g ${RESOURCE_GROUP} -n ${FUNCTION_APP}
  and look for PGCONNECTION_STRING still showing an unresolved @Microsoft.KeyVault(...) value."
}

open_firewall() {
  [ "$RULE_ADDED" = 1 ] && return 0
  [ "$PLAN" = 1 ] && { note "would open the firewall for this machine"; return 0; }
  local ip="${RUNNER_IP:-}"
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    [ -n "$ip" ] && break
    ip="$(curl -fsS --max-time 10 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
  done
  case "$ip" in
    *[!0-9.]*|"") die "Could not work out this machine's public address. Set RUNNER_IP=<your ip> and run again." ;;
  esac
  az postgres flexible-server firewall-rule create \
    -g "$RESOURCE_GROUP" -n "${PG_HOST%%.*}" -r "$FIREWALL_RULE" \
    --start-ip-address "$ip" --end-ip-address "$ip" -o none
  RULE_ADDED=1
  note "firewall: opened ${FIREWALL_RULE} for this machine only"
}

# -- step 2: the schema -------------------------------------------------

if runs 2; then
  say "2. Loading the schema — captured from production, not replayed from this repository"
  open_firewall

  # Already loaded? Then say so and move on. `production-schema.sql` is
  # pg_dump output: its CREATE TABLEs have no IF NOT EXISTS, so re-running
  # it on a loaded database is a screenful of "already exists" and a
  # non-zero exit. The gate is compare-schema.sh, which is the same
  # evidence step 5 will demand anyway.
  if [ "$PLAN" != 1 ] && SCHEMA_COMPARE_DIR="$(mktemp -d)" "${HERE}/compare-schema.sh" >/dev/null 2>&1; then
    note "the target already matches production — nothing to load"
  else
    do_it "${HERE}/capture-production-schema.sh"
    note "loading 000_bootstrap.sql (the auth schema and the three roles)"
    do_it psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -f "${ROOT}/supabase/azure/000_bootstrap.sql"
    note "loading production-schema.sql"
    do_it psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -f "${ROOT}/supabase/azure/production-schema.sql"

    # PROVE it, rather than trusting that psql exited 0 — which it will do
    # even with errors unless ON_ERROR_STOP is set, and has done before.
    if [ "$PLAN" != 1 ]; then
      "${HERE}/compare-schema.sh" || die "The schema did not land identically. Nothing further will run."
    fi
  fi
fi

# -- step 3: the secrets ------------------------------------------------

if runs 3; then
  say "3. Loading the secrets into Key Vault"
  export APP_URL="${APP_URL:-https://$STATIC_HOST}"
  do_it "${HERE}/secrets.sh" "$RESOURCE_GROUP" "$KEY_VAULT" "$FUNCTION_APP"
fi

# -- step 4: the code ---------------------------------------------------

if runs 4; then
  say "4. Deploying the API and the site"

  note "installing the API's dependencies"
  do_it npm --prefix "${ROOT}/api" install --omit=dev --no-audit --no-fund

  # And the site's. On a fresh clone -- which is what Cloud Shell is --
  # there is no node_modules at the root, and `npm run build` further down
  # fails on the first import rather than on anything to do with Azure.
  if [ ! -d "${ROOT}/node_modules" ]; then
    note "installing the site's dependencies (fresh clone)"
    do_it npm --prefix "$ROOT" install --no-audit --no-fund
  fi

  if [ "$PLAN" = 1 ]; then
    note "would zip api/ and deploy it to $FUNCTION_APP"
  else
    zip_file="$(mktemp -d)/api.zip"
    ( cd "${ROOT}/api" && zip -qr "$zip_file" . -x '*.test.mjs' 'netlify/*' )
    az functionapp deployment source config-zip \
      -g "$RESOURCE_GROUP" -n "$FUNCTION_APP" --src "$zip_file" -o none
    rm -f "$zip_file"
  fi

  # Built WITHOUT the cutover switches. This step puts the site on Azure so
  # it can be opened and looked at; it still talks to Supabase until step 8
  # says otherwise. Deploying a cutover build here would move production
  # three steps before anybody meant to.
  note "building the site (still pointed at Supabase — step 8 is the move)"
  do_it npm --prefix "$ROOT" run build

  if [ "$PLAN" = 1 ]; then
    note "would deploy dist/ to $STATIC_SITE"
  else
    deploy_site
    smoke_test
  fi
fi

# -- step 5: the rows ---------------------------------------------------

if runs 5; then
  say "5. Moving the data"
  open_firewall

  # OUTSIDE the repository, and not by default. migrate-data.sh works in
  # ./migration-<stamp> unless told otherwise, and on the day this is run
  # the current directory will be the checkout. That directory holds
  # data.sql — every row of every customer, order and invoice — as an
  # untracked folder sitting next to the source. One `git add -A` by
  # somebody committing the migration notes afterwards and it is in a
  # public repository. .gitignore covers it too, for anyone following the
  # README by hand; this makes it not be there in the first place.
  if [ "$PLAN" = 1 ]; then
    MIGRATION_DIR="${MIGRATION_DIR:-<a temporary directory outside the checkout>}"
  else
    export MIGRATION_DIR="${MIGRATION_DIR:-$(mktemp -d -t crm-migration-XXXXXX)}"
  fi
  note "working in ${MIGRATION_DIR} (outside the checkout, and it holds real rows)"
  confirm "This copies every row from Supabase into ${PG_HOST}.
  Supabase is NOT touched and keeps serving. The target must be empty."
  do_it "${HERE}/migrate-data.sh"
fi

# -- step 6: the bytes --------------------------------------------------

if runs 6; then
  say "6. Moving the attached files"
  # The attachment ROWS came across in step 5 — it is just a table. The
  # bytes they point at did not, and nothing notices until somebody opens a
  # quotation and the contract is not there.
  export AZURE_STORAGE_ACCOUNT="$STORAGE"
  do_it "${HERE}/migrate-attachments.sh"
fi

# -- step 7: Entra ID ---------------------------------------------------

if runs 7; then
  say "7. Sign-in with Entra ID"
  if [ -z "${ENTRA_TENANT_ID:-}" ] || [ -z "${ENTRA_API_AUDIENCE:-}" ]; then
    note "skipped — it needs an app registration made in the portal first."
    note "See infra/README.md step 7, then re-run with:"
    note "  ENTRA_TENANT_ID=... ENTRA_CLIENT_ID=... ENTRA_API_AUDIENCE=... infra/apply-all.sh --only 7"
  else
    # JWT_ISSUER and JWT_AUDIENCE are not optional here. Linking matches a
    # Microsoft account to a CRM user BY EMAIL ADDRESS, and an address only
    # identifies a person inside one directory. These two settings are what
    # establish that the token came from your tenant, for your application.
    do_it az functionapp config appsettings set -g "$RESOURCE_GROUP" -n "$FUNCTION_APP" -o none --settings \
      JWT_ALG=RS256 \
      JWT_JWKS_URI="https://login.microsoftonline.com/${ENTRA_TENANT_ID}/discovery/v2.0/keys" \
      JWT_ISSUER="https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0" \
      JWT_AUDIENCE="${ENTRA_API_AUDIENCE}"
    note "the API now accepts Microsoft tokens as well as Supabase ones"
    note "the SITE still signs in with Supabase until you build with VITE_AUTH=entra"
  fi
fi

# -- step 8: the move ---------------------------------------------------

if runs 8; then
  if [ "$CUTOVER" != 1 ]; then
    say "8. Pointing the CRM at Azure — NOT DONE"
    note "Everything above builds the new home. This step is the move, and it"
    note "needs asking for: infra/apply-all.sh --only 8 --cutover"
  else
    say "8. Pointing the CRM at Azure"
    confirm "This rebuilds the site with VITE_API_BASE=/api and VITE_BLOB_STORAGE=on
  and deploys it to https://${STATIC_HOST}. From then on that site reads and
  writes AZURE, not Supabase.
  Rolling back is this same step without the two variables."

    entra_env=()
    if [ -n "${ENTRA_CLIENT_ID:-}" ] && [ -n "${ENTRA_TENANT_ID:-}" ] && [ -n "${ENTRA_API_AUDIENCE:-}" ]; then
      entra_env=(VITE_AUTH=entra
                 VITE_ENTRA_CLIENT_ID="$ENTRA_CLIENT_ID"
                 VITE_ENTRA_TENANT_ID="$ENTRA_TENANT_ID"
                 VITE_ENTRA_API_SCOPE="${ENTRA_API_AUDIENCE}/access_as_user")
      note "including the sign-in switch (VITE_AUTH=entra)"
    else
      note "sign-in stays on Supabase — the three VITE_ENTRA_* values are not set"
    fi

    do_it env VITE_API_BASE=/api VITE_BLOB_STORAGE=on "${entra_env[@]}" \
      npm --prefix "$ROOT" run build

    if [ "$PLAN" = 1 ]; then
      note "would deploy the cutover build to $STATIC_SITE"
    else
      deploy_site
      smoke_test
    fi
  fi
fi

if runs 9; then
  say "Checking that it is actually live"
  smoke_test
fi

say "Done."
note "site:  https://${STATIC_HOST}"
note "api:   https://${STATIC_HOST}/api/q"
echo
note "Supabase and Netlify are untouched and still serving. Nothing here"
note "moved data — it was copied — so rolling back is a rebuild, not a restore."
