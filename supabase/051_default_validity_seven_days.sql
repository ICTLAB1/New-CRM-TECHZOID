/*
 * Make a new quotation valid for seven days, to agree with its own terms.
 *
 * WHY THIS IS A MIGRATION AND NOT A ONE-LINE CODE CHANGE. The number of
 * days a new quotation stays valid is settings.data->>'defaultValidityDays',
 * one field of one JSON row per company, edited in Settings. The `?? 7` in
 * src/domain/documents/create.ts is only what applies when that field is
 * absent. Every company in this CRM has it set, so changing the code alone
 * would leave every new quotation dated exactly as before — which is the
 * whole of what was asked to change.
 *
 * WHY SEVEN. The company's own terms, supplied 10 Nov 2026, open with
 * "Quotation Validity: This quotation is valid for 7 days from the date of
 * issue, unless otherwise specified." The Valid Until printed on the face of
 * the document IS that specification, so a fifteen-day date was not a
 * contradiction — but a document whose terms say one thing and whose date
 * says another invites exactly the argument the terms exist to prevent.
 *
 * WHAT IT TOUCHES: the defaultValidityDays field, on every settings row that
 * already carries one. Rows without it are left alone and fall to the code
 * default, which is now also 7. Nothing else in the blob is read or written.
 * Running it twice changes nothing the second time.
 *
 * IT APPLIES TO EVERY COMPANY IN THIS CRM, not only the one whose terms
 * prompted it. That is deliberate — it is the application default — and the
 * export terms carry no validity clause to disagree with. A company that
 * wants a different window sets it in Settings; this does not pin it.
 *
 * REVERSIBLE by typing the old number back into Settings. There is no down
 * migration: restoring a window nobody asked to restore is not an
 * improvement on retyping it.
 */

update public.settings
   set data = jsonb_set(data, '{defaultValidityDays}', to_jsonb(7)),
       updated_at = now()
 where data ? 'defaultValidityDays'
   and data->>'defaultValidityDays' is distinct from '7';
