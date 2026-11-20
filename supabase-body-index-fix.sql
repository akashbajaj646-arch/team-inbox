-- Lighter search index on email bodies: only the first 2,000 characters.
-- Full-body trigram indexing made large marketing emails time out on insert.

-- 1. Replace the index
drop index if exists email_messages_body_trgm;
create index if not exists email_messages_body_trgm_2k on email_messages
  using gin ((left(coalesce(body_text, ''), 2000)) gin_trgm_ops);

-- 2. Point search at the same expression (edits the live function in place)
do $$
declare
  d text;
  d2 text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'search_email_threads' and n.nspname = 'public'
  limit 1;
  if d is null then
    raise notice 'search_email_threads not found, skipped';
    return;
  end if;
  d2 := replace(d, 'coalesce(m.body_text, '''') ilike term',
                   'left(coalesce(m.body_text, ''''), 2000) ilike term');
  if d2 = d then
    raise notice 'search function already updated or text differs, skipped';
  else
    execute d2;
    raise notice 'search function updated';
  end if;
end $$;
