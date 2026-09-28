# Moving to Azure

> **RESUMED — 28 September 2026, at the owner's request.** The CRM still
> runs on Supabase and Netlify; nothing has moved. What follows below the
> next block is the original parking note, kept because its reasoning is
> still the honest argument against.
>
> **Re-verified on the CURRENT schema, not the one this was written for.**
> The note below says 21 migrations and 17 functions; there are now 37 and
> 26. Rebuilt from scratch on a plain PostgreSQL 16 with no Supabase
> present: bootstrap, schema, then every migration in order — **all clean.
> 43 tables, 100 policies, 64 functions.** The identity gate's 11 tests
> pass against it, leak test included.
>
> One thing had rotted, and only running it showed which: the gate's test
> SEED predated migration 033. Every policy now reads `is_member(company_id)`
> before it looks at ownership, so a customer seeded with no membership is
> invisible to everyone including an Admin — the gate looked broken while
> behaving exactly as designed. The seed now creates memberships. Nothing
> in the bootstrap or the gate itself needed changing.
>
> **The original reasoning, which still stands as the case against:**
>
> - **Nothing that was going wrong was caused by the platform.** The failures
>   that day were a misplaced test file and a type error, both breaking the
>   Netlify build; wrong dashboard figures from currency handling and a deal
>   that could not be un-won. Supabase and Netlify caused none of it.
> - **The data is already in Mumbai.** The Supabase project is `ap-south-1`,
>   so residency was never a reason to move.
> - **It costs more** for the same product, and the weeks it would take are
>   weeks not spent on the outreach module the business actually asked for.
> - **Two silent-breakage bugs turned up in a 170-line bootstrap alone.** The
>   remaining surface — 13 data files, Entra ID, Web PubSub, Blob Storage,
>   Bicep, cutover — has far more of them, and each one lands on a live CRM.
>
> **What the work bought, and why it stays in the repo:** the schema is
> proven to run on plain PostgreSQL and the identity gate is written and
> tested. That is the hard part, done. If a government or PSU tender ever
> requires Azure hosting, or the Microsoft partnership makes it worth it, or
> Supabase changes its terms, this is no longer a rewrite — it is a resumed
> project. That optionality is worth more sitting unused than the cost of
> keeping it.
>
> **If it is ever resumed**, start at "What still has to be built". Nothing
> below has been undone and nothing here touches production.

Target: **Azure Database for PostgreSQL Flexible Server**, an **Azure Functions**
API tier, **Static Web Apps** for the front end, **Entra ID** for sign-in,
**Blob Storage** for attachments, **Key Vault** for secrets.

## What is already proven

Not designed — run. Against a real PostgreSQL 16 with no Supabase present:

- `supabase/azure/000_bootstrap.sql`, then `schema.sql`, then **all 21
  migrations in order — every one applied clean**.
- All **89 RLS policies** and **99 `auth.uid()` call sites** work
  **completely unchanged**.
- Authorization enforces correctly:

  | | result |
  |---|---|
  | Ravi (Sales) sees his own customer | 1 |
  | Meena (Sales) sees Ravi's customers | **0** |
  | Meena tries to overwrite them | **UPDATE 0** |
  | Admin sees every customer and quote | 1, 1 |
  | `is_privileged()` — Admin / Sales | true / false |
  | `anon` reads `portal_tokens` | **permission denied** |
  | `anon` calls `next_doc_seq` | **permission denied** |
  | Signed-in role with no user id set | **0 rows** |
  | Security-definer counters for a signed-in user | `Q/1`, `CUST-000001` |

## Why the migrations did not have to change

Supabase supplies four things plain Postgres does not: the `anon` /
`authenticated` / `service_role` roles, an `auth` schema whose `uid()` reads
the signed-in user from a JWT, a `storage` schema, and the
`supabase_realtime` publication.

The bootstrap supplies all four. Rewriting 99 call sites by hand would have
been 99 chances to get an authorization rule subtly wrong, on the exact code
that decides who can read whose customers. Supplying what they expect is a
smaller and far more reviewable surface.

One incompatibility was found this way and only this way: `schema.sql`
installs a `handle_new_user()` trigger reading `new.raw_user_meta_data`, a
Supabase-specific column. The shim's `auth.users` now carries it, and the
trigger runs untouched.

## THE CONTRACT THE API TIER MUST HONOUR

Every request that touches the database must run inside a transaction that
first stamps the caller's identity:

```sql
begin;
  set local role authenticated;                      -- or anon
  set local request.jwt.claim.sub  = '<user uuid>';  -- from the Entra token
  set local request.jwt.claim.role = 'authenticated';
  -- ... the caller's query ...
commit;
```

**`set local`, never `set`.** It is scoped to the transaction, so a pooled
connection cannot carry one user's identity into the next request. That is
the single mistake in this architecture that would be catastrophic *and
silent* — everyone would see everyone's data and nothing would error. It is
tested: after `commit`, `auth.uid()` returns `(none)`.

Two more rules that follow from it:

- **Never `set local role service_role` on a request-handling path.** It has
  `BYPASSRLS`. It exists for the trusted server jobs — the scheduled sender,
  the portal endpoints, webhook receivers — and for nothing a browser can
  reach.
- **A missing user id must fail closed.** `auth.uid()` returns NULL, every
  policy matches nothing, and the caller gets zero rows rather than
  everything. Verified above.

## Step 2 — the identity gate (built)

`api/lib/db.mjs` is the only door to the database. Every query runs through
`asUser` / `asAnon` / `asService`, each of which opens a transaction and
stamps the caller before the query runs. There is no path that reaches the
database without an identity, because a query RLS cannot judge is a query
that should not run.

Eleven tests against the real schema, all passing, including:

- **the leak test** — 25 alternating requests through a shared pool, with the
  connection checked for a stale identity after every one. Clean each time.
- a thrown error still hands back a clean connection, and rolls the work back
- an unauthenticated caller gets **0 rows, not all rows**
- an identity that is not a uuid is refused **before** it reaches the
  database — it goes into a `SET LOCAL`, which takes a literal rather than a
  bind parameter, and that is exactly the shape SQL injection likes

Two real gaps in the bootstrap were found only by running this, and both
would have broken production silently:

1. **`BYPASSRLS` is not a GRANT.** `service_role` skips row-level security,
   but table privileges are checked first and separately. Without a grant on
   `auth.users` the API tier cannot create a user row on first Entra
   sign-in — every new user would fail with "permission denied".
2. **`anon` needs USAGE on the `auth` schema.** Every ownership policy calls
   `auth.uid()` even when the caller is anonymous — that is how it evaluates
   to NULL and matches nothing. EXECUTE on the function is not enough; it is
   only reachable through schema usage. Without it an anonymous request
   errors instead of quietly seeing no rows, which would have taken the
   customer portal and the public registration form down.

## Step 3 — the replacement for PostgREST (built)

What Supabase was actually providing, beyond the database, was PostgREST: a
process that turned a URL into SQL, ran it as the signed-in user, and let the
policies decide what came back. Azure sells no equivalent, so leaving
Supabase means writing that. It is written, and it is three files.

`api/lib/query.mjs` turns a query description into parameterised SQL. Cut
down to what the CRM actually uses rather than the whole of PostgREST, which
turned out to be a much smaller surface than expected: five operations,
twelve builder methods, two embedded selects, seven stored functions.

Nothing from the caller is ever interpolated. Values become bind parameters;
identifiers — table, column, operator, direction — are not escaped but
**checked against the live catalog**, and the catalog's own spelling is what
gets emitted. A column name that does not exist never reaches the database in
any form. Authorisation is not decided there at all: it runs inside
`asUser`/`asAnon` and the policies already in the database do the judging.

`src/data/db.ts` is the surface written out as an interface — which is how
the size of the job got answered at all, because nineteen files typed against
`SupabaseClient` tell you nothing about how much of Supabase they use.

`src/data/pgClient.ts` offers that same builder to the browser and composes
the JSON instead of a URL, **so no call site in `src/data/` changes**. That
was the point. Hand-translating fifty-five call sites into bespoke fetches is
a few thousand lines each of which could drop a filter, and a dropped
`.eq("company_id", …)` does not throw — it shows one company another
company's customers.

### What was proven, and how

| Proof | Where |
|---|---|
| A hostile query description cannot become SQL — nine attack shapes refused, and a hostile *value* bound rather than rejected | `api/lib/query.test.mjs` |
| The 89 policies still decide who sees what, with PostgREST gone | same |
| Each of the twelve builder methods behaves as PostgREST did | same |
| The builder composes what the call site asked for, and a branched query does not leak its sibling's filters | `src/data/pgClient.test.ts` |
| The live Supabase client really has every method it is cast to | `src/data/supabaseAsDb.test.ts` |
| **The real `createStore` runs on plain PostgreSQL with no Supabase in the path**, and still hides one salesperson's customers from another | `src/data/azureEndToEnd.test.ts` |

That last one is the one that matters. Every other test checks a link; it
checks the chain. All of them skip when no database is configured, so CI
without one stays green rather than red for the wrong reason.

### What it cost

Four bugs, all caught by tests rather than by reading:

- `array_agg` over a `name` column comes back from node-pg as a string, not
  an array, so the catalog's key columns were unusable.
- `jsonb_build_object` is variadic-any; a bind parameter in the key position
  needs an explicit cast or Postgres refuses to plan the query.
- A first attempt at a compile-time proof that Supabase satisfies `Db` emitted
  runtime code referencing a compile-time-only binding, and took down three
  test files at import. A proof that runs is not a proof.
- An end-to-end assertion compared two `Date` objects with `toBe` and so
  passed whatever the database did. Replaced with the exact expected stamp.

And one thing that could not be had: a compile-time proof that
`SupabaseClient` satisfies `Db`. It is true, and the compiler will confirm it
in a file of its own — but not once anything else in the build has spent the
instantiation budget on Supabase's generics, at which point the same proof
stops compiling for reasons unrelated to it. A check that depends on what
else is in the build is not a check, so it is a runtime conformance test
instead, with the gap it leaves stated in the file rather than papered over.

## Step 4 — the two endpoints (built)

`POST /api/q` for queries, `POST /api/rpc` for stored functions. Together
they are what the browser talks to instead of PostgREST.

Every request goes through the same five checks, in this order:

1. **Method and content type** — a plain HTML form on another site cannot
   set `application/json`, so it is turned away before anything reads a body.
2. **Size** — the declared `content-length` first, so an oversize body is
   refused without being read, then the actual bytes, because the header is
   whatever the caller wrote there.
3. **The token** — verified, never merely decoded. See below.
4. **`asUser(verified id)` or `asAnon()`** — opens a transaction and stamps
   the identity with `SET LOCAL` so the policies can judge it.
5. **The translator, or the RPC whitelist.**

There is no step where a user id is taken from the request body, and no step
where a query runs on a connection with nobody's identity on it.

### Who is calling — `api/lib/identity.mjs`

The most security-critical file in the migration. Everything downstream is
correct only if the id handed to `asUser` is one the caller actually proved.

**The signature is checked before the payload is believed.** A JWT is three
pieces of base64 anybody can type; the claims inside are a request, not a
fact. Nothing reads `sub` before `verify` has run.

**The algorithm is not taken from the token.** That is the classic break on
hand-written JWT code: `alg: "none"` skips verification, and an `HS256`
token aimed at an RS256 verifier lets an attacker HMAC-sign with the public
key — which is public. The expected algorithm comes from configuration and a
mismatch dies first.

Both algorithms are implemented, because this migration has two sign-ins:
HS256 for Supabase today, RS256 with a fetched-and-cached JWKS for Entra ID
after cutover, including the key-rotation case. The switch is then
configuration, not a rewrite on the day.

The tests are almost entirely attack cases — thirty-one of them, each a real
published break of somebody else's verifier: `alg: none`, both directions of
algorithm confusion, a tampered payload with a valid signature, wrong secret,
wrong key, expired, no expiry at all, not-yet-valid, wrong issuer, wrong
audience, and a subject that is not a user id.

One distinction worth stating because getting it backwards is silent:
**a missing token is anonymous; an invalid token is refused.** The
registration form and the customer portal are meant to work signed out and
do, as `anon`, seeing nothing. Falling back to anonymous on a *bad* token
would make a forged one work on every public path.

### What may be called — `api/lib/rpc.mjs`

PostgREST exposed `/rpc/<name>` for every function in the schema. Copying
that as "take the name from the request and call it" would be remote code
execution with a public door on it — `pg_read_file`, `pg_sleep`, every
`SECURITY DEFINER` helper, and anything a future migration adds without
anyone thinking about it.

Eight functions are callable, each with the exact argument names the CRM
sends, using named notation so the two overloads of `next_doc_number`
resolve by what was actually passed. Deliberately absent:
`consume_rate_limit` and `may_manage_email_account` — both real, both
called, but by the scheduled jobs, which run as `service_role`. A browser
has no business asking the database whether it has exhausted its own rate
limit.

The whitelist is checked **before a connection is taken**, so a flood of
requests naming functions that do not exist costs no transactions.

### Errors

Postgres errors pass through with their message and SQLSTATE, because that
is what PostgREST did and the CRM reads them — "duplicate key" becomes "a
company by that name already exists" on screen. `detail`, `hint` and `where`
do not: `where` carries the body of the function that failed, which is
internals. Anything with no SQLSTATE is a bug here, and the browser gets a
flat 500 while the real error goes to the log. A stack trace in a response
is a map of the server drawn for whoever asked.

### What was proven

| Proof | Where |
|---|---|
| Thirty-one forged, expired, confused and tampered tokens, all refused | `api/lib/identity.test.mjs` |
| JWKS fetching, caching, and one refetch on rotation — but not unbounded refetching for a key that does not exist | same |
| Six off-whitelist function names refused, including the two the scheduled jobs use | `api/lib/http.test.mjs` |
| **Two valid tokens, two people, one query — each answered as themselves** | same |
| A database refusal passing through with its SQLSTATE and without its internals | same |
| `/api/q` reaches the query handler and `/api/rpc` the RPC one | `api/src/functions/register.test.mjs` |
| **The whole CRM over a real socket**: real store, real client, real `fetch`, real handlers, real policies — still hiding one salesperson's customers from another | `src/data/apiOverHttp.test.ts` |

That last one closes the gap Step 3 left open. Until it existed, nothing
proved that what the browser client puts on the wire is what the endpoint
expects to read off it — a field renamed on one side type-checks on both and
fails only when a request is actually sent.

### Deploying them

The Functions app is `api/`, with its own `package.json` and `host.json`, and
is what Static Web Apps expects to find. Same origin as the SPA, so there is
no CORS to configure and no third-party cookie to worry about.

`authLevel` is `anonymous` on both routes. That is not "no authentication" —
it means no function key. Authentication is the bearer token. A function key
would be a second shared secret whose only possible home is the browser
bundle, where it is not a secret at all.

Configuration, all through app settings or Key Vault, none of it in the
repository:

| Setting | Today | After the Entra ID step |
|---|---|---|
| `PGCONNECTION_STRING` | — | Flexible Server, TLS on |
| `JWT_ALG` | `HS256` | `RS256` |
| `JWT_SECRET` | the Supabase JWT secret | — |
| `JWT_JWKS_URI` | — | the tenant's discovery keys |
| `JWT_ISSUER` / `JWT_AUDIENCE` | optional | set both |

`src/data/apiClient.ts` builds the browser client against these endpoints and
is **not switched on**: `store()` still binds to Supabase. The cutover is one
line, deliberately left for the day the Azure resources exist.

## Step 5 — the switch (built)

`src/data/backend.ts`. One environment variable, `VITE_API_BASE`: set it and
every query and stored-function call goes to the Azure API tier; leave it
unset and nothing moves.

An environment variable rather than a code change, because a cutover that
needs a code change needs a build, a deploy and a rollback plan, while a
cutover that needs a setting can be undone from a hosting console by
somebody who is not the person who wrote it.

Getting there meant moving 31 call sites across eight files off
`getSupabase()` and four more inside files that also use auth, storage or
realtime. The compiler found things Supabase's types had been hiding:

- **`.or()` was in use and unsupported.** One call site — the prospect
  search, matching email or company or name in a single query so the count
  comes back right. An earlier survey of the builder surface had missed it.
  It is now in the translator, bracketed so `a and (b or c)` cannot decay
  into `a and b or c`, bounded against nesting, and with every column and
  operator inside still checked against the catalog. The PostgREST filter
  string is parsed in the BROWSER, so the server never parses caller text.
- **Fifteen rows were being read untyped.** Supabase's client returns `any`,
  so `String(r.email ?? "")` looked like belt and braces. It was in fact the
  only thing between a renamed column and a screen full of "undefined". The
  narrower interface makes each one an explicit cast at the boundary.
- **One `.storage.from(BUCKET)` sat directly under a `getSupabase()`**, in
  among the query calls being switched. A mechanical replace would have
  pointed file downloads at the query endpoint. Every switched line was
  checked against the line below it before being changed.

### What deliberately did not move

Sign-in stays on Supabase Auth, and attachments on Supabase Storage. Both
are separate changes with separate risks, and the token path already works
across the boundary — Supabase issues it, the Azure API verifies it with
HS256, and `identity.mjs` implements RS256 alongside precisely so identity
can move on a different day. `infra/README.md` step 6 has the detail and the
rollback.

## Step 6 — attachments (built)

Supabase Storage answered three questions for the browser — write these
bytes, give me a link that expires, delete them — and decided who was
allowed to by running its own bucket policies. Azure Blob Storage does the
first three and has no opinion about the fourth.

`src/data/storage.ts` is the seam: three operations, two implementations,
and `attachments.ts` no longer knows which is behind it.

### Who is allowed, and where that is decided

Not in the browser, and not in a second set of rules:

- **Read.** `/api/blob` looks the `attachments` row up AS THE CALLER before
  signing anything, so the policies that decide whether somebody may see an
  attachment in a list decide whether they may open it. No row, no link —
  and the answer is identical to the one for a file that does not exist,
  because otherwise this becomes a way to ask whether a path is real.
- **Write.** No row exists yet, so there is nothing to ask. The rule is the
  one Supabase's bucket policy enforced: the first path segment is your own
  user id. Checked against the verified token, never the request body. The
  SAS is create-only (`c`, not `w`), so an upload cannot overwrite.
- **Delete.** The row is deleted first, as the caller, so the policies
  choose which. Only the paths that came back are removed from the store,
  and if that fails the transaction rolls back and the rows return. This is
  **stricter than the Supabase version**, which deleted the object first and
  could leave a row pointing at nothing.

### The bytes do not go through the API

The browser gets a signed URL scoped to one blob and talks to Azure
directly. A 20MB contract routed through a Function would be 20MB in and
20MB out, billed by the second, for no benefit — the permission decision is
the part that needs a server, and it is the only part that goes there.

The SAS is a **user-delegation SAS**, signed with a key fetched from Entra
ID by the function app's managed identity, because the storage account has
shared-key access disabled outright. There is no account key in this system
to leak, and a leaked SAS is one file for a few minutes.

### What was proven

`api/lib/blob.test.mjs` stubs the Azure SDK and keeps everything else real —
real tokens, real database, real policies. That split is the point: the SDK
call either works or throws, while the questions worth asking are whether
one salesperson can open another's signed contract (no), whether anyone can
write into somebody else's folder (no), and whether a failed byte-delete
leaves an orphaned row (no, the transaction rolls back).

`src/data/blobStore.test.ts` covers the wire protocol, including the
`x-ms-blob-type: BlockBlob` header that Azure requires on every block-blob
PUT and rejects the request without — a missing header there is a file the
user watches fail to upload for no visible reason.

### Its own switch

`VITE_BLOB_STORAGE=on`, separate from `VITE_API_BASE`. Two migrations with
two failure modes: a bad data cutover shows on every screen at once, a bad
attachment cutover shows the first time somebody opens a contract. Rolling
one back without the other is worth a second setting.

`infra/migrate-attachments.sh` copies the existing bytes across. It copies
rather than moves, skips what is already there, and verifies by listing the
container against the database rather than trusting its own counters.

## What still has to be built

| Piece | Today | On Azure | Size |
|---|---|---|---|
| Browser → database | ~~16 direct calls via PostgREST~~ | **Done** — Steps 3 and 5 | — |
| The HTTP endpoints in front of the translator | ~~—~~ | **Done** — see Step 4 | — |
| Sign-in | Supabase Auth, email + password | Entra ID / MSAL | Moderate; every user re-links once |
| Realtime | `supabase_realtime`, 12 tables | Web PubSub, or polling | Moderate — and now **optional**: the change feed is a separate argument to `createStore`, and a store without one falls back to the poll and the refetch-on-focus that were always underneath it |
| Attachments | ~~Supabase Storage bucket~~ | **Done** — see Step 6 | — |
| Scheduled sender | `netlify.toml` cron | Functions timer trigger | Small |
| Netlify Functions | 17 `.mjs` handlers | Azure Functions | Small — same Node, different envelope |
| Secrets | Netlify env vars | Key Vault | Small |

## Cost, honestly

Flexible Server (even burstable B1ms), Static Web Apps, a Function App, Web
PubSub and Key Vault together cost materially more per month than the
current Supabase tier. Price it against what Supabase bills today before
committing — the technical case is sound, the financial one is yours.

## What this does NOT do

Nothing here bypasses anything, and no data has moved. The existing
production database is untouched. This is the schema proven to run on Azure
plus the contract the API tier must meet — the data migration itself
(`pg_dump` from Supabase, restore into Flexible Server, verify row counts)
comes at cutover.
