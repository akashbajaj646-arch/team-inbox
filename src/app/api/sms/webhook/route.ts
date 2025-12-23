import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import twilio from 'twilio';

// Twilio sends webhooks as form data
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    
    // Extract Twilio webhook data
    const messageSid = formData.get('MessageSid') as string;
    const from = formData.get('From') as string;
    const to = formData.get('To') as string;
    const body = formData.get('Body') as string;
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');
    
    if (!messageSid || !from || !to) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // Find the inbox for this Twilio number
    const { data: inbox, error: inboxError } = await supabase
      .from('inboxes')
      .select('*')
      .eq('twilio_phone_number', to)
      .eq('inbox_type', 'sms')
      .single();

    if (inboxError || !inbox) {
      console.error('No inbox found for phone number:', to);
      return NextResponse.json({ error: 'Inbox not found' }, { status: 404 });
    }

    // Find or create thread for this contact
    let { data: thread } = await supabase
      .from('sms_threads')
      .select('*')
      .eq('inbox_id', inbox.id)
      .eq('contact_phone', from)
      .single();

    if (!thread) {
      // Create new thread
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
      // Update existing thread
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

    // Handle MMS attachments
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
        const { error: attachmentError } = await supabase
          .from('sms_attachments')
          .insert(attachments);

        if (attachmentError) {
          console.error('Error saving attachments:', attachmentError);
        }
      }
    }

    // Return empty TwiML response (we don't auto-reply)
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        headers: { 'Content-Type': 'text/xml' },
      }
    );
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

// Twilio also sends status callbacks - handle those
export async function GET(request: Request) {
  // Health check endpoint
  return NextResponse.json({ status: 'ok', service: 'twilio-webhook' });
}
