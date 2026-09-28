# Provisioning the CRM on Azure

Four commands. Run them in order; each one prints what the next one needs.

Nothing here touches Supabase or Netlify. The current production CRM keeps
serving throughout, and cutover is a separate, reversible step at the end.

## 1. Create the resources

```bash
az login
az group create -n techzoid-crm -l centralindia

az deployment group create \
  -g techzoid-crm \
  -f infra/main.bicep \
  -p namePrefix=techzoid postgresAdminPassword="$(openssl rand -base64 24)"
```

`namePrefix` must be 3–9 lowercase letters or digits. Nine is the ceiling
because a storage account name may be 24 characters and the template adds a
kind and a uniqueness suffix.

Generating the password inline means it is never typed, never in your shell
history, and never anywhere but Key Vault — the template writes the whole
connection string there and the function app reads it from there. If you want
it in a password manager, take it out of the vault afterwards rather than
putting it in by hand.

The deployment prints the names of everything it made. Keep that output.

What it creates: PostgreSQL Flexible Server 16 (burstable B1ms, TLS
required, 7-day point-in-time restore), a storage account with an
`attachments` container, Key Vault with RBAC, a Flex Consumption Function
App with a managed identity and exactly three role assignments, Application
Insights, and a Standard Static Web App with the Function App linked as its
backend — so the SPA and `/api` are on one origin and there is no CORS to
configure.

It creates **no application secrets**. That is step 3.

## 2. Load the schema

```bash
export TARGET_URL='postgresql://crmadmin:<password>@<postgresHost>:5432/crm?sslmode=require'

psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f supabase/azure/000_bootstrap.sql
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
for f in supabase/0*.sql; do
  echo "$f"
  psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

**`-v ON_ERROR_STOP=1` on every one of those is not optional.** Without it
`psql` prints each error, skips that statement, and exits 0 — you get a
schema that is quietly incomplete and a script that reported success. This
is a real mistake that was made once during this migration and caught only
because the table count was checked afterwards.

You should end with 43 tables, 100 policies and 64 functions:

```bash
psql "$TARGET_URL" -At -c "select count(*) from information_schema.tables where table_schema='public'"
psql "$TARGET_URL" -At -c "select count(*) from pg_policies where schemaname='public'"
```

`000_bootstrap.sql` is what stands in for Supabase itself: it creates the
`auth` schema, `auth.uid()`, `auth.role()`, and the `anon`, `authenticated`
and `service_role` roles that all 89 policies are written against. That is
why not one migration had to be edited.

## 3. Load the secrets

```bash
export JWT_SECRET='<the Supabase project JWT secret>'
export RESEND_API_KEY=... ANTHROPIC_API_KEY=... INDIAMART_CRM_KEY=...
export APP_URL='https://<staticSiteHost>'

infra/secrets.sh techzoid-crm <keyVaultName> <functionAppName>
```

It reads values from your environment, writes them to Key Vault, and points
the function app at them by reference — so rotating one later is a vault
operation, not a redeployment. **Nothing is printed.** The script lists which
variables it did not find, by name only.

`JWT_SECRET` is the one that must be right: it is what verifies every
caller's token. Everything else degrades to a feature not working.

While you are here: the Sandbox API credentials that were pasted into a chat
earlier should be rotated in the Sandbox console. Anything that has appeared
in a conversation has to be treated as known.

## 4. Deploy the code

```bash
# the API
cd api && npm install && cd ..
az functionapp deployment source config-zip \
  -g techzoid-crm -n <functionAppName> --src <(cd api && zip -qr - .)

# the site
npm run build
npx @azure/static-web-apps-cli deploy dist --deployment-token "$(
  az staticwebapp secrets list -n <staticSiteName> -g techzoid-crm \
    --query properties.apiKey -o tsv)"
```

## 5. Move the data — only when you are ready to cut over

```bash
export SOURCE_URL='<the Supabase connection string>'
export TARGET_URL='<the Azure one>'
infra/migrate-data.sh
```

Rows only; the schema is already there from step 2 and is the proven one.
Copying Supabase's schema instead would bring its roles, extensions and
publication objects, which are exactly what does not exist on Azure.

The script refuses to load onto a non-empty target, restores inside a single
transaction so a failure commits nothing, **compares row counts table by
table** and fails loudly if any differ, and resets the sequences afterwards —
that last step is the one that is easy to forget and that shows up as a
duplicate invoice number in front of a customer.

Supabase is untouched by all of this and keeps serving. If the counts do not
match, nothing has been lost; look at `counts.diff` and run it again.

## What is still to do after this

Provisioning is not the whole migration. See `docs/AZURE.md` for where the
code stands. In particular sign-in is still Supabase Auth: moving it to
Entra ID is the one step that requires every user to link their account
once, and it is best done after the rest is running and settled.
