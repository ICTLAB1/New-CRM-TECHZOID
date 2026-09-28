# Provisioning the CRM on Azure

Nothing here touches Supabase or Netlify. The current production CRM keeps
serving throughout, and cutover is a separate, reversible step at the end.

## The short version

```bash
az login
export SOURCE_URL='<the Supabase connection string>'
export JWT_SECRET='<the Supabase project JWT secret>'
export SUPABASE_URL='https://<project>.supabase.co' SUPABASE_SERVICE_KEY='...'

infra/apply-all.sh --plan     # what it would do, touching nothing
infra/apply-all.sh            # steps 1-6
infra/apply-all.sh --cutover  # ...and step 8, the move
```

`infra/apply-all.sh` is the eight steps below with the joins done: it carries
the generated password from step 1 into step 2 without it ever being printed,
opens the database firewall for the machine it is running on and closes it
again however the run ends, refuses to move data onto a schema it cannot
prove matches, and keeps the row dump outside the checkout. Every step is
idempotent, `--from N` resumes, and it will not cut over unless asked in as
many words.

Read the rest anyway before running it on the day. The script automates the
typing, not the judgement.

## The long version

Run these in order; each one prints what the next one needs.

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

## 2. Load the schema — from production, not from this repository

```bash
export SOURCE_URL='<the Supabase connection string>'
export TARGET_URL='postgresql://crmadmin:<password>@<postgresHost>:5432/crm?sslmode=require'

infra/capture-production-schema.sh

psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f supabase/azure/000_bootstrap.sql
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f supabase/azure/production-schema.sql
```

**Not by replaying `supabase/*.sql`.** Those migrations do not describe the
live database: 13 tables, 19 functions, 6 views, 2 sequences and a dozen
triggers exist in production and in no file here, applied through the
Supabase dashboard and never committed. Replaying them builds a database
that cannot hold production's data, and the restore fails partway with the
already-loaded tables looking fine. `docs/SCHEMA-DRIFT.md` has the full list
and how it was found.

**`-v ON_ERROR_STOP=1` on every `psql` line is not optional.** Without it
`psql` prints each error, skips that statement, and exits 0 — a schema that
is quietly incomplete and a script that reported success. That mistake was
made once already during this work and caught only because something counted
afterwards.

`000_bootstrap.sql` is what stands in for Supabase itself: the `auth` schema,
`auth.uid()`, `auth.role()`, and the `anon`, `authenticated` and
`service_role` roles that every policy is written against. It is why not one
policy had to be rewritten.

Then **prove it landed**, rather than assuming:

```bash
infra/compare-schema.sh
```

It fingerprints every table, column, default, constraint, index, function,
trigger, policy and view in both databases and diffs them. An empty diff is
the only evidence worth having. `infra/migrate-data.sh` runs this itself and
refuses to copy anything onto a target that does not match.

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

Rows only; the schema is already there from step 2.

The script compares both schemas first and stops if they differ, refuses to
load onto a non-empty target, restores inside a single
transaction so a failure commits nothing, **compares row counts table by
table** and fails loudly if any differ, and resets the sequences afterwards —
that last step is the one that is easy to forget and that shows up as a
duplicate invoice number in front of a customer.

Supabase is untouched by all of this and keeps serving. If the counts do not
match, nothing has been lost; look at `counts.diff` and run it again.

## 6. Move the attached files

The `attachments` ROWS move with everything else in step 5 — it is just a
table. The BYTES they point at do not, and nothing will notice they are
missing until somebody opens a quotation and the contract is not there.

```bash
export SUPABASE_URL='https://<project>.supabase.co'
export SUPABASE_SERVICE_KEY='...'
export AZURE_STORAGE_ACCOUNT='<storageAccount from step 1>'

infra/migrate-attachments.sh
```

Copies, never moves. Supabase keeps every file, so the old store stays a
working fallback and the script is safe to re-run — it skips what is already
there. It finishes by listing the container and checking it against the
database rather than against its own counters, and refuses to report success
if any row's file is missing.

## 7. Sign-in with Entra ID — optional, and last

The one step that asks something of every user: each person links their
Microsoft account once, by signing in with it.

**Nobody's user id changes.** Entra issues a uuid of its own, and it is not
the one every `owner_id` in your database already holds. Rewriting those
would be a mass update across fifteen tables on live data, and a half-done
one shows up as every salesperson opening an empty CRM. Instead
`profiles.entra_oid` records the Microsoft id beside the existing one and
the API translates on the way in — all 77 policies go on comparing exactly
what they compared before. See `supabase/042_entra_identity.sql`.

In the Azure portal, register an application:

- **Redirect URI** — Single-page application, `https://<staticSiteHost>`
- **Expose an API** — an application ID URI and a scope, e.g. `access_as_user`
- Note the **client id**, the **tenant id** and the scope

Then on the Function App:

```bash
az functionapp config appsettings set -g techzoid-crm -n <functionAppName> --settings \
  JWT_ALG=RS256 \
  JWT_JWKS_URI="https://login.microsoftonline.com/<tenantId>/discovery/v2.0/keys" \
  JWT_ISSUER="https://login.microsoftonline.com/<tenantId>/v2.0" \
  JWT_AUDIENCE="<application ID URI>"
```

`JWT_ISSUER` and `JWT_AUDIENCE` are **not optional here.** The link step
matches a Microsoft account to a CRM user by email address, and an address
only identifies a person inside one company's own directory. Those two
settings are what establish the token came from your tenant, for your
application.

Then rebuild with the third switch:

```bash
VITE_API_BASE=/api VITE_BLOB_STORAGE=on VITE_AUTH=entra \
VITE_ENTRA_CLIENT_ID=<clientId> \
VITE_ENTRA_TENANT_ID=<tenantId> \
VITE_ENTRA_API_SCOPE="<application ID URI>/access_as_user" \
npm run build
```

### The changeover is gradual, on purpose

The API verifies HS256 and RS256, so a Supabase token and a Microsoft token
both work while people are still linking. Somebody in your tenant who is
**not** already a CRM user is refused — being an employee is not the same as
having an account here, and nothing auto-creates one.

Rolling back is dropping `VITE_AUTH` and rebuilding. The `entra_oid` column
stays, harmlessly, so re-doing it later needs no relinking.

## 8. Point the CRM at Azure

Everything so far builds the new home. This is the move.

```bash
VITE_API_BASE=/api VITE_BLOB_STORAGE=on npm run build
npx @azure/static-web-apps-cli deploy dist --deployment-token "$(
  az staticwebapp secrets list -n <staticSiteName> -g techzoid-crm \
    --query properties.apiKey -o tsv)"
```

**Three environment variables, not a code change.** `VITE_API_BASE` moves
the queries, `VITE_BLOB_STORAGE=on` the attachments, `VITE_AUTH=entra` the
sign-in. Leave any of them unset and that part stays where it is.

They are separate on purpose. A bad data cutover shows up immediately, on
every screen. A bad attachment cutover shows up the first time somebody
opens a contract, which might be Thursday. A bad sign-in cutover locks
everybody out at once. Three failure modes, three rollbacks — and blob storage needs the
API tier to sign its URLs, so turning it on alone falls back rather than
failing at the moment somebody opens a file. A cutover that needs a code change needs a
build, a deploy and a rollback plan. A cutover that needs a setting can be
undone by somebody who is not the person who wrote it. The day this is used
will not be a calm day.

`/api` works because the Static Web App has the Function App as a linked
backend: same origin, so no CORS and no cross-site cookie question.

### To roll back

Rebuild without the variable and redeploy. Supabase has not been touched by
any of this and is still holding the same data it was — the migration copies
rows, it does not move them. Nothing needs undoing on the Azure side either;
it simply stops being asked.

### What moved, and what did not

| | after step 6 |
|---|---|
| Customers, quotations, invoices, the whole pipeline | **Azure** |
| The 26 scheduled jobs and webhook handlers | **Azure** |
| Attached files | **Azure Blob Storage** |
| Sign-in | **Entra ID**, once step 7 is done |

That is a deliberate stopping point, not an unfinished one.

**Sign-in stays** because moving it to Entra ID is the one step that makes
every user re-link their account, and it does not have to happen on the same
day as anything else. Supabase Auth issues the token and the Azure API
verifies it with the project's JWT secret — which is why `identity.mjs`
implements HS256 as well as RS256. When you are ready, it is a configuration
change: `JWT_ALG=RS256` plus `JWT_JWKS_URI`, `JWT_ISSUER` and
`JWT_AUDIENCE`, and no code moves.

Each of the three can be reverted without disturbing the others.

### Live updates

Azure has no equivalent of Postgres change subscriptions, so after step 6
there is no live feed. This is not a stale screen: `useWorkspace` polls on a
timer and refetches whenever the tab regains focus, and both were always
there underneath. Expect a slower refresh, not a wrong one. Web PubSub is
the eventual replacement and is not required for anything to work.

## What is still to do after this


- **`admin-users`.** The one handler that did not come across, because it
  manages accounts and accounts are what Entra ID takes over. It answers
  501 with a reason rather than 404.
- **Web PubSub**, if the polling refresh ever proves too slow.

See `docs/AZURE.md` for how each piece was built and tested, and
`docs/SCHEMA-DRIFT.md` for why the schema comes from production rather than
from this repository.
