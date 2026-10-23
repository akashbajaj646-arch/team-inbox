-- Let the app hear new SMS/WhatsApp messages and comments live (needed for desktop notifications).
-- Safe to run more than once.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sms_messages') then
    alter publication supabase_realtime add table sms_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sms_threads') then
    alter publication supabase_realtime add table sms_threads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'thread_comments') then
    alter publication supabase_realtime add table thread_comments;
  end if;
end $$;

-- Shows what is now live
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename;
