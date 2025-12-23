-- Response Templates Table
-- Run this in your Supabase SQL Editor

-- Templates table
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inbox_id UUID REFERENCES inboxes(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  category TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_templates_inbox_id ON templates(inbox_id);

-- Enable RLS
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for templates
CREATE POLICY "Users can read templates for their inboxes" ON templates
  FOR SELECT USING (
    inbox_id IN (
      SELECT inbox_id FROM inbox_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can insert templates" ON templates
  FOR INSERT WITH CHECK (
    inbox_id IN (
      SELECT inbox_id FROM inbox_members 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update templates" ON templates
  FOR UPDATE USING (
    inbox_id IN (
      SELECT inbox_id FROM inbox_members 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete templates" ON templates
  FOR DELETE USING (
    inbox_id IN (
      SELECT inbox_id FROM inbox_members 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Temporarily disable RLS for easier testing (remove in production)
-- ALTER TABLE templates DISABLE ROW LEVEL SECURITY;
