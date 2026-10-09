#!/usr/bin/env bash
#
# Finish moving the CRM onto Azure. Run once, in Azure Cloud Shell (Bash).
#
#   1. Deploys the API (all 26 server functions) to the Function App.
#   2. Sets up the Microsoft 365 mailbox connector on Azure: its own app
#      registration, its client secret and a state secret — created and
#      stored in Key Vault by this script. Nobody ever sees or types them.
#   3. Asks for the outside services' keys (AI assistant, email, WhatsApp,
#      IndiaMART, GST check). Typing is hidden. Press Enter to skip any.
#   4. Points the Function App at all of it and removes the leftover
#      Supabase settings.
#
# Safe to run again: it reuses what already exists.

set -euo pipefail

RG="techzoid-crm"
FA="techzoid-fn-web7gna6q5rns"
SITE="https://crm.ttpldelhi.com"
# Where the staff mailboxes live (techzoidtechnologies.com).
MAIL_TENANT="7fbedec0-0c39-4028-b5af-5f73a3d65e64"
MAIL_APP_NAME="TechZoid CRM Mail"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }

KV="$(az keyvault list -g "$RG" --query "[0].name" -o tsv)"
[ -n "$KV" ] || { echo "No Key Vault found in $RG." >&2; exit 1; }
KV_ID="$(az keyvault show -n "$KV" --query id -o tsv)"
ME="$(az ad signed-in-user show --query id -o tsv)"

# ── Key Vault access ───────────────────────────────────────────────────
say "Making sure you and the Function App can use Key Vault $KV"
az role assignment create --role "Key Vault Secrets Officer" \
  --assignee-object-id "$ME" --assignee-principal-type User --scope "$KV_ID" -o none 2>/dev/null || true
FA_PRINCIPAL="$(az functionapp identity show -g "$RG" -n "$FA" --query principalId -o tsv 2>/dev/null || true)"
if [ -z "$FA_PRINCIPAL" ]; then
  FA_PRINCIPAL="$(az functionapp identity assign -g "$RG" -n "$FA" --query principalId -o tsv)"
fi
az role assignment create --role "Key Vault Secrets User" \
  --assignee-object-id "$FA_PRINCIPAL" --assignee-principal-type ServicePrincipal --scope "$KV_ID" -o none 2>/dev/null || true

put_secret() {  # name, value  — value never printed
  local name="$1" value="$2" tries=0
  until az keyvault secret set --vault-name "$KV" -n "$name" --value "$value" -o none 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -ge 6 ] && { echo "Could not write $name to Key Vault." >&2; return 1; }
    sleep 10   # a new role assignment can take a minute to apply
  done
}
ref() { echo "@Microsoft.KeyVault(VaultName=${KV};SecretName=$1)"; }

# ── 1. the API ─────────────────────────────────────────────────────────
say "Packaging the API"
PKG="$(mktemp -d)"
( cd "$ROOT/api" && npm install --omit=dev --no-audit --no-fund >/dev/null )
cp -RL "$ROOT/api/." "$PKG/"
rm -rf "$PKG/netlify"
cp -R "$ROOT/netlify" "$PKG/netlify"
# The old Netlify functions import ../../api/lib/…; give them that path.
mkdir -p "$PKG/api" && cp -R "$ROOT/api/lib" "$PKG/api/lib"
find "$PKG" -name "*.test.mjs" -delete
( cd "$PKG" && zip -qr "$PKG.zip" . )
say "Deploying the API to $FA (takes a minute or two)"
az functionapp deployment source config-zip -g "$RG" -n "$FA" --src "$PKG.zip" -o none
rm -rf "$PKG" "$PKG.zip"

# ── 2. Microsoft 365 mailbox connector ─────────────────────────────────
say "Setting up the Microsoft 365 mailbox connector"
MAIL_APP="$(az ad app list --display-name "$MAIL_APP_NAME" --query "[0].appId" -o tsv)"
if [ -z "$MAIL_APP" ]; then
  MAIL_APP="$(az ad app create --display-name "$MAIL_APP_NAME" \
    --sign-in-audience AzureADMultipleOrgs \
    --web-redirect-uris "$SITE/api/ms-oauth-callback" \
    --query appId -o tsv)"
  # Microsoft Graph, delegated: openid, profile, offline_access, User.Read, Mail.Send
  az ad app permission add --id "$MAIL_APP" --api 00000003-0000-0000-c000-000000000000 --api-permissions \
    37f7f235-527c-4136-accd-4a02d197296e=Scope \
    14dad69e-099b-42c9-810b-d002981feec1=Scope \
    7427e0e9-2fba-42fe-b0c0-848c9e6a8182=Scope \
    e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope \
    e383f46e-2787-4529-855e-0e479a3ffac0=Scope -o none 2>/dev/null || true
  echo "  created app registration $MAIL_APP_NAME"
else
  az ad app update --id "$MAIL_APP" --web-redirect-uris "$SITE/api/ms-oauth-callback" -o none
  echo "  reusing app registration $MAIL_APP_NAME"
fi
if ! az keyvault secret show --vault-name "$KV" -n ms-client-secret -o none 2>/dev/null; then
  put_secret ms-client-secret "$(az ad app credential reset --id "$MAIL_APP" --append \
      --display-name crm-azure --years 2 --query password -o tsv 2>/dev/null)"
  echo "  client secret created and stored"
fi
if ! az keyvault secret show --vault-name "$KV" -n ms-state-secret -o none 2>/dev/null; then
  put_secret ms-state-secret "$(openssl rand -hex 32)"
fi

# ── 3. outside services ────────────────────────────────────────────────
say "Keys for outside services — typing is hidden, press Enter to skip any"
SETTINGS=(
  "APP_URL=$SITE"
  "ALLOWED_ORIGINS=$SITE"
  "MS_CLIENT_ID=$MAIL_APP"
  "MS_TENANT_ID=$MAIL_TENANT"
  "MS_REDIRECT_URI=$SITE/api/ms-oauth-callback"
  "MS_CLIENT_SECRET=$(ref ms-client-secret)"
  "MS_STATE_SECRET=$(ref ms-state-secret)"
)
ask() {  # ENV_NAME vault-name "what it is"
  local var="$1" name="$2" what="$3" value=""
  printf '  %-20s %s: ' "$var" "$what" > /dev/tty
  IFS= read -rs value < /dev/tty || true
  echo > /dev/tty
  if [ -n "$value" ]; then
    put_secret "$name" "$value"; SETTINGS+=("$var=$(ref "$name")"); echo "    stored"
  elif az keyvault secret show --vault-name "$KV" -n "$name" -o none 2>/dev/null; then
    SETTINGS+=("$var=$(ref "$name")"); echo "    kept the one already stored"
  else
    echo "    skipped"
  fi
}
ask ANTHROPIC_API_KEY  anthropic-api-key  "AI assistant (Anthropic)"
ask RESEND_API_KEY     resend-api-key     "company email sending (Resend)"
ask INTERAKT_API_KEY   interakt-api-key   "WhatsApp follow-ups (Interakt)"
ask WHATSAPP_API_TOKEN whatsapp-api-token "WhatsApp QR service"
ask INDIAMART_CRM_KEY  indiamart-crm-key  "IndiaMART leads"
ask SANDBOX_API_KEY    sandbox-api-key    "GST/PAN check key (Sandbox)"
ask SANDBOX_API_SECRET sandbox-api-secret "GST/PAN check secret (Sandbox)"
printf '  %-20s %s: ' "EMAIL_FROM" "sender address [sales@techzoidtechnologies.com]" > /dev/tty
IFS= read -r FROM < /dev/tty || true
SETTINGS+=("EMAIL_FROM=${FROM:-sales@techzoidtechnologies.com}")

# ── 4. apply ───────────────────────────────────────────────────────────
say "Applying settings to $FA"
az functionapp config appsettings set -g "$RG" -n "$FA" --settings "${SETTINGS[@]}" -o none
az functionapp config appsettings delete -g "$RG" -n "$FA" \
  --setting-names SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY JWT_SECRET -o none 2>/dev/null || true

say "Checking"
COUNT="$(az functionapp function list -g "$RG" -n "$FA" --query "length(@)" -o tsv 2>/dev/null || echo "?")"
echo "  functions registered: $COUNT"
echo
echo "Done. Last step, once, in the CRM: Settings → Integrations →"
echo "'Approve for the whole organisation', signed in as a TechZoid Microsoft 365 admin."
