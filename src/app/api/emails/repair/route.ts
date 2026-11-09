import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { importGmailThread } from '@/lib/gmail-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH = 15;

/**
 * Refills conversations that exist locally but have no saved emails,
 * by re-importing them from Gmail.
 *
 * POST { threadId }             repair one conversation (called automatically when one opens empty)
 * POST { all: true, days?: 30, offset?: 0 } repair up to 15 empty conversations across your inboxes;
 *   call again until `remaining` is 0 (pass offset = total failures so far to skip ones that keep failing)
 */
export async function POST(request: Request) {
  try {
    const { threadId, all, days = 30, offset = 0 } = await request.json().catch(() => ({} as any));

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const svc = await createServiceClient();

    const { data: memberships } = await svc
      .from('inbox_members')
      .select('inbox_id')
      .eq('user_id', user.id);
    const allowed = new Set<string>((memberships || []).map((m: any) => m.inbox_id));

    type Target = { id: string; inbox_id: string; gmail_thread_id: string };
    let targets: Target[] = [];

    if (threadId) {
      const { data: t } = await svc
        .from('email_threads')
        .select('id, inbox_id, gmail_thread_id')
        .eq('id', threadId)
        .limit(1)
        .maybeSingle();
      if (!t || !allowed.has(t.inbox_id)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      targets = [t as Target];
    } else if (all) {
      const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
      const { data: threads, error } = await svc
        .from('email_threads')
        .select('id, inbox_id, gmail_thread_id')
        .in('inbox_id', Array.from(allowed))
        .gte('last_message_at', since)
        .not('gmail_thread_id', 'is', null)
        .order('last_message_at', { ascending: false })
        .limit(3000);
      if (error) {
        console.error('repair: thread scan failed', error);
        return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
      }

      const ids = (threads || []).map((t: any) => t.id);
      const withMessages = new Set<string>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await svc
          .from('email_messages')
          .select('thread_id')
          .in('thread_id', ids.slice(i, i + 100));
        for (const m of data || []) withMessages.add((m as any).thread_id);
      }
      targets = ((threads || []) as Target[]).filter((t) => !withMessages.has(t.id));
    } else {
      return NextResponse.json({ error: 'Pass threadId or all: true' }, { status: 400 });
    }

    const start = threadId ? 0 : Math.max(0, Number(offset) || 0);
    const batch = targets.slice(start, start + BATCH);
    const inboxIds = Array.from(new Set(batch.map((t) => t.inbox_id)));
    const { data: inboxes } = await svc
      .from('inboxes')
      .select('id, email_address, google_refresh_token')
      .in('id', inboxIds.length ? inboxIds : ['00000000-0000-0000-0000-000000000000']);
    const inboxById = new Map((inboxes || []).map((i: any) => [i.id, i]));

    let repaired = 0;
    const failed: { threadId: string; reason: string }[] = [];

    for (const t of batch) {
      const inbox = inboxById.get(t.inbox_id);
      if (!inbox?.google_refresh_token) {
        failed.push({ threadId: t.id, reason: 'inbox not connected to Google' });
        continue;
      }
      try {
        await importGmailThread(svc, inbox, t.gmail_thread_id);
        const { count } = await svc
          .from('email_messages')
          .select('id', { count: 'exact', head: true })
          .eq('thread_id', t.id);
        if (count && count > 0) repaired++;
        else failed.push({ threadId: t.id, reason: 'no messages saved' });
      } catch (err: any) {
        console.error('repair: import failed', t.id, err?.message || err);
        failed.push({ threadId: t.id, reason: err?.message || 'import failed' });
      }
    }

    return NextResponse.json({
      repaired,
      failed,
      remaining: Math.max(0, targets.length - start - batch.length),
    });
  } catch (err) {
    console.error('repair error:', err);
    return NextResponse.json({ error: 'Repair failed' }, { status: 500 });
  }
}
