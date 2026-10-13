#!/usr/bin/env bash
#
# Move CRM sign-in to the company's own Microsoft 365 directory
# (techzoidtechnologies.com), where every member of staff already has an
# account and two-step verification. Nobody is a guest any more, so nobody
# is asked to set up verification a second time in another directory.
#
# Run once in Azure Cloud Shell, AFTER signing in to that directory:
#   az login --tenant 7fbedec0-0c39-4028-b5af-5f73a3d65e64 --allow-no-subscriptions --use-device-code
#
# It creates the app registration "TechZoid CRM" there (SPA sign-in to
# crm.ttpldelhi.com, its own API scope access_as_user, v2 tokens), grants
# consent for the whole organisation so nobody sees a permissions prompt,
# and prints the new client id. Send that id to Claude; the deploy does the
# rest (website settings, server settings, re-linking staff on next sign-in).
#
# Safe to run again: it reuses the app if it already exists.
set -euo pipefail

TENANT="7fbedec0-0c39-4028-b5af-5f73a3d65e64"
NAME="TechZoid CRM"
SITE="https://crm.ttpldelhi.com"

CUR="$(az account show --query tenantId -o tsv)"
if [ "$CUR" != "$TENANT" ]; then
  echo "Signed in to the wrong directory ($CUR)."
  echo "Run first:  az login --tenant $TENANT --allow-no-subscriptions --use-device-code"
  exit 1
fi

APP="$(az ad app list --display-name "$NAME" --query "[0].appId" -o tsv)"
if [ -z "$APP" ]; then
  APP="$(az ad app create --display-name "$NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)"
  echo "created app registration $NAME"
else
  echo "reusing app registration $NAME"
fi
OBJ="$(az ad app show --id "$APP" --query id -o tsv)"

# The API scope the website asks for, and v2 tokens (audience = client id).
SCOPE_ID="$(az ad app show --id "$APP" --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv)"
[ -n "$SCOPE_ID" ] || SCOPE_ID="$(cat /proc/sys/kernel/random/uuid)"
az rest --method patch --url "https://graph.microsoft.com/v1.0/applications/$OBJ" \
  --headers "Content-Type=application/json" --body "{
    \"identifierUris\": [\"api://$APP\"],
    \"spa\": { \"redirectUris\": [\"$SITE\", \"$SITE/\"] },
    \"api\": {
      \"requestedAccessTokenVersion\": 2,
      \"oauth2PermissionScopes\": [{
        \"id\": \"$SCOPE_ID\", \"value\": \"access_as_user\", \"type\": \"User\", \"isEnabled\": true,
        \"adminConsentDisplayName\": \"Use TechZoid CRM\",
        \"adminConsentDescription\": \"Sign in to TechZoid CRM and use it as yourself.\",
        \"userConsentDisplayName\": \"Use TechZoid CRM\",
        \"userConsentDescription\": \"Sign in to TechZoid CRM and use it as yourself.\"
      }]
    },
    \"requiredResourceAccess\": [
      { \"resourceAppId\": \"$APP\", \"resourceAccess\": [{ \"id\": \"$SCOPE_ID\", \"type\": \"Scope\" }] },
      { \"resourceAppId\": \"00000003-0000-0000-c000-000000000000\", \"resourceAccess\": [
        { \"id\": \"37f7f235-527c-4136-accd-4a02d197296e\", \"type\": \"Scope\" },
        { \"id\": \"14dad69e-099b-42c9-810b-d002981feec1\", \"type\": \"Scope\" },
        { \"id\": \"e1fe6dd8-ba31-4d61-89e7-88639da4683d\", \"type\": \"Scope\" }
      ] }
    ]
  }" -o none

az ad sp show --id "$APP" -o none 2>/dev/null || az ad sp create --id "$APP" -o none
sleep 15   # a new service principal takes a moment to appear everywhere
for i in 1 2 3 4; do
  az ad app permission admin-consent --id "$APP" -o none 2>/dev/null && break
  sleep 15
done

echo
echo "Done. Send this line to Claude:"
echo "NEW_CLIENT_ID=$APP"
