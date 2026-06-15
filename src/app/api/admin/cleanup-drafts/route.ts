import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getThread, parseHeaders } from '@/lib/gmail';

// GET: list all email thread ids (for the browser script to iterate)
export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = await createServiceClient();

  // Only threads with 2+ outbound messages can carry draft-revision bloat.
  // Paginate past Supabase's 1000-row cap so nothing is missed.
  const all: any[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('draft_cleanup_candidates')
      .select('id, gmail_thread_id, inbox_id')
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return NextResponse.json({ threads: all, count: all.length });
}

// POST { threadId, dryRun? }: reconcile one thread against Gmail truth
export async function POST(request: Request) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { threadId, dryRun } = await request.json();
    if (!threadId) return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });

    const supabase = await createServiceClient();

    const { data: thread } = await supabase
      .from('email_threads')
      .select('id, gmail_thread_id, inbox_id')
      .eq('id', threadId)
      .maybeSingle();
    if (!thread) return NextResponse.json({ threadId, skipped: 'thread_not_found', deleted: 0 });

    const { data: inbox } = await supabase
      .from('inboxes')
      .select('google_refresh_token, email_address')
      .eq('id', thread.inbox_id)
      .maybeSingle();
    if (!inbox?.google_refresh_token) {
      return NextResponse.json({ threadId, skipped: 'no_token', deleted: 0 });
    }

    // Source of truth = Gmail. getThread already filters DRAFT-labelled messages.
    let realIds: string[] = [];
    let firstHeaders: Record<string, string> | null = null;
    let lastMsg: any = null;
    try {
      const gmailThread = await getThread(inbox.google_refresh_token, thread.gmail_thread_id);
      const msgs = gmailThread.messages || [];
      realIds = msgs.map((m: any) => m.id).filter(Boolean);
      if (msgs.length) {
        firstHeaders = parseHeaders(msgs[0].payload.headers);
        lastMsg = msgs[msgs.length - 1];
      }
    } catch (err: any) {
      return NextResponse.json({ threadId, skipped: 'gmail_error', error: String(err?.message || err), deleted: 0 });
    }

    // Safety: if Gmail returns no real messages, never delete — skip for manual review.
    if (realIds.length === 0) {
      return NextResponse.json({ threadId, skipped: 'no_real_messages', deleted: 0 });
    }

    const { data: rows } = await supabase
      .from('email_messages')
      .select('id, gmail_message_id')
      .eq('thread_id', threadId);

    // Only delete rows we can POSITIVELY confirm are not in Gmail's real set.
    const doomed = (rows || []).filter(
      (r: any) => r.gmail_message_id && !realIds.includes(r.gmail_message_id)
    );

    if (dryRun) {
      return NextResponse.json({
        threadId, dryRun: true,
        wouldDelete: doomed.length,
        kept: realIds.length,
        currentSubjectWillBecome: firstHeaders?.subject || '(No subject)',
      });
    }

    let deleted = 0;
    if (doomed.length > 0) {
      const doomedIds = doomed.map((d: any) => d.id);
      await supabase.from('email_attachments').delete().in('message_id', doomedIds);
      const { error: delErr } = await supabase.from('email_messages').delete().in('id', doomedIds);
      if (delErr) return NextResponse.json({ threadId, error: delErr.message, deleted: 0 }, { status: 500 });
      deleted = doomedIds.length;
    }

    let subjectFixed = false;
    if (firstHeaders && lastMsg) {
      await supabase
        .from('email_threads')
        .update({
          subject: firstHeaders.subject || '(No subject)',
          snippet: lastMsg.snippet,
          last_message_at: new Date(parseInt(lastMsg.internalDate)).toISOString(),
        })
        .eq('id', threadId);
      subjectFixed = true;
    }

    return NextResponse.json({ threadId, deleted, kept: realIds.length, subjectFixed });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
