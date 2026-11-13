-- What an attached file IS, as opposed to what it is called.
--
-- SCHEMA CHANGE: adds one column to `attachments` and one index. Nothing
-- existing is touched, no data is deleted, no policy changes. Safe to
-- re-run. Run AFTER 010_attachments.sql and 011_attachments_shared.sql.
--
-- WHY. A customer record collects paperwork — their purchase order, a GST
-- certificate, a signed agreement — and until now the only thing saying
-- which was which was the filename somebody's scanner chose. "SKM_C250i
-- 26110312450.pdf" is not a purchase order to anybody reading the list a
-- month later.
--
-- A PLAIN TEXT COLUMN, not an enum and not a lookup table. The vocabulary
-- belongs to the people filing the paperwork and will change; an enum
-- means a migration every time somebody wants to file a different kind of
-- document, and a CHECK constraint here would start refusing uploads from
-- an older browser that has not been reloaded since the list changed.
-- Empty means nobody said, which is every row that already exists.
alter table public.attachments add column if not exists kind text not null default '';

-- Finding the purchase orders against one customer, which is the question
-- this column exists to answer.
create index if not exists attachments_kind_idx
  on public.attachments (record_type, record_id, kind);

-- NO UPDATE POLICY IS ADDED, deliberately. The table has never had one:
-- an attachment row is a fact about a file that was uploaded, not something
-- to be edited afterwards, and a migration whose job is to add a label must
-- not quietly hand out a permission the table never granted. The kind is
-- chosen when the file is attached; a mislabelled file is replaced by
-- removing it and attaching it again, which is the same answer this table
-- has always given for a wrong file.
