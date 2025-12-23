-- Migration: Add email organization fields
-- Run this in your Supabase SQL Editor

-- Add starred and deleted fields to email_threads
ALTER TABLE email_threads 
ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_threads_starred ON email_threads(inbox_id, is_starred) WHERE is_starred = true;
CREATE INDEX IF NOT EXISTS idx_threads_deleted ON email_threads(inbox_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_threads_unread ON email_threads(inbox_id, is_read) WHERE is_read = false;

-- Update the is_read column if it doesn't exist (it should from original schema)
-- ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
