import { getThread, parseHeaders, parseEmailAddress, extractBody, extractAttachments } from '@/lib/gmail';
import { routeThread } from '@/lib/filter-routing';

/**
 * Imports one Gmail thread (thread row, messages, attachments) into Supabase if missing.
 * Returns the local thread id, or null if the thread could not be imported.
 */
export async function importGmailThread(
  svc: any,
  inbox: { id: string; email_address: string; google_refresh_token: string },
  gmailThreadId: string
): Promise<string | null> {
  const gmailThread = await getThread(inbox.google_refresh_token, gmailThreadId);
  if (!gmailThread.messages?.length) return null;

  const first = gmailThread.messages[0];
  const last = gmailThread.messages[gmailThread.messages.length - 1];
  const headers = parseHeaders(first.payload.headers);

  const { data: existing } = await svc
    .from('email_threads')
    .select('id')
    .eq('gmail_thread_id', gmailThread.id)
    .eq('inbox_id', inbox.id)
    .limit(1)
    .maybeSingle();

  let threadId: string;
  if (existing) {
    threadId = existing.id;
  } else {
    const { data: created } = await svc
      .from('email_threads')
      .insert({
        inbox_id: inbox.id,
        gmail_thread_id: gmailThread.id,
        subject: headers.subject || '(No subject)',
        snippet: last.snippet,
        last_message_at: new Date(parseInt(last.internalDate)).toISOString(),
        is_read: !last.labelIds?.includes('UNREAD'),
        is_archived: !gmailThread.messages.some((m: any) => m.labelIds?.includes('INBOX')),
      })
      .select('id')
      .maybeSingle();
    if (!created) return null;
    threadId = created.id;
  }

  const inboxAddr = (inbox.email_address || '').toLowerCase();
  for (const message of gmailThread.messages) {
    const h = parseHeaders(message.payload.headers);
    const from = parseEmailAddress(h.from || '');
    const body = extractBody(message);
    const split = (v?: string) =>
      (v || '').split(',').map((a: string) => parseEmailAddress(a.trim()).address).filter(Boolean);

    const { data: inserted } = await svc
      .from('email_messages')
      .upsert(
        {
          thread_id: threadId,
          gmail_message_id: message.id,
          from_address: from.address,
          from_name: from.name,
          to_addresses: split(h.to),
          cc_addresses: split(h.cc),
          body_html: body.html,
          body_text: body.text,
          sent_at: new Date(parseInt(message.internalDate)).toISOString(),
          is_outbound: from.address.toLowerCase() === inboxAddr,
        },
        { onConflict: 'gmail_message_id', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle();

    // Only newly inserted messages get attachment rows, so nothing is duplicated
    if (inserted) {
      const rows = extractAttachments(message).map((att) => ({
        message_id: inserted.id,
        thread_id: threadId,
        filename: att.filename,
        mime_type: att.mimeType,
        size: att.size,
        gmail_attachment_id: att.attachmentId,
        is_inline: att.isInline || false,
        content_id: att.contentId || null,
      }));
      // One insert per row: a duplicate (blocked by the unique index) must not drop the others
      for (const row of rows) await svc.from('email_attachments').insert(row);
    }
  }
  await routeThread(svc, inbox.id, threadId);
  return threadId;
}
