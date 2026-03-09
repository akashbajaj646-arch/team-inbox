import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAttachment } from '@/lib/gmail';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const attachmentId = searchParams.get('id');

    if (!attachmentId) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // Get attachment record with message and inbox info
    const { data: attachment } = await supabase
      .from('email_attachments')
      .select(`
        *,
        message:email_messages(gmail_message_id, thread:email_threads(inbox:inboxes(google_refresh_token)))
      `)
      .eq('id', attachmentId)
      .single();

    if (!attachment) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const refreshToken = attachment.message?.thread?.inbox?.google_refresh_token;
    const gmailMessageId = attachment.message?.gmail_message_id;

    if (!refreshToken || !gmailMessageId) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const data = await getAttachment(refreshToken, gmailMessageId, attachment.gmail_attachment_id);
    const buffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': attachment.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${attachment.filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('Attachment download error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
