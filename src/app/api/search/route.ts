import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    const q = query.toLowerCase().trim();

    const emailInboxIds = inboxIds.filter(id => inboxMap[id]?.inbox_type === 'email');
    const smsInboxIds = inboxIds.filter(id =>
      inboxMap[id]?.inbox_type === 'sms' || inboxMap[id]?.inbox_type === 'whatsapp'
    );

    if (emailInboxIds.length > 0) {
      const { data: subjectThreads } = await supabase
        .from('email_threads')
        .select('id, subject, snippet, last_message_at, is_read, inbox_id')
        .in('inbox_id', emailInboxIds)
        .is('deleted_at', null)
        .ilike('subject', `%${q}%`)
        .order('last_message_at', { ascending: false })
        .limit(20);

      const { data: messageMatches } = await supabase
        .from('email_messages')
        .select('thread_id, from_address, from_name, body_text')
        .or(`from_address.ilike.%${q}%,from_name.ilike.%${q}%,body_text.ilike.%${q}%`)
        .limit(50);

      const messageThreadIds = [...new Set((messageMatches || []).map(m => m.thread_id))];

      let messageThreads: any[] = [];
      if (messageThreadIds.length > 0) {
        const { data } = await supabase
          .from('email_threads')
          .select('id, subject, snippet, last_message_at, is_read, inbox_id')
          .in('id', messageThreadIds)
          .in('inbox_id', emailInboxIds)
          .is('deleted_at', null)
          .order('last_message_at', { ascending: false });
        messageThreads = data || [];
      }

      const seen = new Set<string>();
      for (const thread of [...(subjectThreads || []), ...messageThreads]) {
        if (seen.has(thread.id)) continue;
        seen.add(thread.id);
        const matchingMsg = (messageMatches || []).find(m => m.thread_id === thread.id);
        results.push({
          id: thread.id,
          type: 'email',
          inbox_id: thread.inbox_id,
          inbox_name: inboxMap[thread.inbox_id]?.name || 'Email',
          subject: thread.subject || '(No subject)',
          snippet: thread.snippet || '',
          from: matchingMsg ? (matchingMsg.from_name || matchingMsg.from_address) : null,
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

    return NextResponse.json({ results: results.slice(0, 50) });
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

