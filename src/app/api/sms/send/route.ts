import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
const twilio = require('twilio');

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { threadId, body, mediaUrls, contentSid } = await request.json();

    if (!threadId || (!body && !contentSid && (!mediaUrls || mediaUrls.length === 0))) {
      return NextResponse.json(
        { error: 'Thread ID and message body, contentSid, or media required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the thread
    const { data: thread, error: threadError } = await serviceSupabase
      .from('sms_threads')
      .select('*')
      .eq('id', threadId)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
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

    // Get Twilio credentials from inbox (include inbox_type for WhatsApp detection)
    const { data: inbox } = await serviceSupabase
      .from('inboxes')
      .select('twilio_phone_number, twilio_account_sid, twilio_auth_token, inbox_type')
      .eq('id', thread.inbox_id)
      .single();

    if (!inbox?.twilio_account_sid || !inbox?.twilio_auth_token || !inbox?.twilio_phone_number) {
      return NextResponse.json(
        { error: 'Twilio not configured for this inbox' },
        { status: 400 }
      );
    }

    // Initialize Twilio client
    const twilioClient = twilio(inbox.twilio_account_sid, inbox.twilio_auth_token);

    // Prefix with whatsapp: if this is a WhatsApp inbox
    const isWhatsApp = inbox.inbox_type === 'whatsapp';
    const messageOptions: any = {
      from: isWhatsApp ? `whatsapp:${inbox.twilio_phone_number}` : inbox.twilio_phone_number,
      to: isWhatsApp ? `whatsapp:${thread.contact_phone}` : thread.contact_phone,
    };

    if (contentSid) {
      // Send as a WhatsApp template using contentSid
      messageOptions.contentSid = contentSid;
    } else {
      // Send as a freeform message
      if (body) messageOptions.body = body;
      if (mediaUrls && mediaUrls.length > 0) messageOptions.mediaUrl = mediaUrls;
    }

    const twilioMessage = await twilioClient.messages.create(messageOptions);

    // Save the message to our database
    const { data: message, error: messageError } = await supabase
      .from('sms_messages')
      .insert({
        thread_id: threadId,
        twilio_message_sid: twilioMessage.sid,
        direction: 'outbound',
        from_number: inbox.twilio_phone_number,
        to_number: thread.contact_phone,
        body: body || (contentSid ? '[Template Message]' : null),
        status: twilioMessage.status,
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (messageError) {
      console.error('Error saving message:', messageError);
    }

    // Save attachments if any
    if (mediaUrls && mediaUrls.length > 0 && message) {
      const attachments = mediaUrls.map((url: string) => ({
        message_id: message.id,
        media_url: url,
        content_type: null,
      }));
      await supabase.from('sms_attachments').insert(attachments);
    }

    // Update thread preview
    await serviceSupabase
      .from('sms_threads')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: body?.substring(0, 100) || '[Template Message]',
        is_read: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);

    return NextResponse.json({
      success: true,
      messageSid: twilioMessage.sid,
    });
  } catch (err: any) {
    console.error('Send SMS error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to send message' },
      { status: 500 }
    );
  }
}
