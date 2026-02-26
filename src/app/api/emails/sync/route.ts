import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  listThreads,
  getThread,
  parseHeaders,
  parseEmailAddress,
  extractBody,
} from '@/lib/gmail';

export async function POST(request: Request) {
  try {
    const { inboxId, deepSync } = await request.json();

    if (!inboxId) {
      return NextResponse.json({ error: 'Missing inbox_id' }, { status: 400 });
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    // Verify user has access to this inbox
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Deep sync requires admin
    if (deepSync && membership.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required for deep sync' }, { status: 403 });
    }

    // Get inbox with refresh token (using service role to access encrypted token)
    const { data: inbox, error: inboxError } = await serviceSupabase
      .from('inboxes')
      .select('*')
      .eq('id', inboxId)
      .single();

    if (inboxError || !inbox?.google_refresh_token) {
      return NextResponse.json(
        { error: 'Inbox not connected to Google' },
        { status: 400 }
      );
    }

    let syncedCount = 0;
    let totalProcessed = 0;

    if (deepSync) {
      // Deep sync: get emails from last 30 days using Gmail search query
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const afterDate = thirtyDaysAgo.toISOString().split('T')[0].replace(/-/g, '/');
      
      // Gmail query for emails after a certain date
      const query = `after:${afterDate}`;
      
      let pageToken: string | undefined;
      let pageCount = 0;
      const maxPages = 10; // Safety limit: 10 pages * 100 = up to 1000 threads
      
      do {
        const { threads: gmailThreads, nextPageToken } = await listThreads(
          inbox.google_refresh_token,
          { maxResults: 100, q: query, pageToken }
        );

        for (const gmailThreadSummary of gmailThreads) {
          if (!gmailThreadSummary.id) continue;
          
          const synced = await syncThread(supabase, inboxId, inbox, gmailThreadSummary.id);
          if (synced) syncedCount++;
          totalProcessed++;
        }

        pageToken = nextPageToken ?? undefined;
        pageCount++;
      } while (pageToken && pageCount < maxPages);
      
    } else {
      // Regular sync: just get 50 most recent
      const { threads: gmailThreads } = await listThreads(
        inbox.google_refresh_token,
        { maxResults: 50 }
      );

      for (const gmailThreadSummary of gmailThreads) {
        if (!gmailThreadSummary.id) continue;
        
        const synced = await syncThread(supabase, inboxId, inbox, gmailThreadSummary.id);
        if (synced) syncedCount++;
        totalProcessed++;
      }
    }

    return NextResponse.json({
      success: true,
      synced: syncedCount,
      total: totalProcessed,
      deepSync: !!deepSync,
    });
  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json(
      { error: 'Failed to sync emails' },
      { status: 500 }
    );
  }
}

async function syncThread(
  supabase: any,
  inboxId: string,
  inbox: any,
  gmailThreadId: string
): Promise<boolean> {
  // Check if we already have this thread
  const { data: existingThread } = await supabase
    .from('email_threads')
    .select('id')
    .eq('gmail_thread_id', gmailThreadId)
    .eq('inbox_id', inboxId)
    .single();

  // Get full thread data
  const gmailThread = await getThread(
    inbox.google_refresh_token,
    gmailThreadId
  );

  if (!gmailThread.messages?.length) return false;

  const firstMessage = gmailThread.messages[0];
  const lastMessage = gmailThread.messages[gmailThread.messages.length - 1];
  const headers = parseHeaders(firstMessage.payload.headers);

  if (existingThread) {
    // Update existing thread
    await supabase
      .from('email_threads')
      .update({
        snippet: lastMessage.snippet,
        last_message_at: new Date(
          parseInt(lastMessage.internalDate)
        ).toISOString(),
        is_read: !lastMessage.labelIds?.includes('UNREAD'),
      })
      .eq('id', existingThread.id);

    // Sync any new messages
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
    return false; // Not a new thread
  } else {
    // Create new thread
    const { data: newThread, error: threadError } = await supabase
      .from('email_threads')
      .insert({
        inbox_id: inboxId,
        gmail_thread_id: gmailThread.id,
        subject: headers.subject || '(No subject)',
        snippet: lastMessage.snippet,
        last_message_at: new Date(
          parseInt(lastMessage.internalDate)
        ).toISOString(),
        is_read: !lastMessage.labelIds?.includes('UNREAD'),
        is_archived: !lastMessage.labelIds?.includes('INBOX'),
      })
      .select()
      .single();

    if (threadError) {
      console.error('Error creating thread:', threadError);
      return false;
    }

    // Insert all messages
    for (const message of gmailThread.messages) {
      await insertMessage(supabase, newThread.id, message, inbox.email_address);
    }

    return true; // New thread synced
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

  // Parse to addresses
  const toAddresses = (headers.to || '')
    .split(',')
    .map((addr: string) => parseEmailAddress(addr.trim()).address)
    .filter(Boolean);

  // Parse cc addresses
  const ccAddresses = (headers.cc || '')
    .split(',')
    .map((addr: string) => parseEmailAddress(addr.trim()).address)
    .filter(Boolean);

  // Determine if outbound (sent from inbox email)
  const isOutbound = from.address.toLowerCase() === inboxEmail.toLowerCase();

  await supabase.from('email_messages').insert({
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
  });
}
