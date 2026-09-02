-- 029 — a mailbox connected today must appear on the campaign screen.
--
-- THE BUG. 023 introduced `email_accounts` because one mailbox per person was
-- the wrong shape — a shared sales@ that several people may send from cannot
-- be keyed `user_id primary key`. It carried the existing `ms_mail_accounts`
-- rows across so nobody had to reconnect, and that copy was a ONE-TIME
-- statement inside the migration.
--
-- The OAuth callback was never changed. It still writes only to
-- `ms_mail_accounts`. So every mailbox connected AFTER 023 ran exists in the
-- old table and not the new one — quotation email keeps working, because the
-- mailer resolves a sender through `ms_mail_accounts`, while the campaign
-- composer reads `my_sending_accounts()` over `email_accounts` and reports
-- "no mailbox connected" to somebody who has just connected one and been
-- told it worked. Which is precisely what happened: three mailboxes carried
-- over at 06:21, a fourth connected at 10:31 and appeared nowhere.
--
-- WHY A TRIGGER RATHER THAN FIXING THE CALLBACK. Fixing the callback fixes
-- the one writer that exists today. The failure was structural — two tables
-- holding the same fact, and a writer that knew about one of them — and the
-- next writer would reintroduce it. A trigger holds the invariant in the
-- place both writers have to go through.
--
-- The old table stays the one that is written. It is what the quotation
-- mailer reads, and this is not the change to start moving that.
--
-- SCHEMA CHANGE: one function, three triggers, and a backfill for anything
-- already missed. Safe to re-run.

create or replace function public.mirror_ms_mailbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_domain text;
  v_domain_id uuid;
begin
  if tg_op = 'DELETE' then
    /* Disabled rather than deleted. A campaign may name this mailbox, and
       "which mailbox did that go out from" should still have an answer after
       somebody disconnects. Reconnecting clears it again below. */
    update public.email_accounts
       set disabled_at = now(), updated_at = now()
     where lower(email) = lower(btrim(coalesce(old.ms_email, '')))
       and disabled_at is null;
    return old;
  end if;

  v_email := lower(btrim(coalesce(new.ms_email, '')));
  if v_email = '' then return new; end if;

  /* The domain, so a mirrored mailbox is grouped like a carried-over one
     rather than sitting outside the domain health screen. */
  v_domain := split_part(v_email, '@', 2);
  if v_domain <> '' then
    /* LOOK FIRST, INSERT ONLY IF ABSENT — not ON CONFLICT. `email_domains_key`
       is another unique index on an expression, lower(domain), so
       `on conflict (domain)` matches nothing and raises. Same trap as the
       one below, and as the one 028 exists to fix. */
    select id into v_domain_id from public.email_domains where lower(domain) = v_domain;
    if v_domain_id is null then
      insert into public.email_domains (domain) values (v_domain)
      returning id into v_domain_id;
    end if;
  end if;

  /* UPDATE-THEN-INSERT rather than ON CONFLICT, deliberately.
     `email_accounts_key` is a unique index on lower(email) — an EXPRESSION
     index — and Postgres matches ON CONFLICT against the target as written,
     so `on conflict (email)` would find nothing and raise. That exact
     mismatch is what 028 was written to fix elsewhere; this avoids it rather
     than repeating it. */
  update public.email_accounts
     set display_name  = coalesce(nullif(new.ms_display_name, ''), display_name),
         refresh_token = new.refresh_token,
         connected_by  = new.user_id,
         provider      = 'microsoft',
         domain_id     = coalesce(domain_id, v_domain_id),
         status        = 'ok',
         status_detail = '',
         disabled_at   = null,
         last_ok_at    = now(),
         updated_at    = now()
   where lower(email) = v_email;

  if not found then
    insert into public.email_accounts
      (email, display_name, connected_by, refresh_token, provider, domain_id, last_ok_at)
    values
      (v_email, coalesce(new.ms_display_name, ''), new.user_id, new.refresh_token,
       'microsoft', v_domain_id, now());
  end if;

  return new;
end; $$;

drop trigger if exists ms_mail_accounts_mirror_ins on public.ms_mail_accounts;
create trigger ms_mail_accounts_mirror_ins
  after insert on public.ms_mail_accounts
  for each row execute function public.mirror_ms_mailbox();

drop trigger if exists ms_mail_accounts_mirror_upd on public.ms_mail_accounts;
create trigger ms_mail_accounts_mirror_upd
  after update on public.ms_mail_accounts
  for each row execute function public.mirror_ms_mailbox();

drop trigger if exists ms_mail_accounts_mirror_del on public.ms_mail_accounts;
create trigger ms_mail_accounts_mirror_del
  after delete on public.ms_mail_accounts
  for each row execute function public.mirror_ms_mailbox();

-- ── catch up on anything connected since 023 ──────────────────────────
insert into public.email_domains (domain)
select distinct split_part(lower(btrim(m.ms_email)), '@', 2) as d
from public.ms_mail_accounts m
where coalesce(m.ms_email, '') <> ''
  and split_part(lower(btrim(m.ms_email)), '@', 2) <> ''
  and not exists (
    select 1 from public.email_domains e
     where lower(e.domain) = split_part(lower(btrim(m.ms_email)), '@', 2)
  );

insert into public.email_accounts
  (email, display_name, connected_by, refresh_token, provider, domain_id, last_ok_at)
select lower(btrim(m.ms_email)), coalesce(m.ms_display_name, ''), m.user_id,
       m.refresh_token, 'microsoft',
       (select d.id from public.email_domains d
         where lower(d.domain) = split_part(lower(btrim(m.ms_email)), '@', 2)),
       m.connected_at
from public.ms_mail_accounts m
where coalesce(m.ms_email, '') <> ''
  and not exists (
    select 1 from public.email_accounts a
     where lower(a.email) = lower(btrim(m.ms_email))
  );
