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

    const { data: attachment } = await supabase
      .from('email_attachments')
      .select('*')
      .eq('id', attachmentId)
      .single();

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const { data: message } = await supabase
      .from('email_messages')
      .select('gmail_message_id, thread_id')
      .eq('id', attachment.message_id)
      .single();

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    const { data: thread } = await supabase
      .from('email_threads')
      .select('inbox_id')
      .eq('id', message.thread_id)
      .single();

    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const { data: inbox } = await supabase
      .from('inboxes')
      .select('google_refresh_token')
      .eq('id', thread.inbox_id)
      .single();

    if (!inbox?.google_refresh_token) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const data = await getAttachment(inbox.google_refresh_token, message.gmail_message_id, attachment.gmail_attachment_id);
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
