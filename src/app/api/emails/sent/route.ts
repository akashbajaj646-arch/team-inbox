import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

// GET /api/emails/sent?before=<iso>&inboxId=<id>
// Outbound emails across every inbox the user belongs to (shared + personal)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before');
    const inboxFilter = searchParams.get('inboxId');

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const svc = await createServiceClient();

    const { data: memberships } = await svc
      .from('inbox_members')
      .select('inbox_id')
      .eq('user_id', user.id);
    const memberIds = (memberships || []).map((m: { inbox_id: string }) => m.inbox_id);
    if (memberIds.length === 0) return NextResponse.json({ messages: [], inboxes: [], hasMore: false });

    const { data: inboxRows } = await svc
      .from('inboxes')
      .select('id, name, email_address, is_personal, owner_user_id, inbox_type')
      .in('id', memberIds);
    const emailInboxes = (inboxRows || []).filter((i: any) => !i.inbox_type || i.inbox_type === 'email');

    let inboxIds = emailInboxes.map((i: any) => i.id);
    if (inboxFilter) {
      if (!inboxIds.includes(inboxFilter)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      inboxIds = [inboxFilter];
    }
    if (inboxIds.length === 0) return NextResponse.json({ messages: [], inboxes: emailInboxes, hasMore: false });

    let query = svc
      .from('email_messages')
      .select(`
        id, thread_id, from_address, from_name, to_addresses, cc_addresses,
        body_text, sent_at, sent_by_user_id,
        thread:email_threads!inner(id, subject, inbox_id, deleted_at)
      `)
      .eq('is_outbound', true)
      .in('thread.inbox_id', inboxIds)
      .is('thread.deleted_at', null)
      .order('sent_at', { ascending: false })
      .limit(PAGE_SIZE + 1);
    if (before) query = query.lt('sent_at', before);

    const { data: rows, error } = await query;
    if (error) {
      console.error('Sent GET error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const hasMore = (rows || []).length > PAGE_SIZE;
    const page = (rows || []).slice(0, PAGE_SIZE);

    const senderIds = Array.from(new Set(page.map((r: any) => r.sent_by_user_id).filter(Boolean)));
    const senderMap: Record<string, string> = {};
    if (senderIds.length > 0) {
      const { data: senders } = await svc
        .from('inbox_users')
        .select('id, name, email')
        .in('id', senderIds);
      (senders || []).forEach((s: any) => { senderMap[s.id] = s.name || s.email?.split('@')[0] || ''; });
    }

    const inboxMap: Record<string, any> = {};
    emailInboxes.forEach((i: any) => { inboxMap[i.id] = i; });

    const messages = page.map((r: any) => {
      const inbox = inboxMap[r.thread?.inbox_id];
      return {
        id: r.id,
        thread_id: r.thread_id,
        subject: r.thread?.subject || '(No subject)',
        to_addresses: r.to_addresses || [],
        cc_addresses: r.cc_addresses || [],
        snippet: (r.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        sent_at: r.sent_at,
        inbox_id: r.thread?.inbox_id,
        inbox_name: inbox?.name || '',
        is_personal: !!(inbox?.is_personal && inbox?.owner_user_id === user.id),
        sent_by: r.sent_by_user_id ? (senderMap[r.sent_by_user_id] || null) : null,
      };
    });

    return NextResponse.json({ messages, inboxes: emailInboxes, hasMore });
  } catch (err: any) {
    console.error('Sent GET exception:', err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
