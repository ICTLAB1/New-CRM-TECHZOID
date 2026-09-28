# The repository does not describe production

Found on 28 September 2026, while preparing the Azure migration. Worth
reading before touching either database.

## What is true

`supabase/` contains `schema.sql` and 37 numbered migrations. Replaying them
on an empty PostgreSQL produces **509 objects**.

The live Supabase project has been through 37 migrations too — but not the
same 37. Comparing the two:

| | In production, missing from the repo build |
|---|---|
| Tables | `campaigns`, `enquiries`, `lead_config`, `lead_events`, `lead_submission_throttle`, `leads`, `notification_outbox`, `partner_application_throttle`, `partner_profiles`, `prospects`, `sequence_steps`, `suppressions`, `touches` |
| Functions | `add_working_minutes`, `capture_lead`, `enforce_suppression`, `escalate_overdue_leads`, `import_prospects`, `log_reply`, `mark_lead_contacted`, `on_enquiry_created`, `on_touch_received`, `pick_lead_owner`, `prevent_self_role_escalation`, `queue_next_touch`, `render_merge`, `set_lead_status`, `set_updated_at`, `submit_partner_application`, `submit_website_enquiry`, `suppress_contact`, `touch_lead_updated_at` |
| Views | `v_lead_funnel`, `v_lead_inbox`, `v_lead_scoreboard`, `v_lead_sla_breaches`, `v_outbound_funnel`, `v_send_queue` |
| Sequences | `enquiry_ref_seq`, `lead_events_id_seq` |
| Triggers | ten, including `trg_enquiry_created`, `trg_prospect_suppression`, `trg_prevent_self_role_escalation` |

Production's migration history names them: `outbound_lead_engine`,
`mailer_core_tables`, `lead_inbox_schema`, `public_partner_application_intake`,
`prospect_bulk_import` and others. Those migrations were applied through the
Supabase dashboard and **the SQL was never committed**.

It runs the other way too, though less dangerously. The repo build has seven
tables production does not (migration 038, never applied) and nine extra
columns on `follow_ups`. Those are harmless for a data copy — an unlisted
column takes its default.

Production holds about 330 rows in total, of which roughly 53 are in tables
the repo does not create: 27 prospects, 20 sequence steps, 4 campaigns, 2
lead configs.

## Why it matters

The plan was: build Azure by replaying `supabase/*.sql`, then copy the rows
across. That produces a database missing 13 tables, so the restore fails on
the first row of `prospects` — and the tables that had already loaded would
have looked perfectly fine. The parts of the CRM that read `leads`,
`enquiries` and the outbound engine would have come up empty on a database
that reported a successful migration.

## What was done about it

**The missing migrations are written.** `039_outbound_engine.sql`,
`040_lead_inbox.sql` and `041_profiles_role_guard.sql` reproduce all 13
tables, 6 views, 10 triggers, 19 functions, 2 sequences and every policy,
constraint and index, read back out of the live database.

They are numbered 39–41 although they ran in production long before
`038_crm_objects.sql` was written. The number is build order, not history;
renumbering would edit files already applied elsewhere, which is worse.

**And it is verified, object by object.** Comparing a database built by
replaying all 41 migrations against production:

| Kind | Result |
|---|---|
| policies (105) | identical |
| RLS flags (48) | identical |
| triggers (19) | identical |
| views (7) | identical |
| sequences (2) | identical |
| tables (48) | identical except `follow_ups` — see below |
| constraints, indexes | identical except 2 + 2 on `follow_ups` |
| functions (47) | identical except one — see below |

## What the verification then found, which was not the question asked

**The WhatsApp migrations had never been applied to production.**
APPLIED on 28 September 2026, on request — see "Applying them" below.
`015_followups_whatsapp.sql` and `016_whatsapp_status.sql` are in this
repository and are absent from production's migration history. That accounts
for every remaining difference, in both directions:

- `follow_ups` has nine columns in the repo that production lacks —
  `channel`, `send_to_phone`, `delivery_state`, `delivered_at`, `read_at`,
  `provider_message_id`, `delivery_detail`, `template_name`,
  `template_values` — plus the two check constraints and two indexes on them.
- `regenerate_webhook_secret` accepts a `'whatsapp'` secret kind in the repo
  and only `'main'` and `'inbound'` in production.

So the WhatsApp follow-up code was deployed and the database it needed was
not. Sending one, or rotating its webhook secret, failed.

### Applying them

Both were applied to production on 28 September 2026, through
`supabase.apply_migration` so they are recorded in the migration history
rather than applied invisibly — which is how this drift started.

Both are additive: `add column if not exists` with defaults, guarded
constraints, `create index if not exists`, and one `create or replace
function` that widens an allowed-value list. Nothing dropped, no policy
changed, no row rewritten.

Checked before and after, rather than assumed:

| | before | after |
|---|---|---|
| rows in `follow_ups` | 4 | 4 |
| checksum of existing column values | `d8ce00b6…` | `d8ce00b6…` — unchanged |
| columns | 23 | 32 |
| constraints | 8 | 10 |
| `channel` on existing rows | — | all `email` |
| `regenerate_webhook_secret` code | repo ≠ production | **identical** |

The one thing that still differs is the PHYSICAL COLUMN ORDER of
`follow_ups`, and only that. Production has `company_id` at position 23 and
the nine WhatsApp columns at 24–32; a database built from these migrations
has them the other way round, because here 015 and 016 run before 033 and in
production 033 ran months earlier. Fingerprinted with columns sorted by name
the two are byte-identical (`286f53d9…` both sides): same columns, types,
defaults and nullability.

Nothing depends on it — every write in this codebase names its columns — and
there is no way to change a column's position in PostgreSQL short of
rebuilding the table, which would be a genuine risk taken for a cosmetic
gain. `infra/compare-schema.sh` will keep reporting it, which is correct:
the fingerprint is order-sensitive on purpose, because a column inserted in
the middle on one side and at the end on the other is usually worth seeing.

## Telling a real difference from a formatting one

The first comparison reported **15** functions as differing. Exactly **one**
of them really did.

- 8 differ by **CRLF**: pasted into the Supabase dashboard from a Windows
  editor, so the stored body carries `\r`.
- 6 differ by **comments**: the migration here explains a tricky line in a
  `/* */` block and the copy applied to production had it stripped. One
  differs by a single line break after an opening parenthesis.
- 1 — `regenerate_webhook_secret` — differs in code, for the reason above.

`infra/schema-digest-code.sql` exists because of this. It hashes function
bodies with comments and whitespace normalised away, and
`infra/compare-schema.sh` runs it whenever the strict digest flags a
function, so the output says *"these fifteen differ, and this one differs in
code"* rather than leaving fifteen to read by hand.

It also changed how these migrations are written: the explanations for
tricky lines live **above** `create or replace function`, never inside the
body, so the repository can be commented and still match production byte for
byte. Four functions had to be rewritten that way after the first attempt
put the comments inside.

## The part worth remembering

The first attempt at fixing this was to read the missing pieces out of the
catalog and write them into a migration by hand. It got the tables, then the
constraints, then the indexes, then the policies — and then a function body
turned out to reference `v_send_queue`, a view that had never been on the
list, because nobody had thought to look for views. `pg_dump` has no opinion
about what to look for, which is why `infra/capture-production-schema.sh`
uses it for the Azure build.

The migrations here were still written by hand, because a repository wants
reviewable history rather than a 4,000-line dump. What makes that safe is
not care — it is that the result is checked against production
mechanically. The build caught a `dedupe_key` written as a DEFAULT when
production has it GENERATED, which no amount of re-reading would have found:
both store the same expression in the same catalog column, and only trying
to create the table surfaced it. That gap was in the digest too, and is now
closed.

**A migration you cannot verify is a migration you are guessing at.** The
drift had existed for weeks and nothing surfaced it, because nothing
compared the two.

## Still outstanding

- ~~The two WhatsApp migrations are unapplied in production.~~ Applied
  28 September 2026. `follow_ups` column order differs cosmetically and
  permanently; see above.
- `038_crm_objects.sql` has never been applied anywhere, by design.
- Production's own `supabase_migrations` history still names 37 migrations
  whose SQL is not in this repository. The files here now produce the same
  schema, but the histories will not line up until someone reconciles them
  or adopts a new baseline.
