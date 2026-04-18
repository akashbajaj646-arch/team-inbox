import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendNewEmail } from '@/lib/gmail';

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
    .select('*, from_inbox:inboxes(id, name, email_address, google_refresh_token)')
    .eq('id', broadcastId)
    .single();

  if (!broadcast) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
  if (!broadcast.from_inbox?.google_refresh_token) {
    return NextResponse.json({ error: 'Inbox not connected to Gmail' }, { status: 400 });
  }

  // Insert all recipients as pending
  const recipientRows = recipients.map((r: any) => ({
    broadcast_id: broadcastId,
    contact_id: r.contact_id || null,
    email: r.email,
    status: 'pending',
  }));

  await service.from('broadcast_recipients').insert(recipientRows);

  // Update broadcast to sending
  await service
    .from('broadcasts')
    .update({
      status: 'sending',
      recipient_count: recipients.length,
      sent_at: new Date().toISOString(),
    })
    .eq('id', broadcastId);

  // Send emails one by one with small delay to avoid Gmail rate limits
  let sent = 0;
  let failed = 0;

  const { data: pendingRecipients } = await service
    .from('broadcast_recipients')
    .select('id, email')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');

  for (const r of pendingRecipients || []) {
    try {
      await sendNewEmail(broadcast.from_inbox.google_refresh_token, {
        to: r.email,
        subject: broadcast.subject,
        body: broadcast.body_html,
      });

      await service
        .from('broadcast_recipients')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', r.id);

      sent++;

      // Small delay to avoid hitting Gmail rate limits (500 quota units/user/second)
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err: any) {
      console.error(`Failed to send to ${r.email}:`, err.message);
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
