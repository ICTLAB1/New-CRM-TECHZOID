-- Rate limiting for the Netlify Functions.
--
-- SCHEMA CHANGE: adds one table and one function. Nothing else is touched,
-- and no existing table, column or policy changes. Safe to re-run.
--
-- Counted in Postgres rather than in a function's memory because a
-- serverless process is recycled often enough that an in-memory counter
-- limits nothing.

create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- No policy grants any access: only the service role, which bypasses RLS,
-- ever touches this table. A signed-in user has no reason to read it and
-- being able to would leak how often other people are calling the API.
alter table public.rate_limits enable row level security;

-- One atomic step: start or roll the window, increment, and report whether
-- this caller is still inside the limit. Doing it in three statements from
-- the function would let two concurrent requests both read the old count.
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_start timestamptz;
  v_count integer;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set
      window_start = case
        when rl.window_start < v_now - make_interval(secs => p_window_seconds) then v_now
        else rl.window_start
      end,
      count = case
        when rl.window_start < v_now - make_interval(secs => p_window_seconds) then 1
        else rl.count + 1
      end
  returning rl.window_start, rl.count into v_start, v_count;

  return query select
    v_count <= p_limit,
    greatest(0, p_limit - v_count),
    greatest(0, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - v_now))::integer);
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;

-- Housekeeping: rows for windows long past are of no interest.
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);
