-- Take the broken image out of follow-ups that have not gone yet.
--
-- WHY A MIGRATION AND NOT A DEPLOY. A follow-up's message is written and
-- previewed when it is ARMED, and stored on the row: the 10am job sends
-- what is there rather than re-rendering it, so that what a salesperson
-- approved is what the customer receives. That is the right design and it
-- means a code fix cannot reach a message already in the queue. Every
-- follow-up armed before today still carries the address that produced a
-- grey box with a question mark in it, under the signature, where the
-- partner badges belong.
--
-- WHAT WAS WRONG WITH THE ADDRESS. `absoluteUrl` hands a path back
-- unchanged when there is no origin to put in front of it, so the
-- signature strip could be written as "/brand/email-signature.png". That
-- is fine on a screen and meaningless in an inbox, which has no page to
-- resolve it against. Fixed in the code for everything armed from now on;
-- this is for what is already waiting.
--
-- ONLY THE TAG, AND ONLY WHERE IT IS RELATIVE. An <img> whose src starts
-- with a slash is removed; one pointing at https is left exactly as it is,
-- so the logo, the vendor panels and a correctly-addressed strip all
-- survive. The rest of the message — every word a salesperson approved —
-- is untouched. What goes is an image that could only ever have rendered
-- as a broken-image icon.
--
-- AND ONLY WHAT HAS NOT BEEN SENT. A row in 'sent' is history: it records
-- what a customer actually received, box and all, and rewriting it would
-- make the record a lie. Only 'scheduled' rows are repaired.

do $$
declare
  touched integer;
begin
  with repaired as (
    update public.follow_ups
       set html = regexp_replace(html, '<img[^>]*src=["'']/[^"'']*["''][^>]*>', '', 'g'),
           updated_at = now()
     where state = 'scheduled'
       and html is not null
       and html ~ '<img[^>]*src=["'']/'
    returning 1
  )
  select count(*) into touched from repaired;

  raise notice 'follow-up image repair: % scheduled follow-up(s) had a relative image address removed', touched;
end $$;
