import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { createGmailClient } from '@/lib/gmail';

/**
 * Register Gmail push notifications for an inbox.
 *
 * Call this endpoint after connecting a Gmail inbox, and refresh it
 * every 7 days (Gmail watch expires after 7 days).
 *
 * Required env vars:
 * - GOOGLE_PUBSUB_TOPIC: Full topic name, e.g. projects/your-project/topics/gmail-push
 *
 * POST /api/gmail/watch
 * Body: { inboxId: string }
 */
export async function POST(request: Request) {
  try {
    const { inboxId } = await request.json();

    if (!inboxId) {
      return NextResponse.json({ error: 'Missing inboxId' }, { status: 400 });
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    // Verify auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify admin access
    const { data: membership } = await supabase
      .from('inbox_members')
      .select('role')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (!membership || membership.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get inbox
    const { data: inbox } = await serviceSupabase
      .from('inboxes')
      .select('*')
      .eq('id', inboxId)
      .single();

    if (!inbox?.google_refresh_token) {
      return NextResponse.json({ error: 'Inbox not connected to Gmail' }, { status: 400 });
    }

    const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
    if (!topicName) {
      return NextResponse.json(
        { error: 'GOOGLE_PUBSUB_TOPIC env var not set' },
        { status: 500 }
      );
    }

    // Register Gmail watch
    const gmail = createGmailClient(inbox.google_refresh_token);
    const watchResponse = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
      },
    });

    // Store the historyId
    await serviceSupabase
      .from('inboxes')
      .update({
        google_history_id: String(watchResponse.data.historyId),
      })
      .eq('id', inboxId);

    return NextResponse.json({
      ok: true,
      historyId: watchResponse.data.historyId,
      expiration: watchResponse.data.expiration,
      message: 'Gmail push notifications registered. Expires in 7 days — renew before then.',
    });
  } catch (err: any) {
    console.error('Gmail watch error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to register Gmail watch' },
      { status: 500 }
    );
  }
}

/**
 * Refresh all inbox watches (call this on a daily cron to prevent expiry)
 * GET /api/gmail/watch
 */
export async function GET() {
  try {
    const supabase = await createServiceClient();

    const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
    if (!topicName) {
      return NextResponse.json({ error: 'GOOGLE_PUBSUB_TOPIC not set' }, { status: 500 });
    }

    // Get all email inboxes with refresh tokens
    const { data: inboxes } = await supabase
      .from('inboxes')
      .select('id, google_refresh_token')
      .eq('inbox_type', 'email')
      .not('google_refresh_token', 'is', null);

    let renewed = 0;
    let failed = 0;

    for (const inbox of inboxes || []) {
      try {
        const gmail = createGmailClient(inbox.google_refresh_token!);
        const watchResponse = await gmail.users.watch({
          userId: 'me',
          requestBody: { topicName, labelIds: ['INBOX'] },
        });

        await supabase
          .from('inboxes')
          .update({ google_history_id: String(watchResponse.data.historyId) })
          .eq('id', inbox.id);

        renewed++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ ok: true, renewed, failed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
