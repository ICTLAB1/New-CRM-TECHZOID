#!/usr/bin/env bash
#
# One-time: let GitHub deploy the server and database changes on every push.
# Run once in Azure Cloud Shell (Bash).
#
# It creates an app registration "TechZoid CRM Deploy" that ONLY GitHub
# Actions runs of this repository's branch can sign in as (a federated
# credential: no password or secret exists anywhere), and allows it to
# deploy to the techzoid-crm resource group and read the database
# connection string from Key Vault.
#
# At the end it prints three ids. They are not secrets; send them to Claude.
set -euo pipefail

RG="techzoid-crm"
REPO="ICTLAB1/New-CRM-TECHZOID"
BRANCH="claude/crm-redesign-preview"
NAME="TechZoid CRM Deploy"

SUB="$(az account show --query id -o tsv)"
TENANT="$(az account show --query tenantId -o tsv)"
RG_ID="$(az group show -n "$RG" --query id -o tsv)"
KV_ID="$(az keyvault list -g "$RG" --query "[0].id" -o tsv)"

APP="$(az ad app list --display-name "$NAME" --query "[0].appId" -o tsv)"
if [ -z "$APP" ]; then
  APP="$(az ad app create --display-name "$NAME" --query appId -o tsv)"
fi
az ad sp show --id "$APP" -o none 2>/dev/null || az ad sp create --id "$APP" -o none
SP="$(az ad sp show --id "$APP" --query id -o tsv)"

if ! az ad app federated-credential list --id "$APP" --query "[?name=='github-branch']" -o tsv | grep -q .; then
  az ad app federated-credential create --id "$APP" --parameters "{
    \"name\": \"github-branch\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:${REPO}:ref:refs/heads/${BRANCH}\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" -o none
fi

# GitHub may present the subject with numeric owner/repo ids appended
# (organisation setting "use immutable ids"). Accept that form too.
OWNER_ID="143274384"
if ! az ad app federated-credential list --id "$APP" --query "[?name=='github-branch-ids']" -o tsv | grep -q .; then
  az ad app federated-credential create --id "$APP" --parameters "{
    \"name\": \"github-branch-ids\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:ICTLAB1@${OWNER_ID}/New-CRM-TECHZOID@1344007576:ref:refs/heads/${BRANCH}\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" -o none
fi

for i in 1 2 3 4 5 6; do
  az role assignment create --assignee-object-id "$SP" --assignee-principal-type ServicePrincipal \
    --role "Contributor" --scope "$RG_ID" -o none 2>/dev/null && break
  sleep 10   # a brand-new service principal takes a moment to appear
done
az role assignment create --assignee-object-id "$SP" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$KV_ID" -o none 2>/dev/null || true

echo
echo "Done. Send these three lines to Claude:"
echo "AZURE_CLIENT_ID=$APP"
echo "AZURE_TENANT_ID=$TENANT"
echo "AZURE_SUBSCRIPTION_ID=$SUB"
