// Database types

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Inbox {
  id: string;
  name: string;
  email_address: string | null;
  google_refresh_token: string | null;
  google_history_id: string | null;
  inbox_type: 'email' | 'sms' | 'whatsapp';
  twilio_phone_number: string | null;
  twilio_account_sid: string | null;
  twilio_auth_token: string | null;
  // Personal inbox fields
  is_personal: boolean;
  owner_user_id: string | null;
  created_at: string;
}

export interface InboxMember {
  inbox_id: string;
  user_id: string;
  role: 'admin' | 'member';
}

export interface EmailThread {
  id: string;
  inbox_id: string;
  gmail_thread_id: string;
  subject: string;
  snippet: string;
  last_message_at: string;
  is_read: boolean;
  is_archived: boolean;
  is_starred: boolean;
  deleted_at: string | null;
  // Joined data
  inbox?: Inbox;
  messages?: EmailMessage[];
  comments?: ThreadComment[];
  presence?: ThreadPresence[];
}

export interface EmailMessage {
  id: string;
  thread_id: string;
  gmail_message_id: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  body_html: string | null;
  body_text: string | null;
  sent_at: string;
  is_outbound: boolean;
}

// SMS Types

export interface SmsThread {
  id: string;
  inbox_id: string;
  contact_phone: string;
  contact_name: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  inbox?: Inbox;
  messages?: SmsMessage[];
  comments?: ThreadComment[];
}

export interface SmsMessage {
  id: string;
  thread_id: string;
  twilio_message_sid: string | null;
  direction: 'inbound' | 'outbound';
  from_number: string;
  to_number: string;
  body: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  sent_at: string;
  created_at: string;
  // Joined data
  attachments?: SmsAttachment[];
}

export interface SmsAttachment {
  id: string;
  message_id: string;
  media_url: string;
  content_type: string | null;
  file_size: number | null;
  created_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  email_1: string | null;
  email_2: string | null;
  email_3: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThreadComment {
  id: string;
  thread_id: string | null;
  sms_thread_id: string | null;
  user_id: string;
  content: string;
  created_at: string;
  // Joined data
  user?: User;
}

export interface ThreadPresence {
  thread_id: string;
  user_id: string;
  status: 'viewing' | 'drafting';
  updated_at: string;
  // Joined data
  user?: User;
}

export interface Draft {
  id: string;
  thread_id: string;
  user_id: string;
  body_html: string;
  updated_at: string;
}

export interface Template {
  id: string;
  inbox_id: string;
  name: string;
  subject: string | null;
  body: string;
  category: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FilterRule {
  field: 'from' | 'subject' | 'body';
  operator: 'contains' | 'equals' | 'starts_with' | 'ends_with';
  value: string;
}

export interface FilteredInbox {
  id: string;
  inbox_id: string;
  name: string;
  filters: FilterRule[];
  filter_logic: 'any' | 'all';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// API types

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    mimeType: string;
    body?: { data?: string };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{
        mimeType: string;
        body?: { data?: string };
      }>;
    }>;
  };
  internalDate: string;
}

export interface GmailThread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

// Realtime payload types

export interface RealtimePayload<T> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: T;
  old: T | null;
}
