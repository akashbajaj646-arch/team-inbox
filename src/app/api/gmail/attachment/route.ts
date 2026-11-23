import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAttachment, createGmailClient, extractAttachments } from '@/lib/gmail';
import convert from 'heic-convert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'attachments';
const CACHE_PREFIX = 'email-cache';
// Attachments never change, so browsers may keep them for a year
const BROWSER_CACHE = 'private, max-age=31536000, immutable';

function respond(buffer: Buffer, mimeType: string, filename: string, inline: boolean, source: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename || 'file')}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': BROWSER_CACHE,
      'X-Attachment-Source': source,
    },
  });
}

// Browsers can't display iPhone HEIC photos, so viewed HEIC images are converted to JPEG once and cached
function isHeic(mimeType: string, filename: string) {
  return /hei[cf]/i.test(mimeType || '') || /\.hei[cf]$/i.test(filename || '');
}

function jpgName(filename: string) {
  return (filename || 'image').replace(/\.hei[cf]$/i, '') + '.jpg';
}

async function respondViewable(supabase: any, cachePath: string, buffer: Buffer, mimeType: string, filename: string, inline: boolean, source: string) {
  if (!inline || !isHeic(mimeType, filename)) return respond(buffer, mimeType, filename, inline, source);
  try {
    const out = Buffer.from(await convert({ buffer, format: 'JPEG', quality: 0.85 }));
    try {
      await supabase.storage.from(BUCKET).upload(`${cachePath}.jpg`, out, { contentType: 'image/jpeg', upsert: true });
    } catch (e) {
      console.error('HEIC jpg cache write failed:', e);
    }
    return respond(out, 'image/jpeg', jpgName(filename), true, `${source}+jpg`);
  } catch (e) {
    console.error('HEIC convert failed:', e);
    return respond(buffer, mimeType, filename, inline, source);
  }
}

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
      .select('id, message_id, thread_id, filename, mime_type, content_id, gmail_attachment_id')
      .eq('id', attachmentId)
      .limit(1)
      .maybeSingle();

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // 1. Fast path: served from our storage cache after the first load
    const cachePath = `${CACHE_PREFIX}/${attachment.id}`;
    if (inline && isHeic(attachment.mime_type, attachment.filename)) {
      const { data: jpg } = await supabase.storage.from(BUCKET).download(`${cachePath}.jpg`);
      if (jpg) return respond(Buffer.from(await jpg.arrayBuffer()), 'image/jpeg', jpgName(attachment.filename), true, 'jpg-cache');
    }
    const { data: cached } = await supabase.storage.from(BUCKET).download(cachePath);
    if (cached) {
      const buffer = Buffer.from(await cached.arrayBuffer());
      return respondViewable(supabase, cachePath, buffer, attachment.mime_type, attachment.filename, inline, 'cache');
    }

    // 2. Slow path: fetch from Gmail. Message and thread lookups run in parallel.
    const [{ data: message }, { data: threadRow }] = await Promise.all([
      supabase.from('email_messages').select('gmail_message_id, thread_id').eq('id', attachment.message_id).limit(1).maybeSingle(),
      attachment.thread_id
        ? supabase.from('email_threads').select('inbox_id').eq('id', attachment.thread_id).limit(1).maybeSingle()
        : Promise.resolve({ data: null as { inbox_id: string } | null }),
    ]);

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    let inboxId = threadRow?.inbox_id;
    if (!inboxId) {
      const { data: t } = await supabase.from('email_threads').select('inbox_id').eq('id', message.thread_id).limit(1).maybeSingle();
      inboxId = t?.inbox_id;
    }
    if (!inboxId) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const { data: inbox } = await supabase
      .from('inboxes')
      .select('google_refresh_token')
      .eq('id', inboxId)
      .limit(1)
      .maybeSingle();

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

    // Save to storage so every later view skips Gmail. A failed cache write never blocks the response.
    try {
      await supabase.storage.from(BUCKET).upload(cachePath, buffer, {
        contentType: attachment.mime_type || 'application/octet-stream',
        upsert: true,
      });
    } catch (e) {
      console.error('Attachment cache write failed:', e);
    }

    return respondViewable(supabase, cachePath, buffer, attachment.mime_type, attachment.filename, inline, 'gmail');
  } catch (err) {
    console.error('Attachment download error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
