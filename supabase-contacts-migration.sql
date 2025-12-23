-- Migration: Add Contacts system
-- Run this in your Supabase SQL Editor

-- Create contacts table
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_name TEXT,
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    email_1 TEXT,
    email_2 TEXT,
    email_3 TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email_1 ON contacts(email_1) WHERE email_1 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email_2 ON contacts(email_2) WHERE email_2 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email_3 ON contacts(email_3) WHERE email_3 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_name) WHERE company_name IS NOT NULL;

-- Enable RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Users can only see/manage their own contacts
CREATE POLICY "Users can view their own contacts" ON contacts
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own contacts" ON contacts
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own contacts" ON contacts
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own contacts" ON contacts
    FOR DELETE USING (user_id = auth.uid());

-- Function to find contact by email
CREATE OR REPLACE FUNCTION find_contact_by_email(search_email TEXT, search_user_id UUID)
RETURNS TABLE (
    id UUID,
    company_name TEXT,
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    email_1 TEXT,
    email_2 TEXT,
    email_3 TEXT,
    notes TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        c.company_name,
        c.first_name,
        c.last_name,
        c.phone_number,
        c.email_1,
        c.email_2,
        c.email_3,
        c.notes
    FROM contacts c
    WHERE c.user_id = search_user_id
    AND (
        LOWER(c.email_1) = LOWER(search_email) OR
        LOWER(c.email_2) = LOWER(search_email) OR
        LOWER(c.email_3) = LOWER(search_email)
    )
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to find contact by phone
CREATE OR REPLACE FUNCTION find_contact_by_phone(search_phone TEXT, search_user_id UUID)
RETURNS TABLE (
    id UUID,
    company_name TEXT,
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    email_1 TEXT,
    email_2 TEXT,
    email_3 TEXT,
    notes TEXT
) AS $$
DECLARE
    cleaned_phone TEXT;
BEGIN
    -- Clean the search phone number (remove non-digits)
    cleaned_phone := regexp_replace(search_phone, '[^0-9]', '', 'g');
    
    RETURN QUERY
    SELECT 
        c.id,
        c.company_name,
        c.first_name,
        c.last_name,
        c.phone_number,
        c.email_1,
        c.email_2,
        c.email_3,
        c.notes
    FROM contacts c
    WHERE c.user_id = search_user_id
    AND regexp_replace(c.phone_number, '[^0-9]', '', 'g') = cleaned_phone
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
