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

## What still has to be built

| Piece | Today | On Azure | Size |
|---|---|---|---|
| Browser → database | ~~16 direct calls via PostgREST~~ | **Done** — see Step 3 | — |
| The HTTP endpoints in front of the translator | — | Two Azure Functions, `/api/q` and `/api/rpc` | Small — the hard part is written and tested |
| Sign-in | Supabase Auth, email + password | Entra ID / MSAL | Moderate; every user re-links once |
| Realtime | `supabase_realtime`, 12 tables | Web PubSub, or polling | Moderate — and now **optional**: the change feed is a separate argument to `createStore`, and a store without one falls back to the poll and the refetch-on-focus that were always underneath it |
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
