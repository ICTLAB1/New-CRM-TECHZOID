-- 018 — document numbers come from the database, not from each browser.
--
-- THE BUG THIS FIXES. The sequence behind a quotation number lived in the
-- shared `settings` row, and the browser bumped it after saving. Two things
-- went wrong with that:
--
--   1. `settings` is writable only by an admin or a manager
--      (settings_update_privileged). A salesperson's bump was rejected, and
--      the rejection was swallowed — so the counter never moved and every
--      quotation they raised carried the same number.
--   2. Even with the rights, read-then-write from two browsers hands the
--      same number to both. A quotation number that is not unique is not a
--      reference; the customer quotes it back at you and nobody knows which
--      document they mean.
--
-- Both go away if the increment happens once, inside the database, in a
-- single statement. This is the same shape as next_customer_code() in 013.
--
-- CONVENTION, PRESERVED. `quoteSeq` means "the number the NEXT document
-- gets", which is what every existing workspace already holds and what the
-- editor reads to preview a number. So this returns the value it found and
-- stores value + 1 — it does not return the incremented value.

create or replace function public.next_doc_seq(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  after integer;
begin
  -- Whitelisted, not interpolated: p_kind reaches a jsonb path, and the
  -- caller is any signed-in user. These are the counters that exist.
  key := case p_kind
           when 'quote' then 'quoteSeq'
           when 'proforma' then 'proformaSeq'
           when 'purchaseOrder' then 'purchaseOrderSeq'
           when 'invoice' then 'invoiceSeq'
           when 'order' then 'orderSeq'
           when 'dispatch' then 'dispatchSeq'
         end;
  if key is null then
    raise exception 'unknown document kind: %', p_kind;
  end if;

  -- A single update, so two callers queue on the row instead of racing.
  -- `greatest(..., 1)` keeps a corrupted or zeroed counter from handing out
  -- number 0, which no document series starts at.
  update public.settings
     set data = jsonb_set(
           coalesce(data, '{}'::jsonb),
           array[key],
           to_jsonb(greatest(coalesce((data ->> key)::integer, 1), 1) + 1)
         ),
         updated_at = now()
   where id = 'main'
  returning (data ->> key)::integer into after;

  -- No settings row means no counter to advance. Null tells the caller to
  -- fall back to its own preview rather than invent a number.
  if after is null then
    return null;
  end if;

  return after - 1;
end;
$$;

revoke all on function public.next_doc_seq(text) from public;
-- Every salesperson raises documents. That is the whole point: the rights
-- to allocate a number are not the rights to edit company settings, and
-- conflating the two is what broke the numbering in the first place.
grant execute on function public.next_doc_seq(text) to authenticated;
