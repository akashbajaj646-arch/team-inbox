import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
const twilio = require('twilio');

/**
 * Send a new SMS or WhatsApp message to a phone number (creates a new thread).
 * Used by the Compose modal when starting a new conversation.
 *
 * POST /api/sms/send-new
 * Body: { inboxId, toPhone, body, channel: 'sms' | 'whatsapp' }
 */
export async function POST(request: Request) {
  try {
    const { inboxId, toPhone, body, channel = 'sms' } = await request.json();

    if (!inboxId || !toPhone || !body) {
      return NextResponse.json(
        { error: 'inboxId, toPhone, and body are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    // Verify auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify inbox access
    const { data: membership } = await supabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get Twilio credentials
    const { data: inbox } = await serviceSupabase
      .from('inboxes')
      .select('twilio_phone_number, twilio_account_sid, twilio_auth_token')
      .eq('id', inboxId)
      .single();

    if (!inbox?.twilio_account_sid || !inbox?.twilio_auth_token || !inbox?.twilio_phone_number) {
      return NextResponse.json(
        { error: 'Twilio not configured for this inbox' },
        { status: 400 }
      );
    }

    const twilioClient = twilio(inbox.twilio_account_sid, inbox.twilio_auth_token);

    // Prefix with whatsapp: if this is a WhatsApp message
    const fromNumber = channel === 'whatsapp'
      ? `whatsapp:${inbox.twilio_phone_number}`
      : inbox.twilio_phone_number;

    const toNumber = channel === 'whatsapp'
      ? `whatsapp:${toPhone}`
      : toPhone;

    // Send via Twilio
    const twilioMessage = await twilioClient.messages.create({
      from: fromNumber,
      to: toNumber,
      body,
    });

    // Find or create thread
    const cleanPhone = toPhone.replace('whatsapp:', '');
    let { data: thread } = await supabase
      .from('sms_threads')
      .select('*')
      .eq('inbox_id', inboxId)
      .eq('contact_phone', cleanPhone)
      .single();

    if (!thread) {
      const { data: newThread } = await supabase
        .from('sms_threads')
        .insert({
          inbox_id: inboxId,
          contact_phone: cleanPhone,
          contact_name: null,
          last_message_at: new Date().toISOString(),
          last_message_preview: body.substring(0, 100),
          is_read: true,
        })
        .select()
        .single();

      thread = newThread;
    }

    if (!thread) {
      return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 });
    }

    // Save message
    await supabase.from('sms_messages').insert({
      thread_id: thread.id,
      twilio_message_sid: twilioMessage.sid,
      direction: 'outbound',
      from_number: inbox.twilio_phone_number,
      to_number: cleanPhone,
      body,
      status: twilioMessage.status,
      sent_at: new Date().toISOString(),
    });

    // Update thread
    await supabase
      .from('sms_threads')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: body.substring(0, 100),
        is_read: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', thread.id);

    return NextResponse.json({
      success: true,
      threadId: thread.id,
      messageSid: twilioMessage.sid,
    });
  } catch (err: any) {
    console.error('Send new SMS error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to send message' },
      { status: 500 }
    );
  }
}
