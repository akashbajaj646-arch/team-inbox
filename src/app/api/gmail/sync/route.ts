import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { listThreads, getThread, parseHeaders, parseEmailAddress, extractBody } from '@/lib/gmail';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { inboxId, maxResults = 500 } = await request.json();
    if (!inboxId) return NextResponse.json({ error: 'inboxId required' }, { status: 400 });

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: membership } = await supabase.from('inbox_members').select('*').eq('inbox_id', inboxId).eq('user_id', user.id).single();
    if (!membership) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const { data: inbox } = await serviceSupabase.from('inboxes').select('*').eq('id', inboxId).single();
    if (!inbox?.google_refresh_token) return NextResponse.json({ error: 'Gmail not configured' }, { status: 400 });

    const { threads: gmailThreads } = await listThreads(inbox.google_refresh_token, { maxResults });
    let threadsCreated = 0, messagesCreated = 0, threadsUpdated = 0;

    for (const gmailThreadSummary of gmailThreads) {
      if (!gmailThreadSummary.id) continue;
      try {
        const gmailThread = await getThread(inbox.google_refresh_token, gmailThreadSummary.id);
        if (!gmailThread.messages?.length) continue;

        const firstMessage = gmailThread.messages[0];
        const lastMessage = gmailThread.messages[gmailThread.messages.length - 1];
        const headers = parseHeaders(firstMessage.payload.headers);

        const { data: existingThread } = await serviceSupabase.from('email_threads').select('id').eq('gmail_thread_id', gmailThread.id).eq('inbox_id', inboxId).single();

        let threadId: string;
        if (existingThread) {
          threadId = existingThread.id;
          await serviceSupabase.from('email_threads').update({ snippet: lastMessage.snippet, last_message_at: new Date(parseInt(lastMessage.internalDate)).toISOString(), is_read: !lastMessage.labelIds?.includes('UNREAD') }).eq('id', threadId);
          threadsUpdated++;
        } else {
          const { data: newThread } = await serviceSupabase.from('email_threads').insert({ inbox_id: inboxId, gmail_thread_id: gmailThread.id, subject: headers.subject || '(No subject)', snippet: lastMessage.snippet, last_message_at: new Date(parseInt(lastMessage.internalDate)).toISOString(), is_read: !lastMessage.labelIds?.includes('UNREAD'), is_archived: !lastMessage.labelIds?.includes('INBOX') }).select().single();
          if (!newThread) continue;
          threadId = newThread.id;
          threadsCreated++;
        }

        for (const message of gmailThread.messages) {
          const { data: existingMessage } = await serviceSupabase.from('email_messages').select('id').eq('gmail_message_id', message.id).single();
          if (existingMessage) continue;

          const msgHeaders = parseHeaders(message.payload.headers);
          const from = parseEmailAddress(msgHeaders.from || '');
          const body = extractBody(message);
          const toAddresses = (msgHeaders.to || '').split(',').map((addr: string) => parseEmailAddress(addr.trim()).address).filter(Boolean);
          const ccAddresses = (msgHeaders.cc || '').split(',').map((addr: string) => parseEmailAddress(addr.trim()).address).filter(Boolean);

          await serviceSupabase.from('email_messages').insert({ thread_id: threadId, gmail_message_id: message.id, from_address: from.address, from_name: from.name, to_addresses: toAddresses, cc_addresses: ccAddresses, body_html: body.html, body_text: body.text, sent_at: new Date(parseInt(message.internalDate)).toISOString(), is_outbound: from.address.toLowerCase() === inbox.email_address.toLowerCase() });
          messagesCreated++;
        }
      } catch (err) { continue; }
    }

    return NextResponse.json({ success: true, threadsFound: gmailThreads.length, threadsCreated, threadsUpdated, messagesCreated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Sync failed' }, { status: 500 });
  }
}
