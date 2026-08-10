import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Twilio Status Callback — receives delivery status updates for outbound
 * SMS/WhatsApp messages (queued -> sent -> delivered, or failed/undelivered).
 * Updates the message row so the UI can show failures.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const messageSid = formData.get('MessageSid') as string;
    const messageStatus = formData.get('MessageStatus') as string;
    const errorCode = formData.get('ErrorCode') as string | null;

    if (!messageSid || !messageStatus) {
      return new Response('', { status: 200 });
    }

    const supabase = await createServiceClient();

    const update: Record<string, any> = { status: messageStatus };

    if (messageStatus === 'failed' || messageStatus === 'undelivered') {
      update.error_code = errorCode || null;
      update.error_message = errorCode
        ? `Twilio error ${errorCode} — https://www.twilio.com/docs/api/errors/${errorCode}`
        : 'Message failed to deliver';
    }

    await supabase
      .from('sms_messages')
      .update(update)
      .eq('twilio_message_sid', messageSid);

    return new Response('', { status: 200 });
  } catch (err) {
    console.error('Status callback error:', err);
    return new Response('', { status: 200 });
  }
}
