-- Reading a mailbox, without putting sending at risk.
--
-- WHY A SECOND TOKEN AND NOT A WIDER ONE. Sending holds a refresh token
-- granted for Mail.Send. OAuth lets a refresh ask for a SUBSET of what was
-- consented and rejects a SUPERSET (AADSTS65001), so the moment Mail.Read
-- joins the scope list every existing token stops refreshing — and sendMail
-- reports "your connection has expired" without falling back to Resend. The
-- comment at the top of netlify/lib/mailer.mjs describes this happening
-- once already; it nearly took the company's quotation email offline.
--
-- So reading gets its own grant and its own token, in its own column. A
-- person who never turns the inbox on keeps sending exactly as before, and a
-- read grant that is refused, revoked or never given costs nothing but the
-- inbox.
--
-- Reversible: drop the two columns and reading stops. Sending never knew.

begin;

alter table public.ms_mail_accounts
  add column if not exists read_refresh_token text,
  add column if not exists read_granted_at timestamptz;

/* The token is never readable by a browser. `ms_mail_accounts` has no select
   policy that returns either token — the server holds the service role and
   does the reading — and this states it for the new column too rather than
   leaving it to be inferred from the old one. */
revoke all on public.ms_mail_accounts from anon;

commit;
