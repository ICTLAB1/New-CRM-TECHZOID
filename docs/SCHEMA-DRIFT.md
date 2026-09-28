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

**The schema now comes from production, not from the repository.**
`infra/capture-production-schema.sh` runs `pg_dump --schema-only` against
Supabase and writes `supabase/azure/production-schema.sql`, which is what
Azure is built from. `infra/README.md` step 2 was rewritten accordingly.

**And it is verified rather than assumed.** `infra/schema-digest.sql`
fingerprints every table, column, default, constraint, index, function,
trigger, policy and view in a database; `infra/compare-schema.sh` runs it on
both and diffs. `infra/migrate-data.sh` calls it first and refuses to copy
anything onto a target that does not match. Both directions are tested: two
databases built the same way compare identical, and a database missing
objects reports exactly which ones.

## The part worth remembering

The first attempt at fixing this was to read the missing pieces back out of
the catalog and write them into a migration by hand. It got the tables, then
the constraints, then the indexes, then the policies — and then a function
body turned out to reference `v_send_queue`, a view that had never been on
the list, because nobody had thought to look for views. There was no reason
to believe that was the last such surprise.

`pg_dump` has no opinion about what to look for. The reconstruction was
abandoned for it.

The more general point: **a migration you cannot verify is a migration you
are guessing at.** The drift had existed for weeks and nothing surfaced it,
because nothing compared the two. The comparison took an hour to write and
found it immediately.

## Still outstanding

The repository is still not a description of production, and it should be —
`production-schema.sql` records what is there, but the 13 tables and 19
functions have no migration that creates them and no review history. After
the move, the right thing is to reconcile: either write the migrations that
produce what production has, or adopt the captured schema as a new baseline
and number from there.

Until then, treat `supabase/*.sql` as the history of *some* of this database.
