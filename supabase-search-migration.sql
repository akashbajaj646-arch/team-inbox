-- Fast email search: trigram indexes + search function
-- Run once in the Supabase SQL Editor.

create extension if not exists pg_trgm;

create index if not exists email_messages_thread_id_idx on email_messages (thread_id);
create index if not exists email_messages_from_trgm on email_messages
  using gin ((coalesce(from_address, '') || ' ' || coalesce(from_name, '')) gin_trgm_ops);
create index if not exists email_messages_rcpt_trgm on email_messages
  using gin ((coalesce(to_addresses::text, '') || ' ' || coalesce(cc_addresses::text, '')) gin_trgm_ops);
create index if not exists email_messages_body_trgm on email_messages
  using gin ((coalesce(body_text, '')) gin_trgm_ops);
create index if not exists email_threads_subject_trgm on email_threads
  using gin ((coalesce(subject, '')) gin_trgm_ops);
create index if not exists email_threads_inbox_last_idx on email_threads (inbox_id, last_message_at desc);

-- Patterns arrive already wrapped as '%term%' with % and _ escaped by the API.
create or replace function search_email_threads(
  p_inbox_id uuid,
  p_terms text[] default '{}',
  p_from text default null,
  p_to text default null,
  p_subject text default null,
  p_has_attachment boolean default false,
  p_is_unread boolean default null,
  p_is_starred boolean default null,
  p_after timestamptz default null,
  p_before timestamptz default null,
  p_limit int default 100
)
returns table (thread_id uuid)
language sql
stable
as $$
  select t.id
  from email_threads t
  where t.inbox_id = p_inbox_id
    and t.deleted_at is null
    and (p_subject is null or coalesce(t.subject, '') ilike p_subject)
    and (p_is_unread is null or t.is_read = not p_is_unread)
    and (p_is_starred is null or t.is_starred = p_is_starred)
    and (p_after is null or t.last_message_at >= p_after)
    and (p_before is null or t.last_message_at < p_before)
    and (not p_has_attachment or exists (
      select 1 from email_attachments a where a.thread_id = t.id and a.is_inline = false))
    and (p_from is null or exists (
      select 1 from email_messages m where m.thread_id = t.id
        and (coalesce(m.from_address, '') || ' ' || coalesce(m.from_name, '')) ilike p_from))
    and (p_to is null or exists (
      select 1 from email_messages m where m.thread_id = t.id
        and (coalesce(m.to_addresses::text, '') || ' ' || coalesce(m.cc_addresses::text, '')) ilike p_to))
    -- every free-text term must match somewhere in the thread
    and not exists (
      select 1 from unnest(p_terms) as term
      where not (
        coalesce(t.subject, '') ilike term
        or coalesce(t.snippet, '') ilike term
        or exists (
          select 1 from email_messages m where m.thread_id = t.id and (
            (coalesce(m.from_address, '') || ' ' || coalesce(m.from_name, '')) ilike term
            or (coalesce(m.to_addresses::text, '') || ' ' || coalesce(m.cc_addresses::text, '')) ilike term
            or coalesce(m.body_text, '') ilike term
          )
        )
      )
    )
  order by t.last_message_at desc
  limit p_limit;
$$;
