import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { listThreads } from '@/lib/gmail';
import { importGmailThread } from '@/lib/gmail-import';
import { parseSearchQuery, isEmptyQuery, likePattern } from '@/lib/search-query';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const GMAIL_FALLBACK_LIMIT = 15;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inboxId = searchParams.get('inboxId');
    const raw = (searchParams.get('q') || '').trim();
    const allowGmail = searchParams.get('gmail') !== '0';

    if (!inboxId || !raw) return NextResponse.json({ threads: [], source: 'local' });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const svc = await createServiceClient();
    const { data: membership } = await svc
      .from('inbox_members')
      .select('inbox_id')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const q = parseSearchQuery(raw);
    if (isEmptyQuery(q)) return NextResponse.json({ threads: [], source: 'local' });

    const { data: hits, error } = await svc.rpc('search_email_threads', {
      p_inbox_id: inboxId,
      p_terms: q.terms.map(likePattern),
      p_from: q.from ? likePattern(q.from) : null,
      p_to: q.to ? likePattern(q.to) : null,
      p_subject: q.subject ? likePattern(q.subject) : null,
      p_has_attachment: q.hasAttachment,
      p_is_unread: q.isUnread ?? null,
      p_is_starred: q.isStarred ?? null,
      p_after: q.after ?? null,
      p_before: q.before ?? null,
      p_limit: 100,
    });
    if (error) {
      console.error('search rpc error:', error);
      return NextResponse.json({ error: 'Search failed: ' + error.message }, { status: 500 });
    }

    let ids: string[] = (hits || []).map((h: { thread_id: string }) => h.thread_id);
    let source: 'local' | 'gmail' = 'local';

    // Nothing locally: ask Gmail with the same query and pull in any threads we haven't synced
    if (ids.length === 0 && allowGmail) {
      const { data: inbox } = await svc
        .from('inboxes')
        .select('id, email_address, google_refresh_token')
        .eq('id', inboxId)
        .limit(1)
        .maybeSingle();
      if (inbox?.google_refresh_token) {
        try {
          const { threads: gThreads } = await listThreads(inbox.google_refresh_token, {
            q: raw,
            maxResults: GMAIL_FALLBACK_LIMIT,
          });
          const imported = await Promise.all(
            gThreads.filter((t) => t.id).map((t) => importGmailThread(svc, inbox, t.id as string).catch(() => null))
          );
          ids = imported.filter((x): x is string => !!x);
          source = 'gmail';
        } catch (e) {
          console.error('Gmail search fallback failed:', e);
        }
      }
    }

    if (ids.length === 0) return NextResponse.json({ threads: [], source });

    const { data: threads } = await svc
      .from('email_threads')
      .select('*')
      .in('id', ids)
      .order('last_message_at', { ascending: false });

    return NextResponse.json({ threads: threads || [], source });
  } catch (err: any) {
    console.error('Search error:', err);
    return NextResponse.json({ error: err.message || 'Search failed' }, { status: 500 });
  }
}
