-- UI batch: snooze + attachment de-duplication
-- Run once in the Supabase SQL Editor.

-- 1. Snooze
alter table email_threads add column if not exists snoozed_until timestamptz;
create index if not exists email_threads_snoozed_idx on email_threads (inbox_id, snoozed_until)
  where snoozed_until is not null;

-- 2. Remove duplicate attachment rows (keeps one row of each duplicate set)
delete from email_attachments a
using email_attachments b
where a.message_id = b.message_id
  and a.filename = b.filename
  and coalesce(a.content_id, '') = coalesce(b.content_id, '')
  and a.ctid > b.ctid;

-- 3. Prevent new duplicates
create unique index if not exists email_attachments_unique_part
  on email_attachments (message_id, filename, coalesce(content_id, ''));
