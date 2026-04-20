import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Twilio Webhook — handles both inbound SMS and WhatsApp messages.
 *
 * WhatsApp messages from Twilio arrive with:
 *   From: whatsapp:+1234567890
 *   To:   whatsapp:+0987654321
 *
 * We strip the "whatsapp:" prefix to find the inbox by phone number,
 * then route to the correct inbox_type ('sms' or 'whatsapp').
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const messageSid = formData.get('MessageSid') as string;
    const fromRaw = formData.get('From') as string;
    const toRaw = formData.get('To') as string;
    const body = formData.get('Body') as string;
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');

    if (!messageSid || !fromRaw || !toRaw) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Detect WhatsApp vs SMS
    const isWhatsApp = fromRaw.startsWith('whatsapp:') || toRaw.startsWith('whatsapp:');
    const from = fromRaw.replace('whatsapp:', '');
    const to = toRaw.replace('whatsapp:', '');
    const expectedInboxType = isWhatsApp ? 'whatsapp' : 'sms';

    const supabase = await createServiceClient();

    // Find the inbox for this Twilio number
    const { data: inbox, error: inboxError } = await supabase
      .from('inboxes')
      .select('*')
      .eq('twilio_phone_number', to)
      .eq('inbox_type', expectedInboxType)
      .single();

    if (inboxError || !inbox) {
      console.error(`No ${expectedInboxType} inbox found for phone number:`, to);
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Handle SMS opt-out keywords (A2P 10DLC compliance)
    const bodyTrimmed = (body || '').trim().toUpperCase();
    const optOutKeywords = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    const optInKeywords = ['START', 'UNSTOP', 'YES'];

    if (optOutKeywords.includes(bodyTrimmed)) {
      // Mark contact as opted out
      const phoneDigits = from.replace(/\D/g, '');
      await supabase
        .from('inbox_contacts')
        .update({ sms_opted_out: true, sms_opted_out_at: new Date().toISOString() })
        .or(`phone_number.eq.${from},phone_number.ilike.%${phoneDigits}%`);
      console.log(`SMS opt-out: ${from}`);
    } else if (optInKeywords.includes(bodyTrimmed)) {
      // Re-opt-in
      const phoneDigits = from.replace(/\D/g, '');
      await supabase
        .from('inbox_contacts')
        .update({ sms_opted_out: false, sms_opted_out_at: null })
        .or(`phone_number.eq.${from},phone_number.ilike.%${phoneDigits}%`);
      console.log(`SMS opt-in: ${from}`);
    }

    // Find or create thread for this contact
    const { data: threads } = await supabase
      .from('sms_threads')
      .select('*')
      .eq('inbox_id', inbox.id)
      .eq('contact_phone', from)
      .order('created_at', { ascending: false })
      .limit(1);
    let thread = threads?.[0] || null;

    if (!thread) {
      const { data: newThread, error: threadError } = await supabase
        .from('sms_threads')
        .insert({
          inbox_id: inbox.id,
          contact_phone: from,
          contact_name: null,
          last_message_at: new Date().toISOString(),
          last_message_preview: body?.substring(0, 100) || '[Media]',
          is_read: false,
        })
        .select()
        .single();

      if (threadError) {
        console.error('Error creating thread:', threadError);
        return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 });
      }
      thread = newThread;
    } else {
      await supabase
        .from('sms_threads')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: body?.substring(0, 100) || '[Media]',
          is_read: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', thread.id);
    }

    // Create the message
    const { data: message, error: messageError } = await supabase
      .from('sms_messages')
      .insert({
        thread_id: thread.id,
        twilio_message_sid: messageSid,
        direction: 'inbound',
        from_number: from,
        to_number: to,
        body: body || null,
        status: 'received',
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (messageError) {
      console.error('Error creating message:', messageError);
      return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
    }

    // Handle MMS / WhatsApp media attachments
    if (numMedia > 0 && message) {
      const attachments = [];
      for (let i = 0; i < numMedia; i++) {
        const mediaUrl = formData.get(`MediaUrl${i}`) as string;
        const contentType = formData.get(`MediaContentType${i}`) as string;
        if (mediaUrl) {
          attachments.push({
            message_id: message.id,
            media_url: mediaUrl,
            content_type: contentType || null,
          });
        }
      }

      if (attachments.length > 0) {
        await supabase.from('sms_attachments').insert(attachments);
      }
    }

    // Return empty TwiML (no auto-reply)
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    );
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'twilio-webhook' });
}
