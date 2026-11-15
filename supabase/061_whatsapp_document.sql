-- WhatsApp: the quotation PDF that went with a message.
--
-- SCHEMA CHANGE: two columns on an existing table, both with defaults, so
-- every row that is already there stays valid. Safe to re-run.
--
-- WHY THE FILENAME IS STORED. It is what the customer saw on the attachment
-- — "Quotation_TZ-26-27-0311.pdf" — and the message history is the record of
-- what they were sent. Without it the history shows a message about a
-- quotation with no sign that the quotation itself went with it, and nobody
-- can answer "did they actually get the PDF?" without opening Meta.
--
-- WHY THE META ID IS STORED, which is the less obvious one. A file handed to
-- WhatsApp is kept by Meta for about thirty days under an id. The follow-up
-- goes out three days after the quotation, from the nightly job, where there
-- is no browser and so no way to render the PDF again. Keeping the id means
-- the follow-up attaches the very same file the customer already has, with
-- no second upload and no second render — and when the id is too old, or the
-- quotation never went out on WhatsApp in the first place, the follow-up
-- quietly sends the version without the attachment instead.
-- AND WHICH NAME WENT TO META. The CRM's own name for a message never
-- changes — it is the key of the switch, what every screen looks a message
-- up by, and what the once-a-day guard keys on. The name at Meta does
-- change: the templates were resubmitted as "_v2", and while those are in
-- review a send falls back to the old name on its own. Recording the name
-- that was actually accepted is the only way to see which happened, without
-- anybody having to watch for it.
alter table public.whatsapp_messages
  add column if not exists document_id text not null default '',
  add column if not exists document_name text not null default '',
  add column if not exists meta_template text not null default '';

-- Finding the PDF already uploaded for a quotation: the follow-up's lookup.
-- Partial, because only a handful of rows ever carry a document.
create index if not exists whatsapp_messages_document_idx
  on public.whatsapp_messages (company_id, record_id, created_at desc)
  where document_id <> '';
