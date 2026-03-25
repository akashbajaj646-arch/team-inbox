import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getThread, extractBody } from '@/lib/gmail';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

function createGmailClient(refreshToken: string) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
}

export async function POST(request: Request) {
  try {
    const { inboxId, to, cc, subject, body } = await request.json();

    if (!inboxId || !to || !subject || !body) {
      return NextResponse.json(
        { error: 'inboxId, to, subject, and body are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (!membership) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const { data: inbox } = await serviceSupabase
      .from('inboxes')
      .select('*')
      .eq('id', inboxId)
      .single();

    if (!inbox?.google_refresh_token) {
      return NextResponse.json({ error: 'Inbox not connected to Google' }, { status: 400 });
    }

    const emailLines = [
      `To: ${to}`,
      `From: ${inbox.email_address}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ];
    const email = emailLines.join('\r\n');

    const encodedEmail = Buffer.from(email).toString('base64url');

    const gmail = createGmailClient(inbox.google_refresh_token);
    const sentMessage = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedEmail },
    });

    if (sentMessage.data.threadId) {
      const gmailThread = await getThread(inbox.google_refresh_token, sentMessage.data.threadId);
      const firstMessage = gmailThread.messages?.[0];

      if (firstMessage) {
        const { data: newThread } = await serviceSupabase
          .from('email_threads')
          .insert({
            inbox_id: inboxId,
            gmail_thread_id: sentMessage.data.threadId,
            subject,
            snippet: body.replace(/<[^>]*>/g, '').slice(0, 100),
            last_message_at: new Date().toISOString(),
            is_read: true,
            is_archived: false,
          })
          .select()
          .single();

        if (newThread) {
          const msgBody = extractBody(firstMessage);
          const ccAddresses = cc ? cc.split(',').map((e: string) => e.trim()).filter(Boolean) : [];

          await serviceSupabase.from('email_messages').insert({
            thread_id: newThread.id,
            gmail_message_id: sentMessage.data.id,
            from_address: inbox.email_address,
            from_name: null,
            to_addresses: [to],
            cc_addresses: ccAddresses,
            body_html: msgBody.html || body,
            body_text: msgBody.text,
            sent_at: new Date().toISOString(),
            is_outbound: true,
            sent_by_user_id: user.id,
          });
        }
      }
    }

    return NextResponse.json({ success: true, messageId: sentMessage.data.id });
  } catch (err) {
    console.error('Send new email error:', err);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
