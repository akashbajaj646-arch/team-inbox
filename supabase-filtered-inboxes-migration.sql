-- Migration: Add filtered inboxes (smart folders)
-- Run this in your Supabase SQL Editor

-- Create filtered_inboxes table
CREATE TABLE IF NOT EXISTS filtered_inboxes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  inbox_id UUID REFERENCES inboxes(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '[]',
  filter_logic TEXT NOT NULL DEFAULT 'any' CHECK (filter_logic IN ('any', 'all')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Filters JSONB structure example:
-- [
--   { "field": "from", "operator": "contains", "value": "ups.com" },
--   { "field": "subject", "operator": "contains", "value": "tracking" },
--   { "field": "body", "operator": "contains", "value": "delivery" }
-- ]
-- 
-- field: "from", "subject", "body"
-- operator: "contains", "equals", "starts_with", "ends_with"
-- filter_logic: "any" (OR) or "all" (AND)

-- Index for quick lookup by parent inbox
CREATE INDEX IF NOT EXISTS idx_filtered_inboxes_inbox ON filtered_inboxes(inbox_id);

-- RLS policies
ALTER TABLE filtered_inboxes ENABLE ROW LEVEL SECURITY;

-- Users can view filtered inboxes if they're a member of the parent inbox
CREATE POLICY "Members can view filtered inboxes"
ON filtered_inboxes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM inbox_members
    WHERE inbox_members.inbox_id = filtered_inboxes.inbox_id
    AND inbox_members.user_id = auth.uid()
  )
);

-- Only admins can create filtered inboxes
CREATE POLICY "Admins can create filtered inboxes"
ON filtered_inboxes FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM inbox_members
    WHERE inbox_members.inbox_id = filtered_inboxes.inbox_id
    AND inbox_members.user_id = auth.uid()
    AND inbox_members.role = 'admin'
  )
);

-- Only admins can update filtered inboxes
CREATE POLICY "Admins can update filtered inboxes"
ON filtered_inboxes FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM inbox_members
    WHERE inbox_members.inbox_id = filtered_inboxes.inbox_id
    AND inbox_members.user_id = auth.uid()
    AND inbox_members.role = 'admin'
  )
);

-- Only admins can delete filtered inboxes
CREATE POLICY "Admins can delete filtered inboxes"
ON filtered_inboxes FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM inbox_members
    WHERE inbox_members.inbox_id = filtered_inboxes.inbox_id
    AND inbox_members.user_id = auth.uid()
    AND inbox_members.role = 'admin'
  )
);
