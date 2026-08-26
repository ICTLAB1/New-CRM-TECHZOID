-- Delivery status for WhatsApp follow-ups.
--
-- SCHEMA CHANGE: adds columns to public.follow_ups and widens one existing
-- function by one allowed value. Nothing is dropped, no policy changes, no
-- data is deleted. Safe to re-run.
--
-- WHY THIS EXISTS. Interakt answers the send API the moment it has ACCEPTED
-- a message — not when WhatsApp delivered it. Recording that as "sent" is
-- honest but thin: it says the message left this company and nothing about
-- whether it arrived. Whether it was delivered, read, or failed comes back
-- later on a webhook, and these columns are where it lands.

alter table public.follow_ups
  add column if not exists provider_message_id text not null default '';

-- What the provider last told us. Deliberately NOT merged into `state`:
-- `state` is what the CRM did (queued it, sent it, gave up on it) and is
-- what the scheduler reads to decide what to do next. This is what happened
-- to the message afterwards, out in the world, and nothing in this product
-- may act on it. Two different facts, two columns.
alter table public.follow_ups
  add column if not exists delivery_state text not null default ''
  check (delivery_state in ('', 'sent', 'delivered', 'read', 'failed'));

alter table public.follow_ups add column if not exists delivered_at timestamptz;
alter table public.follow_ups add column if not exists read_at timestamptz;

-- Why it failed, in the provider's own words, for the one case where a
-- salesperson needs to know: the customer blocked the business, or the
-- number is not on WhatsApp at all.
alter table public.follow_ups add column if not exists delivery_detail text;

-- Matched on when a status callback arrives.
create index if not exists follow_ups_provider_msg_idx
  on public.follow_ups (provider_message_id) where provider_message_id <> '';

-- ── the shared secret in the callback URL ───────────────────────────
--
-- Interakt does not sign its webhooks, so there is no HMAC to verify the way
-- there is for the website sync. What authenticates a caller here is the URL
-- itself: a 32-byte random key that only Interakt and this database hold,
-- and which is compared in constant time.
--
-- That makes the callback URL a credential. It is shown to an admin exactly
-- once, when generated, exactly like the other two — and it can be rotated
-- the moment anyone suspects it has been pasted somewhere it should not be.
create or replace function public.regenerate_webhook_secret(p_kind text default 'main')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can regenerate a webhook signing secret';
  end if;

  if p_kind not in ('main', 'inbound', 'whatsapp') then
    raise exception 'Unknown secret kind';
  end if;

  v_secret := encode(gen_random_bytes(32), 'hex');

  insert into public.webhook_secrets (id, secret, rotated_at)
  values (p_kind, v_secret, now())
  on conflict (id) do update set secret = excluded.secret, rotated_at = excluded.rotated_at;

  return v_secret;
end;
$$;
