import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendNewEmail } from '@/lib/gmail';
import { importGmailThread } from '@/lib/gmail-import';
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
    const { inboxId, to, cc, bcc, subject, body, attachments = [], draftId } = await request.json();

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

    const sentMessage = await sendNewEmail(inbox.google_refresh_token, {
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      body,
      attachments,
    });

    // Save the sent email the same way the Gmail sync does (handles Gmail adding it
    // to an existing conversation), and never fail the request: the email already went out.
    if (sentMessage.threadId) {
      try {
        const localThreadId = await importGmailThread(serviceSupabase, inbox, sentMessage.threadId);
        if (localThreadId) {
          await serviceSupabase
            .from('email_threads')
            .update({ last_message_at: new Date().toISOString(), is_read: true, is_archived: false })
            .eq('id', localThreadId);
          const { error: tagErr } = await serviceSupabase
            .from('email_messages')
            .update({ sent_by_user_id: user.id, is_outbound: true })
            .eq('gmail_message_id', sentMessage.id);
          if (tagErr) console.error('send-new: could not tag sender', sentMessage.id, tagErr);
        } else {
          console.error('send-new: sent email not saved locally', sentMessage.threadId);
        }
      } catch (err) {
        console.error('send-new: saving sent email failed (email was sent)', sentMessage.threadId, err);
      }
    }

    if (draftId) {
      await supabase.from('drafts').delete().eq('id', draftId).eq('user_id', user.id);
    }

    return NextResponse.json({ success: true, messageId: sentMessage.id });
  } catch (err) {
    console.error('Send new email error:', err);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
