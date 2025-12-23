-- Migration: Add SMS/MMS support via Twilio
-- Run this in your Supabase SQL Editor

-- Add inbox_type to inboxes table to distinguish between email and SMS
ALTER TABLE inboxes ADD COLUMN IF NOT EXISTS inbox_type TEXT DEFAULT 'email' CHECK (inbox_type IN ('email', 'sms'));

-- Add Twilio-specific fields to inboxes
ALTER TABLE inboxes ADD COLUMN IF NOT EXISTS twilio_phone_number TEXT;
ALTER TABLE inboxes ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT;
ALTER TABLE inboxes ADD COLUMN IF NOT EXISTS twilio_auth_token TEXT;

-- Update email_address to be nullable (SMS inboxes won't have email)
ALTER TABLE inboxes ALTER COLUMN email_address DROP NOT NULL;

-- Create SMS threads table (separate from email_threads for clarity)
CREATE TABLE IF NOT EXISTS sms_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inbox_id UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    contact_phone TEXT NOT NULL,
    contact_name TEXT,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_preview TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    is_starred BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create SMS messages table
CREATE TABLE IF NOT EXISTS sms_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES sms_threads(id) ON DELETE CASCADE,
    twilio_message_sid TEXT UNIQUE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    body TEXT,
    status TEXT DEFAULT 'sent',
    error_code TEXT,
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create MMS attachments table
CREATE TABLE IF NOT EXISTS sms_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES sms_messages(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    content_type TEXT,
    file_size INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sms_threads_inbox ON sms_threads(inbox_id);
CREATE INDEX IF NOT EXISTS idx_sms_threads_contact ON sms_threads(contact_phone);
CREATE INDEX IF NOT EXISTS idx_sms_threads_last_message ON sms_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_thread ON sms_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_twilio_sid ON sms_messages(twilio_message_sid);
CREATE INDEX IF NOT EXISTS idx_sms_attachments_message ON sms_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_inboxes_type ON inboxes(inbox_type);
CREATE INDEX IF NOT EXISTS idx_inboxes_twilio_phone ON inboxes(twilio_phone_number);

-- Enable RLS
ALTER TABLE sms_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for sms_threads
CREATE POLICY "Users can view SMS threads in their inboxes" ON sms_threads
    FOR SELECT USING (
        inbox_id IN (
            SELECT inbox_id FROM inbox_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert SMS threads in their inboxes" ON sms_threads
    FOR INSERT WITH CHECK (
        inbox_id IN (
            SELECT inbox_id FROM inbox_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update SMS threads in their inboxes" ON sms_threads
    FOR UPDATE USING (
        inbox_id IN (
            SELECT inbox_id FROM inbox_members WHERE user_id = auth.uid()
        )
    );

-- RLS Policies for sms_messages
CREATE POLICY "Users can view SMS messages in their threads" ON sms_messages
    FOR SELECT USING (
        thread_id IN (
            SELECT st.id FROM sms_threads st
            JOIN inbox_members im ON st.inbox_id = im.inbox_id
            WHERE im.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert SMS messages in their threads" ON sms_messages
    FOR INSERT WITH CHECK (
        thread_id IN (
            SELECT st.id FROM sms_threads st
            JOIN inbox_members im ON st.inbox_id = im.inbox_id
            WHERE im.user_id = auth.uid()
        )
    );

-- RLS Policies for sms_attachments
CREATE POLICY "Users can view SMS attachments in their messages" ON sms_attachments
    FOR SELECT USING (
        message_id IN (
            SELECT sm.id FROM sms_messages sm
            JOIN sms_threads st ON sm.thread_id = st.id
            JOIN inbox_members im ON st.inbox_id = im.inbox_id
            WHERE im.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert SMS attachments in their messages" ON sms_attachments
    FOR INSERT WITH CHECK (
        message_id IN (
            SELECT sm.id FROM sms_messages sm
            JOIN sms_threads st ON sm.thread_id = st.id
            JOIN inbox_members im ON st.inbox_id = im.inbox_id
            WHERE im.user_id = auth.uid()
        )
    );

-- Service role policies for webhook access
CREATE POLICY "Service role can manage SMS threads" ON sms_threads
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage SMS messages" ON sms_messages
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage SMS attachments" ON sms_attachments
    FOR ALL USING (auth.role() = 'service_role');

-- Add comments table support for SMS threads
ALTER TABLE thread_comments ADD COLUMN IF NOT EXISTS sms_thread_id UUID REFERENCES sms_threads(id) ON DELETE CASCADE;

-- Make thread_id nullable since comments can be on email OR sms threads
ALTER TABLE thread_comments ALTER COLUMN thread_id DROP NOT NULL;

-- Add constraint to ensure comment is on one type of thread
ALTER TABLE thread_comments ADD CONSTRAINT comment_thread_check 
    CHECK (
        (thread_id IS NOT NULL AND sms_thread_id IS NULL) OR
        (thread_id IS NULL AND sms_thread_id IS NOT NULL)
    );

-- Update comments RLS policy for SMS threads
CREATE POLICY "Users can view comments on SMS threads" ON thread_comments
    FOR SELECT USING (
        sms_thread_id IN (
            SELECT st.id FROM sms_threads st
            JOIN inbox_members im ON st.inbox_id = im.inbox_id
            WHERE im.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert comments on SMS threads" ON thread_comments
    FOR INSERT WITH CHECK (
        sms_thread_id IN (
            SELECT st.id FROM sms_threads st
            JOIN inbox_members im ON st.inbox_id = im.inbox_id
            WHERE im.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own comments on SMS threads" ON thread_comments
    FOR UPDATE USING (
        user_id = auth.uid() AND
        sms_thread_id IN (
            SELECT st.id FROM sms_threads st
            JOIN inbox_members im ON st.inbox_id = im.inbox_id
            WHERE im.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete their own comments on SMS threads" ON thread_comments
    FOR DELETE USING (
        user_id = auth.uid() AND
        sms_thread_id IN (
            SELECT st.id FROM sms_threads st
            JOIN inbox_members im ON st.inbox_id = im.inbox_id
            WHERE im.user_id = auth.uid()
        )
    );
