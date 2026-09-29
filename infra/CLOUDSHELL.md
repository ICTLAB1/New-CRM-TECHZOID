# Running the migration from Azure Cloud Shell

Cloud Shell is the right place for this: `az` is already signed in as you,
it is inside Azure's network, and nothing about your subscription has to be
handed to anybody. Everything below is copy-and-paste.

Open <https://shell.azure.com>, choose **Bash**.

## 1. Get the code

```bash
git clone https://github.com/ICTLAB1/new-crm-techzoid.git
cd new-crm-techzoid
git checkout claude/crm-redesign-preview
```

## 2. Look before you leap

```bash
infra/apply-all.sh --plan
```

That is the whole command. **Paste one line at a time** — see the warning
below for why.

It asks for the four values it needs, one prompt at a time, and nothing you
type is echoed or kept:

| It asks for | Where it comes from |
|---|---|
| `SOURCE_URL` | Supabase → Project Settings → **Database** → Connection string → **URI** |
| `JWT_SECRET` | Supabase → Project Settings → **API** → JWT Settings → JWT Secret |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API → `service_role` key |

It prompts rather than asking you to `export` them because an `export` line
goes into `~/.bash_history`, which on Cloud Shell is on the persistent share
and outlives the session. If you would rather export them anyway — for an
unattended run — the script uses what is already set and does not ask.

**Use the direct connection string, not the transaction pooler.** Supabase
offers three. `pg_dump` needs a real session, so port **5432** (direct, or
the *session* pooler) works and port **6543** (transaction pooler) does not
— it fails partway through with errors about prepared statements. If direct
connections are refused on your plan, the session pooler string is fine.

`--plan` touches nothing, prints every command it would run, and prints no
secret. Read it. It also checks, before anything exists, that this Cloud
Shell's `pg_dump` is new enough for your Supabase server — if it is not, it
stops and tells you exactly what to install.

### One line at a time

Do not paste a multi-line block that ends in a command which then prompts
you. Everything you paste lands in one input buffer, and a prompt reads
from that same buffer — so the line *after* the command gets taken as the
answer to the first question, and your database password becomes
`export SUPABASE_URL=...`. It fails later, as an authentication error that
points nowhere near the cause.

The script drains anything buffered before each prompt, so it is protected
against this. The habit is still worth having: Cloud Shell, one line, Enter.

## 3. Run it

```bash
infra/apply-all.sh
```

Steps 1–6: resource group, schema, secrets, code, rows, attached files. It
asks before the data move. Expect the Flexible Server alone to take about
eight minutes.

**It does not cut over.** The live CRM on Netlify and Supabase keeps serving
throughout, and everything above is a copy.

## 4. Look at it

```bash
az deployment group show -g techzoid-crm -n crm-infra \
  --query properties.outputs.staticSiteHost.value -o tsv
```

Open that address. It is the CRM, on Azure, still reading Supabase — so what
you are checking is that it loads, signs in and draws.

Then check it against Azure rather than against the old database:

```bash
infra/compare-schema.sh          # every object, both sides
```

## 5. The move, when you are ready

```bash
infra/apply-all.sh --only 8 --cutover
```

It rebuilds the site with `VITE_API_BASE=/api` and `VITE_BLOB_STORAGE=on`,
deploys it, and then **checks that it is actually live** — see below.

Rolling back is the same command without `--cutover`, which rebuilds the
site pointed at Supabase again. Nothing on the Azure side needs undoing — it
simply stops being asked. Supabase still holds every row it did, because
none of this moved anything.

Sign-in with Entra ID is step 7 and is separate; it needs an app
registration made in the portal first. `infra/README.md` has it.

## Deployed is not live

```bash
infra/apply-all.sh --check
```

Runs automatically after every deploy, and on its own whenever you want it.

It makes one real anonymous request to `/api/q` over the live URL. That one
request exercises routing, the function host, the connection string coming
out of Key Vault, the catalog, the translator and the policies — and the
**correct answer is `{"data":[]}`**, because `settings_select_member`
compares against `auth.uid()` and an anonymous caller is nobody. Empty is
the proof that row-level security ran. Rows coming back is the alarming
outcome, and the check refuses to let you cut over on it.

It retries for a couple of minutes, because a Flex Consumption app
cold-starts and the managed identity's role assignment takes a little while
to propagate — until it does, the app starts, serves, and cannot reach the
database. A zip that uploaded perfectly can sit there answering 500, and
nothing in the deployment output would tell you.

What each failure means:

| What you see | What it is |
|---|---|
| `{"data":[]}` | Live. This is the one you want. |
| rows returned | RLS is not applying. **Do not cut over.** `000_bootstrap.sql` did not load, or the API is connecting as a role that bypasses it. |
| 404 | The Static Web App's linked backend is not wired to the Function App, or the zip deployed without registering a function. |
| 500 for two minutes | Almost always the Key Vault reference: `az functionapp config appsettings list -g techzoid-crm -n <app>` and look for `PGCONNECTION_STRING` still showing `@Microsoft.KeyVault(...)` unresolved. |

## If something stops

Every step is idempotent — re-running a finished step detects that and skips
it. To resume where it stopped:

```bash
infra/apply-all.sh --from 5
```

Two failures are worth knowing in advance:

- **`FATAL: no pg_hba.conf entry`** — the firewall. The script opens it for
  Cloud Shell's address and closes it again on the way out, so this means
  your address changed mid-run. Just run it again.
- **`server version mismatch`** — Cloud Shell's `pg_dump` is older than your
  Supabase server. The preflight catches this before step 1, and prints the
  install line.

Anything else: send me the output. The scripts are written to fail loudly
and to refuse to do the next thing, so a stop is safe.
