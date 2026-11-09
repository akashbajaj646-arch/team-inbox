import { NextResponse } from 'next/server';
import { routeThread } from '@/lib/filter-routing';
import { createServiceClient } from '@/lib/supabase/server';
import {
  listThreads,
  listHistory,
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
export const maxDuration = 60;

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

    // One sync per inbox at a time. Overlapping notifications used to save the same
    // emails concurrently, block on each other's locks and hit the statement timeout.
    // Every notification flags work as pending; whoever holds the lock keeps going
    // until nothing is pending, so no notification is lost.
    await supabase.from('inboxes').update({ sync_pending: true }).eq('id', inbox.id);

    for (let pass = 0; pass < 5; pass++) {
      const claimed = await claimSyncLock(supabase, inbox);
      if (!claimed) break; // another run holds the lock and will pick up our pending flag
      try {
        await supabase.from('inboxes').update({ sync_pending: false }).eq('id', inbox.id);
        await syncPass(supabase, claimed, String(historyId));
      } finally {
        await supabase.from('inboxes').update({ sync_lock_until: null }).eq('id', inbox.id);
      }
      const { data: state } = await supabase
        .from('inboxes')
        .select('sync_pending')
        .eq('id', inbox.id)
        .limit(1)
        .maybeSingle();
      if (!state?.sync_pending) break;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Pub/Sub webhook error:', err);
    // Always return 200 to prevent Pub/Sub from endlessly retrying
    return NextResponse.json({ ok: true });
  }
}

function laterHistoryId(...ids: (string | null | undefined)[]): string | null {
  let best: bigint | null = null;
  for (const id of ids) {
    if (!id) continue;
    try {
      const v = BigInt(id);
      if (best === null || v > best) best = v;
    } catch { /* ignore malformed ids */ }
  }
  return best === null ? null : best.toString();
}

// Atomically take the per-inbox sync lock. Returns the fresh inbox row, or null if
// another run holds it. If the lock columns are missing, runs unlocked rather than stalling.
async function claimSyncLock(supabase: any, inbox: any): Promise<any | null> {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + 90_000).toISOString();
  const { data, error } = await supabase
    .from('inboxes')
    .update({ sync_lock_until: until })
    .eq('id', inbox.id)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${now}`)
    .select('*')
    .maybeSingle();
  if (error) {
    console.error('pubsub: could not take sync lock, running unlocked', error);
    return inbox;
  }
  return data;
}

async function syncPass(supabase: any, inbox: any, notifiedHistoryId: string) {
  // Use Gmail history API to sync only threads that changed since the last sync
  let threadIdsToSync: string[] = [];
  let useFallback = true;
  let latestHistoryId: string | undefined;

  if (inbox.google_history_id) {
    try {
      const res = await listHistory(inbox.google_refresh_token, inbox.google_history_id);
      if (!res.expired) {
        threadIdsToSync = res.threadIds;
        latestHistoryId = res.latestHistoryId;
        useFallback = false;
      }
    } catch (err) {
      console.error('History list failed, falling back to recent threads:', err);
    }
  }

  if (useFallback) {
    const { threads: gmailThreads } = await listThreads(
      inbox.google_refresh_token,
      { maxResults: 10 }
    );
    threadIdsToSync = gmailThreads.map((t: any) => t.id).filter(Boolean);
  }

  for (const changedThreadId of threadIdsToSync) {
    try {
      await syncThread(supabase, inbox.id, inbox, changedThreadId);
    } catch (err) {
      console.error('pubsub: thread sync failed', changedThreadId, err);
    }
  }

  // Store the newest historyId we have seen (never move backwards)
  const next = laterHistoryId(latestHistoryId, notifiedHistoryId, inbox.google_history_id);
  if (next && next !== String(inbox.google_history_id)) {
    await supabase.from('inboxes').update({ google_history_id: next }).eq('id', inbox.id);
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
        is_archived: !gmailThread.messages.some((m: any) => m.labelIds?.includes('INBOX')),
      })
      .eq('id', existingThread.id);

    let addedMessage = false;
    for (const message of gmailThread.messages) {
      const { data: existingMessage } = await supabase
        .from('email_messages')
        .select('id')
        .eq('gmail_message_id', message.id)
        .limit(1)
        .maybeSingle();

      if (!existingMessage) {
        await insertMessage(supabase, existingThread.id, message, inbox.email_address);
        addedMessage = true;
      }
    }
    // Threads that existed before a filter was created get routed on their next message
    if (addedMessage) await routeThread(supabase, inboxId, existingThread.id);
  } else {
    const { data: newThread, error: newThreadErr } = await supabase
      .from('email_threads')
      .upsert({
        inbox_id: inboxId,
        gmail_thread_id: gmailThread.id,
        subject: headers.subject || '(No subject)',
        snippet: lastMessage.snippet,
        last_message_at: new Date(parseInt(lastMessage.internalDate)).toISOString(),
        is_read: !lastMessage.labelIds?.includes('UNREAD'),
        is_archived: !gmailThread.messages.some((m: any) => m.labelIds?.includes('INBOX')),
      }, { onConflict: 'inbox_id,gmail_thread_id' })
      .select()
      .single();

    if (newThreadErr) console.error('pubsub: thread save failed', gmailThread.id, newThreadErr);
    if (newThread) {
      for (const message of gmailThread.messages) {
        await insertMessage(supabase, newThread.id, message, inbox.email_address);
      }
      // Route into a filtered inbox (e.g. Stripe) if its rules match
      await routeThread(supabase, inboxId, newThread.id);
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

  const { data: insertedMessage, error: insertErr } = await supabase.from('email_messages').upsert({
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
  }, { onConflict: 'gmail_message_id', ignoreDuplicates: true }).select().maybeSingle();
  if (insertErr) console.error('pubsub: message save failed', message.id, insertErr);

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
