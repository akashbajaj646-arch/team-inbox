import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendReply, getThread, parseHeaders, extractBody, parseEmailAddress } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

interface AttachmentData {
  filename: string;
  mimeType: string;
  data: string; // base64 encoded
}

export async function POST(request: Request) {
  try {
    const { threadId, body, attachments = [], cc, bcc } = await request.json() as {
      threadId: string;
      body: string;
      attachments?: AttachmentData[];
      cc?: string;
      bcc?: string;
    };

    if (!threadId || !body) {
      return NextResponse.json(
        { error: 'Missing threadId or body' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get thread with inbox info
    const { data: thread, error: threadError } = await serviceSupabase
      .from('email_threads')
      .select('*, inbox:inboxes(*)')
      .eq('id', threadId)
      .single();

    if (threadError || !thread) {
      console.error('Thread lookup failed:', { threadId, threadError, thread });
      return NextResponse.json({ error: 'Thread not found', threadId, dbError: threadError?.message }, { status: 404 });
    }

    // Verify user has access to this inbox
    const { data: membership } = await supabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', thread.inbox_id)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get inbox with refresh token
    const { data: inbox } = await serviceSupabase
      .from('inboxes')
      .select('*')
      .eq('id', thread.inbox_id)
      .single();

    if (!inbox?.google_refresh_token) {
      return NextResponse.json(
        { error: 'Inbox not connected to Google' },
        { status: 400 }
      );
    }

    // Get the Gmail thread to find reply-to information
    const gmailThread = await getThread(
      inbox.google_refresh_token,
      thread.gmail_thread_id
    );

    if (!gmailThread.messages?.length) {
      return NextResponse.json(
        { error: 'Could not fetch thread from Gmail' },
        { status: 500 }
      );
    }

    const lastMessage = gmailThread.messages[gmailThread.messages.length - 1];
    const headers = parseHeaders(lastMessage.payload.headers);

    // Determine who to reply to
    const replyTo = headers['reply-to'] || headers.from;
    const { address: toAddress } = parseEmailAddress(replyTo);

    // Build subject (add Re: if not already present)
    let subject = thread.subject;
    if (!subject.toLowerCase().startsWith('re:')) {
      subject = `Re: ${subject}`;
    }

    // Send the reply via Gmail
    const sentMessage = await sendReply(inbox.google_refresh_token, {
      threadId: thread.gmail_thread_id,
      to: toAddress,
      subject,
      body,
      cc: cc || undefined,
      bcc: bcc || undefined,
      inReplyTo: headers['message-id'],
      references: headers.references
        ? `${headers.references} ${headers['message-id']}`
        : headers['message-id'],
      attachments,
    });

    // Parse CC addresses for storage
    const ccAddresses = cc 
      ? cc.split(',').map(e => e.trim()).filter(Boolean)
      : [];
    const bccAddresses = bcc
      ? bcc.split(',').map(e => e.trim()).filter(Boolean)
      : [];

    // Fetch the sent message details and add to our database
    const newGmailThread = await getThread(
      inbox.google_refresh_token,
      thread.gmail_thread_id
    );

    const newMessage = newGmailThread.messages?.find(
      (m) => m.id === sentMessage.id
    );

    if (newMessage) {
      const newBody = extractBody(newMessage);

      await supabase.from('email_messages').insert({
        thread_id: threadId,
        gmail_message_id: newMessage.id,
        from_address: inbox.email_address,
        from_name: null,
        to_addresses: [toAddress],
        cc_addresses: ccAddresses,
        body_html: newBody.html || body,
        body_text: newBody.text,
        sent_at: new Date().toISOString(),
        is_outbound: true,
        sent_by_user_id: user.id,
      });

      // Update thread
      await supabase
        .from('email_threads')
        .update({
          last_message_at: new Date().toISOString(),
          snippet: body.replace(/<[^>]*>/g, '').slice(0, 100),
        })
        .eq('id', threadId);
    }

    // Delete any drafts for this thread by this user
    await supabase
      .from('drafts')
      .delete()
      .eq('thread_id', threadId)
      .eq('user_id', user.id);

    // Clear presence
    await supabase
      .from('thread_presence')
      .delete()
      .eq('thread_id', threadId)
      .eq('user_id', user.id);

    return NextResponse.json({ success: true, messageId: sentMessage.id });
  } catch (err) {
    console.error('Send error:', err);
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    );
  }
}
