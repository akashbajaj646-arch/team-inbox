import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { modifyThreadLabels } from '@/lib/gmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Action = 'read' | 'unread' | 'archive' | 'unarchive' | 'trash' | 'restore' | 'snooze' | 'unsnooze';

/**
 * Bulk thread actions. Updates the database, then mirrors read/unread and
 * archive/unarchive to Gmail so the next Gmail push does not undo the change.
 * Body: { threadIds: string[], action: Action, until?: ISO string (snooze) }
 */
export async function POST(request: Request) {
  try {
    const { threadIds, action, until } = (await request.json()) as {
      threadIds: string[];
      action: Action;
      until?: string;
    };
    if (!Array.isArray(threadIds) || threadIds.length === 0 || !action) {
      return NextResponse.json({ error: 'threadIds and action required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const svc = await createServiceClient();

    // Only act on threads in inboxes this user belongs to
    const { data: threads } = await svc
      .from('email_threads')
      .select('id, inbox_id, gmail_thread_id')
      .in('id', threadIds);
    const { data: memberships } = await svc
      .from('inbox_members')
      .select('inbox_id')
      .eq('user_id', user.id);
    const allowed = new Set((memberships || []).map((m: { inbox_id: string }) => m.inbox_id));
    const permitted = (threads || []).filter((t: { inbox_id: string }) => allowed.has(t.inbox_id));
    if (permitted.length === 0) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const ids = permitted.map((t: { id: string }) => t.id);
    let update: Record<string, unknown>;
    switch (action) {
      case 'read': update = { is_read: true }; break;
      case 'unread': update = { is_read: false }; break;
      case 'archive': update = { is_archived: true }; break;
      case 'unarchive': update = { is_archived: false }; break;
      case 'trash': update = { deleted_at: new Date().toISOString() }; break;
      case 'restore': update = { deleted_at: null }; break;
      case 'snooze': {
        if (!until || isNaN(new Date(until).getTime())) {
          return NextResponse.json({ error: 'until required for snooze' }, { status: 400 });
        }
        update = { snoozed_until: new Date(until).toISOString() };
        break;
      }
      case 'unsnooze': update = { snoozed_until: null }; break;
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const { error } = await svc.from('email_threads').update(update).in('id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Mirror to Gmail (best effort; the database change already stands)
    const labels: Partial<Record<Action, { add?: string[]; remove?: string[] }>> = {
      read: { remove: ['UNREAD'] },
      unread: { add: ['UNREAD'] },
      archive: { remove: ['INBOX'] },
      unarchive: { add: ['INBOX'] },
    };
    const change = labels[action];
    if (change) {
      const inboxIds = [...new Set(permitted.map((t: { inbox_id: string }) => t.inbox_id))];
      const { data: inboxes } = await svc
        .from('inboxes')
        .select('id, google_refresh_token')
        .in('id', inboxIds);
      const tokenByInbox = new Map((inboxes || []).map((i: { id: string; google_refresh_token: string | null }) => [i.id, i.google_refresh_token]));
      await Promise.all(
        permitted.map(async (t: { inbox_id: string; gmail_thread_id: string | null }) => {
          const token = tokenByInbox.get(t.inbox_id);
          if (!token || !t.gmail_thread_id) return;
          try {
            await modifyThreadLabels(token, t.gmail_thread_id, change.add, change.remove);
          } catch (e) {
            console.error(`Gmail ${action} failed for ${t.gmail_thread_id}:`, e);
          }
        })
      );
    }

    return NextResponse.json({ success: true, updated: ids.length });
  } catch (err: any) {
    console.error('Thread action error:', err);
    return NextResponse.json({ error: err.message || 'Action failed' }, { status: 500 });
  }
}
