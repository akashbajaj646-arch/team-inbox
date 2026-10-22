-- UI batch: snooze + attachment de-duplication
-- Run once in the Supabase SQL Editor.

-- 1. Snooze
alter table email_threads add column if not exists snoozed_until timestamptz;
create index if not exists email_threads_snoozed_idx on email_threads (inbox_id, snoozed_until)
  where snoozed_until is not null;

-- 2. Remove exact duplicate attachment rows.
--    A row only counts as a duplicate when message, filename, content id, type AND size all match,
--    so two different files that share a name (e.g. two "image001.png") are both kept.
delete from email_attachments a
using email_attachments b
where a.message_id = b.message_id
  and a.filename = b.filename
  and coalesce(a.content_id, '') = coalesce(b.content_id, '')
  and coalesce(a.mime_type, '') = coalesce(b.mime_type, '')
  and coalesce(a.size, -1) = coalesce(b.size, -1)
  and a.ctid > b.ctid;

-- 3. Prevent new exact duplicates
create unique index if not exists email_attachments_unique_part
  on email_attachments (message_id, filename, coalesce(content_id, ''), coalesce(mime_type, ''), coalesce(size, -1));
