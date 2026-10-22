import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAttachment, createGmailClient, extractAttachments } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const attachmentId = searchParams.get('id');
    const inline = searchParams.get('inline') === '1';

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

    // Rows saved without a Gmail attachment id (older outbound sends): look it up once and store it
    let gmailAttachmentId: string | null = attachment.gmail_attachment_id;
    if (!gmailAttachmentId) {
      const gmail = createGmailClient(inbox.google_refresh_token);
      const { data: full } = await gmail.users.messages.get({ userId: 'me', id: message.gmail_message_id, format: 'full' });
      const parts = extractAttachments(full as any);
      const match =
        (attachment.content_id && parts.find((p) => p.contentId === attachment.content_id)) ||
        parts.find((p) => p.filename === attachment.filename);
      if (!match) {
        return NextResponse.json({ error: 'Attachment not found in Gmail' }, { status: 404 });
      }
      gmailAttachmentId = match.attachmentId;
      await supabase.from('email_attachments').update({ gmail_attachment_id: gmailAttachmentId }).eq('id', attachment.id);
    }

    const data = await getAttachment(inbox.google_refresh_token, message.gmail_message_id, gmailAttachmentId as string);
    const buffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': attachment.mime_type || 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(attachment.filename || 'file')}"`,
        ...(inline ? { 'Cache-Control': 'private, max-age=86400' } : {}),
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('Attachment download error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
