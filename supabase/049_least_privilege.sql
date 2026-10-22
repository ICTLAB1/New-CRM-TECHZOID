-- Policies that opted out of the scoping the rest of the schema enforces.
--
-- Seventy-seven policies in this database compare against auth.uid() or
-- is_member(company_id). These did not: they granted `authenticated` ALL
-- operations with a USING clause of `true`, which is every signed-in person
-- able to read, change and delete every row.
--
-- NOT A BREACH TODAY, and worth saying so plainly rather than dressing it
-- up: both companies in this database have the same five members, so no
-- data crosses a trust boundary right now, and five of these tables are
-- empty. It is a latent one. The day a contractor, a second team or a third
-- company is added, these tables are already open, and nobody will think to
-- look at them because every other table in the schema is scoped.
--
-- WHY DROPPING THEM IS SAFE RATHER THAN BOLD. Checked, not assumed:
--   * No browser code queries any of these six tables — grepped across
--     src/ for each one.
--   * The server reaches them as `service_role`, which has rolbypassrls,
--     so RLS is not what was letting it in.
-- A policy nothing uses, granting everything to everyone, is worth removing
-- precisely because its absence cannot be noticed until it matters.
--
-- outreach_suppressions is deliberately LEFT ALONE: the browser does read
-- and add to it, and its dangerous operation — deleting somebody's
-- do-not-contact entry — already has no policy permitting it.
--
-- Reversible: recreate any policy below and the old behaviour returns.

begin;

/* Queued notifications. Written by the server, read by the server. */
drop policy if exists notification_outbox_all on public.notification_outbox;

/* Partner applications. */
drop policy if exists partner_profiles_all on public.partner_profiles;

/* The steps of an outreach sequence. Reachable through their campaign,
   which is itself scoped; this policy bypassed that. */
drop policy if exists sequence_steps_all on public.sequence_steps;

/* A do-not-contact list. ALL included DELETE, so any signed-in person could
   remove somebody's opt-out and put them back in a campaign — which is a
   compliance problem before it is a privacy one. */
drop policy if exists suppressions_all on public.suppressions;

/* Email verification results. */
drop policy if exists outreach_verifications_read on public.outreach_verifications;

/* The company's own sending domains. READING stays — the mailbox screens
   show which domain a sender belongs to. Writing is a server job. */
drop policy if exists email_domains_write on public.email_domains;

commit;
