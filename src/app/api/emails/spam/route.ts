import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { reportSpam, getUnsubscribeInfo, sendUnsubscribeEmail } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { messageId, action } = await request.json();
    // action: 'spam' | 'unsubscribe'

    if (!messageId || !action) {
      return NextResponse.json({ error: 'Missing messageId or action' }, { status: 400 });
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get message + thread + inbox
    const { data: message } = await serviceSupabase
      .from('email_messages')
      .select('gmail_message_id, thread_id')
      .eq('id', messageId)
      .single();
    if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

    const { data: thread } = await serviceSupabase
      .from('email_threads')
      .select('inbox_id, gmail_thread_id')
      .eq('id', message.thread_id)
      .single();
    if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

    const { data: inbox } = await serviceSupabase
      .from('inboxes')
      .select('google_refresh_token, email_address')
      .eq('id', thread.inbox_id)
      .single();
    if (!inbox?.google_refresh_token) return NextResponse.json({ error: 'Inbox not connected' }, { status: 400 });

    if (action === 'spam') {
      await reportSpam(inbox.google_refresh_token, message.gmail_message_id);
      // Archive in our DB
      await serviceSupabase
        .from('email_threads')
        .update({ is_archived: true, deleted_at: new Date().toISOString() })
        .eq('id', message.thread_id);
      return NextResponse.json({ success: true });
    }

    if (action === 'unsubscribe') {
      const { mailto, http } = await getUnsubscribeInfo(inbox.google_refresh_token, message.gmail_message_id);

      if (mailto) {
        await sendUnsubscribeEmail(inbox.google_refresh_token, mailto, inbox.email_address);
        return NextResponse.json({ success: true, method: 'mailto' });
      }

      if (http) {
        // Hit the HTTP unsubscribe URL server-side
        try {
          await fetch(http, { method: 'GET', redirect: 'follow' });
        } catch {}
        return NextResponse.json({ success: true, method: 'http' });
      }

      // No header — return null so frontend can scan body for link
      return NextResponse.json({ success: false, method: 'none', message: 'No unsubscribe header found' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('Spam/unsubscribe error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
