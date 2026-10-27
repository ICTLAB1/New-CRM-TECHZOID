/*
 * Take the phone number out of the reminder emails' contact line.
 *
 * The line a payment reminder signs off with —
 *   "For any queries, write to accounts@… or call +91 …"
 * — is not in the code. It is one field of one JSON row per company in
 * payment_tracker_settings, edited in Payment tracker → Settings, and the
 * default in src/data/paymentTracker.ts is only what a brand-new row starts
 * as. Changing that default alone would leave every reminder going out
 * exactly as before, which is the whole of what was asked to change.
 *
 * WHAT IT TOUCHES: the contactLine field, only on rows where it invites a
 * call. The address, the rest of the sentence, every other setting and every
 * other row are left alone. A company that never had a phone there is not
 * matched and not rewritten, so running this twice changes nothing the
 * second time.
 *
 * THE PATTERN IS DELIBERATELY FUSSY, because a first version was not and a
 * throwaway Postgres showed what that costs: a phone class that included "."
 * swallowed the sentence's full stop, and one that included trailing spaces
 * turned "…or call +971 50 123 4567 any time." into "…tz.comany time.". So
 * the run must START and END on a phone character — digits, +, (), - — and
 * interior spaces are allowed only between them. Whatever follows the last
 * digit, space included, is left where it was.
 *
 * IT CANNOT FAIL THE DEPLOY. See the note on raising, below.
 *
 * REVERSIBLE in the obvious way: type it back into that field. There is no
 * down migration because restoring a phone number nobody asked to restore is
 * not an improvement on retyping it.
 */

do $$
declare
  /* ", or call" and "or call", then a phone that begins and ends on a phone
     character. Case-insensitive; the leading whitespace goes with it so no
     double space is left behind. */
  pattern constant text :=
    '[[:space:]]*,?[[:space:]]*or[[:space:]]+call[[:space:]]+[-+0-9()]([-+0-9()[:space:]]*[-+0-9()])?';
  touched int;
  skipped int;
begin
  /* NOTHING HERE RAISES. infra/migrate.sh runs with ON_ERROR_STOP=1 under
     set -e, so an exception from this file aborts the entire deploy — far
     too high a price for an edge case in one JSON field. The one way this
     could do harm is by rewriting a line down to nothing, which would drop
     the whole contact line from that company's reminders, so that case is
     excluded in the WHERE below rather than asserted against afterwards.
     Made impossible, not merely detected. */
  select count(*) into skipped
    from public.payment_tracker_settings
   where data ? 'contactLine'
     and data->>'contactLine' ~* pattern
     and btrim(regexp_replace(data->>'contactLine', pattern, '', 'gi')) = '';

  update public.payment_tracker_settings
     set data = jsonb_set(data, '{contactLine}',
                          to_jsonb(regexp_replace(data->>'contactLine', pattern, '', 'gi'))),
         updated_at = now()
   where data ? 'contactLine'
     and data->>'contactLine' ~* pattern
     /* A line that is nothing but the invitation to call. Emptying it would
        remove the contact line altogether, which is more than was asked
        for; it is left as it is and reported. */
     and btrim(regexp_replace(data->>'contactLine', pattern, '', 'gi')) <> '';
  get diagnostics touched = row_count;

  raise notice 'contact line: phone removed from % row(s)', touched;
  if skipped > 0 then
    raise notice 'contact line: % row(s) left alone because the phone was the whole line — edit those in Payment tracker → Settings', skipped;
  end if;
end $$;
