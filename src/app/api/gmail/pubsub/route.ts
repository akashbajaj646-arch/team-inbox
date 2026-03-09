import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  listThreads,
  getThread,
  parseHeaders,
  parseEmailAddress,
  extractBody,
  extractAttachments,
} from '@/lib/gmail';

/**
 * Gmail Push Notification Webhook
 *
 * Google Pub/Sub sends a POST request here whenever a new email arrives.
 * The payload contains a base64-encoded message with historyId and emailAddress.
 *
 * Setup required (one-time):
 * 1. Create a Google Cloud Pub/Sub topic
 * 2. Grant gmail-api-push@system.gserviceaccount.com "Pub/Sub Publisher" role on the topic
 * 3. Create a push subscription pointing to: https://your-domain.com/api/gmail/pubsub
 * 4. Call /api/gmail/watch for each inbox to register Gmail push notifications
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Pub/Sub wraps the message in a data field (base64 encoded)
    const messageData = body?.message?.data;
    if (!messageData) {
      return NextResponse.json({ error: 'No message data' }, { status: 400 });
    }

    // Decode the base64 message
    const decoded = Buffer.from(messageData, 'base64').toString('utf-8');
    const notification = JSON.parse(decoded);

    const { emailAddress, historyId } = notification;

    if (!emailAddress) {
      return NextResponse.json({ error: 'No email address in notification' }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // Find the inbox for this email address
    const { data: inbox, error: inboxError } = await supabase
      .from('inboxes')
      .select('*')
      .eq('email_address', emailAddress)
      .eq('inbox_type', 'email')
      .single();

    if (inboxError || !inbox?.google_refresh_token) {
      console.error('No inbox found for email:', emailAddress);
      // Return 200 to prevent Pub/Sub from retrying
      return NextResponse.json({ ok: true });
    }

    // Sync the latest emails for this inbox (last 10 threads)
    const { threads: gmailThreads } = await listThreads(
      inbox.google_refresh_token,
      { maxResults: 10 }
    );

    for (const gmailThreadSummary of gmailThreads) {
      if (!gmailThreadSummary.id) continue;
      await syncThread(supabase, inbox.id, inbox, gmailThreadSummary.id);
    }

    // Update the stored historyId
    await supabase
      .from('inboxes')
      .update({ google_history_id: String(historyId) })
      .eq('id', inbox.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Pub/Sub webhook error:', err);
    // Always return 200 to prevent Pub/Sub from endlessly retrying
    return NextResponse.json({ ok: true });
  }
}

async function syncThread(
  supabase: any,
  inboxId: string,
  inbox: any,
  gmailThreadId: string
) {
  const { data: existingThread } = await supabase
    .from('email_threads')
    .select('id')
    .eq('gmail_thread_id', gmailThreadId)
    .eq('inbox_id', inboxId)
    .single();

  const gmailThread = await getThread(inbox.google_refresh_token, gmailThreadId);
  if (!gmailThread.messages?.length) return;

  const firstMessage = gmailThread.messages[0];
  const lastMessage = gmailThread.messages[gmailThread.messages.length - 1];
  const headers = parseHeaders(firstMessage.payload.headers);

  if (existingThread) {
    await supabase
      .from('email_threads')
      .update({
        snippet: lastMessage.snippet,
        last_message_at: new Date(parseInt(lastMessage.internalDate)).toISOString(),
        is_read: !lastMessage.labelIds?.includes('UNREAD'),
      })
      .eq('id', existingThread.id);

    for (const message of gmailThread.messages) {
      const { data: existingMessage } = await supabase
        .from('email_messages')
        .select('id')
        .eq('gmail_message_id', message.id)
        .single();

      if (!existingMessage) {
        await insertMessage(supabase, existingThread.id, message, inbox.email_address);
      }
    }
  } else {
    const { data: newThread } = await supabase
      .from('email_threads')
      .insert({
        inbox_id: inboxId,
        gmail_thread_id: gmailThread.id,
        subject: headers.subject || '(No subject)',
        snippet: lastMessage.snippet,
        last_message_at: new Date(parseInt(lastMessage.internalDate)).toISOString(),
        is_read: !lastMessage.labelIds?.includes('UNREAD'),
        is_archived: !lastMessage.labelIds?.includes('INBOX'),
      })
      .select()
      .single();

    if (newThread) {
      for (const message of gmailThread.messages) {
        await insertMessage(supabase, newThread.id, message, inbox.email_address);
      }
      // Auto-apply filters to new thread
      await applyFiltersToThread(supabase, inboxId, newThread.id, newThread.subject);
    }
  }
}

async function applyFiltersToThread(
  supabase: any,
  inboxId: string,
  threadId: string,
  subject: string
) {
  // Load all filters for this inbox
  const { data: filteredInboxes } = await supabase
    .from('filtered_inboxes')
    .select('*')
    .eq('inbox_id', inboxId);

  if (!filteredInboxes?.length) return;

  // Load messages for this thread to check from/body
  const { data: messages } = await supabase
    .from('email_messages')
    .select('from_address, from_name, body_text')
    .eq('thread_id', threadId);

  if (!messages?.length) return;

  function matchesFilter(filter: any): boolean {
    const val = filter.value.toLowerCase();
    const check = (str: string) => {
      str = (str || '').toLowerCase();
      switch (filter.operator) {
        case 'contains': return str.includes(val);
        case 'equals': return str === val;
        case 'starts_with': return str.startsWith(val);
        case 'ends_with': return str.endsWith(val);
        default: return false;
      }
    };
    switch (filter.field) {
      case 'from': return messages.some((m: any) => check(m.from_address) || check(m.from_name));
      case 'subject': return check(subject || '');
      case 'body': return messages.some((m: any) => check(m.body_text || ''));
      default: return false;
    }
  }

  for (const fi of filteredInboxes) {
    const filters: any[] = fi.filters;
    const logic: string = fi.filter_logic;
    const matches = logic === 'all'
      ? filters.every(matchesFilter)
      : filters.some(matchesFilter);

    if (matches) {
      await supabase
        .from('email_threads')
        .update({ filtered_inbox_id: fi.id })
        .eq('id', threadId);
      break; // Assign to first matching filter only
    }
  }
}

async function insertMessage(
  supabase: any,
  threadId: string,
  message: any,
  inboxEmail: string
) {
  const headers = parseHeaders(message.payload.headers);
  const from = parseEmailAddress(headers.from || '');
  const body = extractBody(message);

  const toAddresses = (headers.to || '')
    .split(',')
    .map((addr: string) => parseEmailAddress(addr.trim()).address)
    .filter(Boolean);

  const ccAddresses = (headers.cc || '')
    .split(',')
    .map((addr: string) => parseEmailAddress(addr.trim()).address)
    .filter(Boolean);

  const isOutbound = from.address.toLowerCase() === inboxEmail.toLowerCase();

  const { data: insertedMessage } = await supabase.from('email_messages').insert({
    thread_id: threadId,
    gmail_message_id: message.id,
    from_address: from.address,
    from_name: from.name,
    to_addresses: toAddresses,
    cc_addresses: ccAddresses,
    body_html: body.html,
    body_text: body.text,
    sent_at: new Date(parseInt(message.internalDate)).toISOString(),
    is_outbound: isOutbound,
  }).select().single();

  // Save attachments
  if (insertedMessage) {
    const attachments = extractAttachments(message);
    for (const att of attachments) {
      await supabase.from('email_attachments').insert({
        message_id: insertedMessage.id,
        thread_id: threadId,
        filename: att.filename,
        mime_type: att.mimeType,
        size: att.size,
        gmail_attachment_id: att.attachmentId,
        is_inline: att.isInline || false,
        content_id: att.contentId || null,
      });
    }
  }
}
