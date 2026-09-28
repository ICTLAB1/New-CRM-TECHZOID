#!/usr/bin/env bash
#
# Put the application's secrets into Key Vault and point the function app at
# them.
#
# NOTHING IS PRINTED. Values are read from your own environment and passed to
# `az` with output suppressed — they do not reach your terminal, your shell
# history, this repository, or a log. That is not decoration: a secret echoed
# into a CI log is a secret that has to be rotated.
#
# Usage:
#   export RESEND_API_KEY=... ANTHROPIC_API_KEY=... (and so on)
#   infra/secrets.sh <resource-group> <key-vault-name> <function-app-name>
#
# Re-runnable. Setting a secret again creates a new version and leaves the
# old one recoverable, which is what you want when a rotation goes wrong.

set -euo pipefail

RESOURCE_GROUP="${1:?usage: secrets.sh <resource-group> <key-vault> <function-app>}"
VAULT="${2:?usage: secrets.sh <resource-group> <key-vault> <function-app>}"
FUNCTION_APP="${3:?usage: secrets.sh <resource-group> <key-vault> <function-app>}"

command -v az >/dev/null || { echo "The Azure CLI is not installed." >&2; exit 1; }

# Secrets: environment variable -> Key Vault secret name.
#
# JWT_SECRET is the Supabase project's JWT secret while sign-in is still
# Supabase. After the Entra ID step it is not needed at all — the RS256
# verifier uses a published key set, which is public by design and is
# configured rather than kept secret.
SECRETS=(
  "ANTHROPIC_API_KEY:anthropic-api-key"
  "RESEND_API_KEY:resend-api-key"
  "INDIAMART_CRM_KEY:indiamart-crm-key"
  "INTERAKT_API_KEY:interakt-api-key"
  "WHATSAPP_API_TOKEN:whatsapp-api-token"
  "MS_CLIENT_SECRET:ms-client-secret"
  "SANDBOX_API_KEY:sandbox-api-key"
  "SANDBOX_API_SECRET:sandbox-api-secret"
  "JWT_SECRET:jwt-secret"
  "SUPABASE_SERVICE_ROLE_KEY:supabase-service-role-key"
)

# Settings that are configuration, not secrets. A tenant id and a client id
# are published in every sign-in redirect; hiding them in a vault buys
# nothing and makes them harder to read when something is misconfigured.
PLAIN=(
  ANTHROPIC_MODEL
  APP_URL
  ALLOWED_ORIGINS
  EMAIL_FROM
  SMTP_HOST
  MS_CLIENT_ID
  MS_TENANT_ID
  MS_REDIRECT_URI
  SANDBOX_API_BASE
  SANDBOX_API_VERSION
)

settings=()
stored=0
skipped=()

echo "Storing secrets in ${VAULT}..."
for pair in "${SECRETS[@]}"; do
  var="${pair%%:*}"
  name="${pair##*:}"
  value="${!var-}"

  if [[ -z "${value}" ]]; then
    skipped+=("${var}")
    continue
  fi

  # --output none, and no echo of $value anywhere.
  az keyvault secret set \
    --vault-name "${VAULT}" \
    --name "${name}" \
    --value "${value}" \
    --output none

  # The function app reads it through a Key Vault reference, so the value
  # lives in exactly one place and rotating it needs no redeployment.
  settings+=("${var}=@Microsoft.KeyVault(VaultName=${VAULT};SecretName=${name})")
  stored=$((stored + 1))
  echo "  stored ${name}"
done

for var in "${PLAIN[@]}"; do
  value="${!var-}"
  if [[ -z "${value}" ]]; then
    skipped+=("${var}")
    continue
  fi
  settings+=("${var}=${value}")
done

if [[ ${#settings[@]} -eq 0 ]]; then
  echo "Nothing was set — no matching variables were exported." >&2
  exit 1
fi

echo "Pointing ${FUNCTION_APP} at them..."
az functionapp config appsettings set \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${FUNCTION_APP}" \
  --settings "${settings[@]}" \
  --output none

echo
echo "${stored} secret(s) stored, ${#settings[@]} setting(s) applied."

if [[ ${#skipped[@]} -gt 0 ]]; then
  echo
  echo "Not set, because they were not exported:"
  printf '  %s\n' "${skipped[@]}"
  echo
  echo "That is fine for anything the CRM does not use yet. It is not fine"
  echo "for JWT_SECRET, which is what verifies every caller's token."
fi

echo
echo "Reminder: the Sandbox API credentials that were pasted into a chat"
echo "earlier should be rotated in the Sandbox console before going live."
echo "Anything that has appeared in a conversation has to be treated as"
echo "known, whatever was done with it afterwards."
