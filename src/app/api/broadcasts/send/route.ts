import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendNewEmail } from '@/lib/gmail';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const { broadcastId, recipients } = await request.json();
  if (!broadcastId || !recipients?.length) {
    return NextResponse.json({ error: 'Missing broadcastId or recipients' }, { status: 400 });
  }

  const supabase = await createClient();
  const service = await createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: broadcast } = await service
    .from('broadcasts')
    .select('*, from_inbox:inboxes(id, name, email_address, google_refresh_token, inbox_type, twilio_phone_number, twilio_account_sid, twilio_auth_token, twilio_messaging_service_sid)')
    .eq('id', broadcastId)
    .single();

  if (!broadcast) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });

  const isEmail = broadcast.channel === 'email' || !broadcast.channel;
  const isSMS = broadcast.channel === 'sms';

  if (isEmail && !broadcast.from_inbox?.google_refresh_token) {
    return NextResponse.json({ error: 'Inbox not connected to Gmail' }, { status: 400 });
  }

  if (isSMS && !broadcast.from_inbox?.twilio_phone_number) {
    return NextResponse.json({ error: 'Inbox not configured for SMS' }, { status: 400 });
  }

  // Insert all recipients as pending
  const recipientRows = recipients.map((r: any) => ({
    broadcast_id: broadcastId,
    contact_id: r.contact_id || null,
    email: r.email || null,
    phone_number: r.phone_number || null,
    status: 'pending',
  }));

  await service.from('broadcast_recipients').insert(recipientRows);

  await service
    .from('broadcasts')
    .update({
      status: 'sending',
      recipient_count: recipients.length,
      sent_at: new Date().toISOString(),
    })
    .eq('id', broadcastId);

  let sent = 0;
  let failed = 0;

  const { data: pendingRecipients } = await service
    .from('broadcast_recipients')
    .select('id, email, phone_number')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');

  // Set up Twilio client if SMS
  let twilioClient: any = null;
  if (isSMS) {
    const accountSid = broadcast.from_inbox.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
    const authToken = broadcast.from_inbox.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN;
    twilioClient = twilio(accountSid, authToken);
  }

  for (const r of pendingRecipients || []) {
    try {
      if (isEmail) {
        await sendNewEmail(broadcast.from_inbox.google_refresh_token, {
          to: r.email,
          subject: broadcast.subject,
          body: broadcast.body_html,
        });
      } else if (isSMS) {
        // Strip HTML for SMS
        const smsBody = broadcast.body_html
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();

        const messagingServiceSid = broadcast.from_inbox.twilio_messaging_service_sid;
        const messageParams: any = {
          body: smsBody,
          to: r.phone_number,
        };

        if (messagingServiceSid) {
          messageParams.messagingServiceSid = messagingServiceSid;
        } else {
          messageParams.from = broadcast.from_inbox.twilio_phone_number;
        }

        await twilioClient.messages.create(messageParams);
      }

      await service
        .from('broadcast_recipients')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', r.id);

      sent++;

      // Delay: 200ms for email, 100ms for SMS (Twilio throughput higher)
      await new Promise(resolve => setTimeout(resolve, isSMS ? 100 : 200));
    } catch (err: any) {
      console.error(`Failed to send to ${r.email || r.phone_number}:`, err.message);
      await service
        .from('broadcast_recipients')
        .update({ status: 'failed', error_message: err.message || 'Unknown error' })
        .eq('id', r.id);
      failed++;
    }
  }

  const finalStatus = failed === recipients.length ? 'failed' : 'sent';

  await service
    .from('broadcasts')
    .update({
      status: finalStatus,
      sent_count: sent,
      failed_count: failed,
      completed_at: new Date().toISOString(),
    })
    .eq('id', broadcastId);

  return NextResponse.json({ success: true, sent, failed });
}
