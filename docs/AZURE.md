# Moving to Azure

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

## What still has to be built

| Piece | Today | On Azure | Size |
|---|---|---|---|
| Browser → database | 16 direct calls via PostgREST | REST calls to the API tier | **Large** — `src/data/` rewrite, 13 files |
| Sign-in | Supabase Auth, email + password | Entra ID / MSAL | Moderate; every user re-links once |
| Realtime | `supabase_realtime`, 12 tables | Web PubSub, or polling | Moderate — the app already polls every 45s and refetches on focus, so this degrades gracefully |
| Attachments | Supabase Storage bucket | Blob Storage + SAS URLs | Moderate — one file, `src/data/attachments.ts` |
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
