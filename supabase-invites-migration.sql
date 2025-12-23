-- Migration: Add team invites table
-- Run this in your Supabase SQL Editor

-- Create invites table
CREATE TABLE IF NOT EXISTS invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  inbox_id UUID REFERENCES inboxes(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

-- Index for quick token lookup
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);

-- Index for finding pending invites by email
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email) WHERE accepted_at IS NULL;

-- RLS policies for invites
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Admins can view invites for their inboxes
CREATE POLICY "Admins can view inbox invites"
ON invites FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM inbox_members
    WHERE inbox_members.inbox_id = invites.inbox_id
    AND inbox_members.user_id = auth.uid()
    AND inbox_members.role = 'admin'
  )
);

-- Admins can create invites for their inboxes
CREATE POLICY "Admins can create invites"
ON invites FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM inbox_members
    WHERE inbox_members.inbox_id = invites.inbox_id
    AND inbox_members.user_id = auth.uid()
    AND inbox_members.role = 'admin'
  )
);

-- Admins can delete invites for their inboxes
CREATE POLICY "Admins can delete invites"
ON invites FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM inbox_members
    WHERE inbox_members.inbox_id = invites.inbox_id
    AND inbox_members.user_id = auth.uid()
    AND inbox_members.role = 'admin'
  )
);

-- Anyone can update an invite (for accepting)
CREATE POLICY "Anyone can accept invites"
ON invites FOR UPDATE
USING (true)
WITH CHECK (true);
