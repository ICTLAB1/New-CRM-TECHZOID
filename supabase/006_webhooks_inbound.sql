-- Two-way sync: let the company's website send events INTO the CRM.
--
-- SCHEMA CHANGE: adds one table and reshapes one function added by
-- 005_webhooks.sql. No existing table, column or policy changes, and no data
-- is deleted. Safe to re-run. Run 005 before this one.
--
-- 005 gave the CRM an outbound signing secret (the CRM proving to the
-- website that a delivery is genuine). This adds the mirror image: an
-- INBOUND secret, so the website can prove to the CRM that an arriving
-- event is genuine and not from whoever guessed the endpoint URL.
--
-- Both secrets live in the same table under different ids, because they are
-- the same kind of thing and neither may ever be readable by a client — the
-- table still has no client-facing policy at all.

-- The function gained a `kind` argument, so one function serves both
-- secrets. Postgres cannot change a function's arguments in place, so the
-- old no-argument version is dropped first. The default keeps every
-- existing caller working unchanged: `regenerate_webhook_secret()` still
-- means the outbound one.
drop function if exists public.regenerate_webhook_secret();

create or replace function public.regenerate_webhook_secret(p_kind text default 'main')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can regenerate a webhook signing secret';
  end if;

  if p_kind not in ('main', 'inbound') then
    raise exception 'Unknown secret kind';
  end if;

  v_secret := encode(gen_random_bytes(32), 'hex');

  insert into public.webhook_secrets (id, secret, rotated_at)
  values (p_kind, v_secret, now())
  on conflict (id) do update set secret = excluded.secret, rotated_at = excluded.rotated_at;

  return v_secret;
end;
$$;

-- Every event id the CRM has already accepted.
--
-- The sender retries a delivery it did not see a 2xx for — including ones
-- the CRM actually did apply, when the response was lost on the way back.
-- Without this, a retried "deal.created" would create the customer a second
-- time. The event id is the same on every retry by design, so recording it
-- is all that is needed to make applying an event exactly-once.
create table if not exists public.webhook_received (
  event_id text primary key,
  event_kind text not null,
  received_at timestamptz not null default now(),
  status text not null default 'applied' check (status in ('applied', 'ignored', 'failed')),
  detail text
);

alter table public.webhook_received enable row level security;

-- Readable by Admin/Manager so the settings screen can show what has
-- arrived. Written only by the service role, from the receiving function.
drop policy if exists "webhook_received_select_privileged" on public.webhook_received;
create policy "webhook_received_select_privileged" on public.webhook_received for select
  using (public.is_privileged());

create index if not exists webhook_received_at_idx on public.webhook_received (received_at desc);
