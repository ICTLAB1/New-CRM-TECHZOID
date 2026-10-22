#!/usr/bin/env bash
#
# Put the Anthropic and Interakt keys into Key Vault, safely, and prove they
# work. Run in Azure Cloud Shell signed in as sales@ttpldelhi.com.
#
#   bash set-keys.sh anthropic     # invoice scanning
#   bash set-keys.sh interakt      # WhatsApp reminders
#
# Typing is hidden; the key is never printed and never put on a command
# line. It reaches Key Vault through a private temporary file (mode 600)
# that is deleted straight after.
# The order is the safe one: secret first, then the app setting that
# references it, then a check that the reference actually resolved.
set -euo pipefail

SUB="488bfe98-ea81-424c-8bc8-d97369a44759"
RG="techzoid-crm"; FA="techzoid-fn-web7gna6q5rns"; KV="techzoidkvweb7gna6q5rns"
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✘ %s\033[0m\n' "$*"; exit 1; }

if [ "$(az account show --query id -o tsv 2>/dev/null)" != "$SUB" ]; then
  az account set --subscription "$SUB" 2>/dev/null \
    || bad "Not signed in to the CRM's Azure subscription. Run:  az login --tenant 1d063589-6565-42de-8055-92aca1128f35   then run this again."
fi

store() {  # secret-name — reads the value from stdin, never from argv
  local name="$1" file
  file="$(mktemp)"; chmod 600 "$file"; cat > "$file"
  az keyvault secret set --vault-name "$KV" -n "$name" --file "$file" --encoding utf-8 -o none
  rm -f "$file"
}

resolved() {  # SETTING — waits until Azure reports the reference Resolved
  local s="$1" st=""
  for i in $(seq 1 12); do
    st="$(az rest --method get --url "https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Web/sites/$FA/config/configreferences/appsettings/$s?api-version=2022-03-01" --query properties.status -o tsv 2>/dev/null || true)"
    [ "$st" = "Resolved" ] && return 0
    sleep 10
  done
  echo "  status: ${st:-unknown}"; return 1
}

case "${1:-}" in
  anthropic)
    printf 'Paste the Anthropic API key (starts with sk-ant-), then Enter: '
    IFS= read -rs KEY; echo
    KEY="$(printf %s "$KEY" | tr -d '[:space:]')"
    [[ "$KEY" == sk-ant-* ]] || bad "That doesn't start with sk-ant-, so it isn't an Anthropic key. Nothing was stored."
    CODE="$(printf 'x-api-key: %s\n' "$KEY" | curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models \
      -H @- -H "anthropic-version: 2023-06-01")"
    [ "$CODE" = "200" ] || bad "Anthropic answered $CODE for that key (401 = wrong key). Nothing was stored."
    ok "Anthropic accepted the key"
    printf %s "$KEY" | store anthropic-api-key; unset KEY
    ok "stored in Key Vault"
    az functionapp restart -g "$RG" -n "$FA" -o none
    resolved ANTHROPIC_API_KEY && ok "the API can read it (reference resolved)" || bad "the reference did not resolve"
    echo; echo "Done. Upload an invoice in Payment Tracker to confirm."
    ;;
  interakt)
    printf 'Paste the Interakt API key exactly as Interakt shows it, then Enter: '
    IFS= read -rs KEY; echo
    KEY="$(printf %s "$KEY" | tr -d '[:space:]')"
    [ ${#KEY} -ge 20 ] || bad "That is too short to be an Interakt key. Nothing was stored."
    printf %s "$KEY" | base64 -d >/dev/null 2>&1 || echo "  (note: it doesn't look like base64 — Interakt keys normally are; storing it as given)"
    # An empty request: a good key gets "bad request", a wrong one 401.
    CODE="$(printf 'Authorization: Basic %s\n' "$KEY" | curl -s -o /dev/null -w '%{http_code}' -X POST https://api.interakt.ai/v1/public/track/users/ \
      -H @- -H "Content-Type: application/json" -d '{}')"
    [ "$CODE" = "000" ] && bad "Couldn't reach Interakt to check the key. Nothing was stored."
    [ "$CODE" = "401" ] || [ "$CODE" = "403" ] && bad "Interakt rejected that key ($CODE). Nothing was stored."
    ok "Interakt accepted the key (answered $CODE)"
    printf %s "$KEY" | store interakt-api-key; unset KEY
    ok "stored in Key Vault"
    az functionapp config appsettings set -g "$RG" -n "$FA" -o none \
      --settings "INTERAKT_API_KEY=@Microsoft.KeyVault(VaultName=$KV;SecretName=interakt-api-key)"
    resolved INTERAKT_API_KEY && ok "the API can read it (reference resolved)" || bad "the reference did not resolve"
    echo; echo "Done. Next: turn WhatsApp on in Payment Tracker → Reminder settings, and check the three templates are approved in Interakt."
    ;;
  *) echo "Usage: bash set-keys.sh anthropic | interakt"; exit 1;;
esac
