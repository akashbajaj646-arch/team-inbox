import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { parseSearchQuery, likePattern } from '@/lib/search-query';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const mode = searchParams.get('mode') || 'search'; // 'search' | 'all'

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all inboxes the user has access to
    const { data: memberships } = await supabase
      .from('inbox_members')
      .select('inbox_id')
      .eq('user_id', user.id);

    if (!memberships?.length) {
      return NextResponse.json({ results: [] });
    }

    const inboxIds = memberships.map(m => m.inbox_id);

    // Get inbox details for labeling results
    const { data: inboxes } = await supabase
      .from('inboxes')
      .select('id, name, inbox_type, email_address, twilio_phone_number')
      .in('id', inboxIds);

    const inboxMap: Record<string, any> = {};
    (inboxes || []).forEach(i => { inboxMap[i.id] = i; });

    const results: any[] = [];

    // ── "All" mode — return recent threads across all inboxes ─────────────
    if (mode === 'all' || !query || query.trim().length < 2) {
      const emailInboxIds = inboxIds.filter(id => inboxMap[id]?.inbox_type === 'email');
      const smsInboxIds = inboxIds.filter(id =>
        inboxMap[id]?.inbox_type === 'sms' || inboxMap[id]?.inbox_type === 'whatsapp'
      );

      if (emailInboxIds.length > 0) {
        const { data: emailThreads } = await supabase
          .from('email_threads')
          .select('id, subject, snippet, last_message_at, is_read, inbox_id')
          .in('inbox_id', emailInboxIds)
          .is('deleted_at', null)
          .order('last_message_at', { ascending: false })
          .limit(100);

        for (const thread of emailThreads || []) {
          results.push({
            id: thread.id,
            type: 'email',
            inbox_id: thread.inbox_id,
            inbox_name: inboxMap[thread.inbox_id]?.name || 'Email',
            subject: thread.subject || '(No subject)',
            snippet: thread.snippet || '',
            from: null,
            last_message_at: thread.last_message_at,
            is_read: thread.is_read,
          });
        }
      }

      if (smsInboxIds.length > 0) {
        const { data: smsThreads } = await supabase
          .from('sms_threads')
          .select('id, contact_phone, contact_name, last_message_preview, last_message_at, is_read, inbox_id')
          .in('inbox_id', smsInboxIds)
          .order('last_message_at', { ascending: false })
          .limit(100);

        for (const thread of smsThreads || []) {
          results.push({
            id: thread.id,
            type: inboxMap[thread.inbox_id]?.inbox_type || 'sms',
            inbox_id: thread.inbox_id,
            inbox_name: inboxMap[thread.inbox_id]?.name || 'SMS',
            subject: thread.contact_name || thread.contact_phone,
            snippet: thread.last_message_preview || '',
            from: thread.contact_phone,
            last_message_at: thread.last_message_at,
            is_read: thread.is_read,
          });
        }
      }

      results.sort((a, b) =>
        new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      );

      return NextResponse.json({ results });
    }

    // ── Search mode ───────────────────────────────────────────────────────
    const smsText = parseSearchQuery(query).terms.join(' ').toLowerCase().trim();
    const q = smsText.replace(/[,()*%\\]/g, ' ').trim();

    const emailInboxIds = inboxIds.filter(id => inboxMap[id]?.inbox_type === 'email');
    const smsInboxIds = inboxIds.filter(id =>
      inboxMap[id]?.inbox_type === 'sms' || inboxMap[id]?.inbox_type === 'whatsapp'
    );

    if (emailInboxIds.length > 0) {
      // Same engine as the per-inbox search, run for every inbox the user can access
      const parsed = parseSearchQuery(query);
      const svc = await createServiceClient();
      const perInbox = await Promise.all(
        emailInboxIds.map((inboxId) =>
          svc.rpc('search_email_threads', {
            p_inbox_id: inboxId,
            p_terms: parsed.terms.map(likePattern),
            p_from: parsed.from ? likePattern(parsed.from) : null,
            p_to: parsed.to ? likePattern(parsed.to) : null,
            p_subject: parsed.subject ? likePattern(parsed.subject) : null,
            p_has_attachment: parsed.hasAttachment,
            p_is_unread: parsed.isUnread ?? null,
            p_is_starred: parsed.isStarred ?? null,
            p_after: parsed.after ?? null,
            p_before: parsed.before ?? null,
            p_limit: 50,
          })
        )
      );
      perInbox.forEach((r) => { if (r.error) console.error('search rpc error:', r.error); });
      const threadIds = perInbox.flatMap((r) => (r.data || []).map((h: { thread_id: string }) => h.thread_id));

      if (threadIds.length > 0) {
        const [{ data: threads }, { data: senders }] = await Promise.all([
          svc.from('email_threads')
            .select('id, subject, snippet, last_message_at, is_read, inbox_id')
            .in('id', threadIds),
          svc.from('email_messages')
            .select('thread_id, from_address, from_name, is_outbound, sent_at')
            .in('thread_id', threadIds)
            .order('sent_at', { ascending: false }),
        ]);

        // Show the most recent outside sender for each thread
        const senderByThread: Record<string, string> = {};
        for (const m of senders || []) {
          if (senderByThread[m.thread_id] || m.is_outbound) continue;
          senderByThread[m.thread_id] = m.from_name || m.from_address;
        }

        for (const thread of threads || []) {
          results.push({
            id: thread.id,
            type: 'email',
            inbox_id: thread.inbox_id,
            inbox_name: inboxMap[thread.inbox_id]?.name || 'Email',
            subject: thread.subject || '(No subject)',
            snippet: thread.snippet || '',
            from: senderByThread[thread.id] || null,
            last_message_at: thread.last_message_at,
            is_read: thread.is_read,
          });
        }
      }
    }

    if (smsInboxIds.length > 0 && q) {
      const { data: smsThreads } = await supabase
        .from('sms_threads')
        .select('id, contact_phone, contact_name, last_message_preview, last_message_at, is_read, inbox_id')
        .in('inbox_id', smsInboxIds)
        .or(`contact_phone.ilike.%${q}%,contact_name.ilike.%${q}%`)
        .order('last_message_at', { ascending: false })
        .limit(20);

      const { data: smsMessageMatches } = await supabase
        .from('sms_messages')
        .select('thread_id, body')
        .ilike('body', `%${q}%`)
        .limit(50);

      const smsMessageThreadIds = [...new Set((smsMessageMatches || []).map(m => m.thread_id))];

      let smsMessageThreads: any[] = [];
      if (smsMessageThreadIds.length > 0) {
        const { data } = await supabase
          .from('sms_threads')
          .select('id, contact_phone, contact_name, last_message_preview, last_message_at, is_read, inbox_id')
          .in('id', smsMessageThreadIds)
          .in('inbox_id', smsInboxIds)
          .order('last_message_at', { ascending: false });
        smsMessageThreads = data || [];
      }

      const seen = new Set<string>();
      for (const thread of [...(smsThreads || []), ...smsMessageThreads]) {
        if (seen.has(thread.id)) continue;
        seen.add(thread.id);
        results.push({
          id: thread.id,
          type: inboxMap[thread.inbox_id]?.inbox_type || 'sms',
          inbox_id: thread.inbox_id,
          inbox_name: inboxMap[thread.inbox_id]?.name || 'SMS',
          subject: thread.contact_name || thread.contact_phone,
          snippet: thread.last_message_preview || '',
          from: thread.contact_phone,
          last_message_at: thread.last_message_at,
          is_read: thread.is_read,
        });
      }
    }

    results.sort((a, b) =>
      new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    );

    return NextResponse.json({ results: results.slice(0, 100) });
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

