-- Team Inbox Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (synced with auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inboxes table
CREATE TABLE IF NOT EXISTS inboxes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email_address TEXT NOT NULL,
  google_refresh_token TEXT, -- Stored encrypted
  google_history_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inbox members (who has access to which inbox)
CREATE TABLE IF NOT EXISTS inbox_members (
  inbox_id UUID REFERENCES inboxes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  PRIMARY KEY (inbox_id, user_id)
);

-- Email threads
CREATE TABLE IF NOT EXISTS email_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inbox_id UUID REFERENCES inboxes(id) ON DELETE CASCADE NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT,
  last_message_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(inbox_id, gmail_thread_id)
);

-- Email messages
CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID REFERENCES email_threads(id) ON DELETE CASCADE NOT NULL,
  gmail_message_id TEXT NOT NULL UNIQUE,
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_addresses JSONB DEFAULT '[]'::jsonb,
  cc_addresses JSONB DEFAULT '[]'::jsonb,
  body_html TEXT,
  body_text TEXT,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_outbound BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Thread comments (internal team discussion)
CREATE TABLE IF NOT EXISTS thread_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID REFERENCES email_threads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Thread presence (who is viewing/drafting)
CREATE TABLE IF NOT EXISTS thread_presence (
  thread_id UUID REFERENCES email_threads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('viewing', 'drafting')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);

-- Drafts (saved reply drafts)
CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID REFERENCES email_threads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  body_html TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(thread_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_threads_inbox_id ON email_threads(inbox_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_last_message_at ON email_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread_id ON email_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_sent_at ON email_messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_thread_comments_thread_id ON thread_comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_presence_thread_id ON thread_presence(thread_id);
CREATE INDEX IF NOT EXISTS idx_inbox_members_user_id ON inbox_members(user_id);

-- Row Level Security Policies

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE inboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;

-- Users: can read all users, can only update own profile
CREATE POLICY "Users can read all users" ON users
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Inboxes: can only access inboxes you're a member of
CREATE POLICY "Users can read member inboxes" ON inboxes
  FOR SELECT USING (
    id IN (
      SELECT inbox_id FROM inbox_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert inboxes" ON inboxes
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can update inboxes" ON inboxes
  FOR UPDATE USING (
    id IN (
      SELECT inbox_id FROM inbox_members 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Inbox members: can read memberships for inboxes you're in
CREATE POLICY "Users can read inbox memberships" ON inbox_members
  FOR SELECT USING (
    inbox_id IN (
      SELECT inbox_id FROM inbox_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage inbox members" ON inbox_members
  FOR ALL USING (
    inbox_id IN (
      SELECT inbox_id FROM inbox_members 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Users can insert own membership" ON inbox_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Email threads: can access threads in your inboxes
CREATE POLICY "Users can read inbox threads" ON email_threads
  FOR SELECT USING (
    inbox_id IN (
      SELECT inbox_id FROM inbox_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert threads" ON email_threads
  FOR INSERT WITH CHECK (
    inbox_id IN (
      SELECT inbox_id FROM inbox_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update threads" ON email_threads
  FOR UPDATE USING (
    inbox_id IN (
      SELECT inbox_id FROM inbox_members WHERE user_id = auth.uid()
    )
  );

-- Email messages: can access messages in threads you can access
CREATE POLICY "Users can read thread messages" ON email_messages
  FOR SELECT USING (
    thread_id IN (
      SELECT et.id FROM email_threads et
      JOIN inbox_members im ON et.inbox_id = im.inbox_id
      WHERE im.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages" ON email_messages
  FOR INSERT WITH CHECK (
    thread_id IN (
      SELECT et.id FROM email_threads et
      JOIN inbox_members im ON et.inbox_id = im.inbox_id
      WHERE im.user_id = auth.uid()
    )
  );

-- Thread comments: can access comments on threads you can access
CREATE POLICY "Users can read thread comments" ON thread_comments
  FOR SELECT USING (
    thread_id IN (
      SELECT et.id FROM email_threads et
      JOIN inbox_members im ON et.inbox_id = im.inbox_id
      WHERE im.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert comments" ON thread_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    thread_id IN (
      SELECT et.id FROM email_threads et
      JOIN inbox_members im ON et.inbox_id = im.inbox_id
      WHERE im.user_id = auth.uid()
    )
  );

-- Thread presence: can read/write presence for accessible threads
CREATE POLICY "Users can read thread presence" ON thread_presence
  FOR SELECT USING (
    thread_id IN (
      SELECT et.id FROM email_threads et
      JOIN inbox_members im ON et.inbox_id = im.inbox_id
      WHERE im.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own presence" ON thread_presence
  FOR ALL USING (user_id = auth.uid());

-- Drafts: users can only access their own drafts
CREATE POLICY "Users can manage own drafts" ON drafts
  FOR ALL USING (user_id = auth.uid());

-- Enable realtime for presence and comments
ALTER PUBLICATION supabase_realtime ADD TABLE thread_presence;
ALTER PUBLICATION supabase_realtime ADD TABLE thread_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE email_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE email_messages;

-- Function to clean up stale presence (older than 5 minutes)
CREATE OR REPLACE FUNCTION cleanup_stale_presence()
RETURNS void AS $$
BEGIN
  DELETE FROM thread_presence
  WHERE updated_at < NOW() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;

-- You can set up a cron job in Supabase to run this periodically
-- Or call it manually as needed
