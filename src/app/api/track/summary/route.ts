import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/track/summary?threadId=... -> tracking stats keyed by gmail_message_id
export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get('threadId');
  if (!threadId) return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = await createServiceClient();
  const { data: thread } = await service
    .from('email_threads')
    .select('inbox_id')
    .eq('id', threadId)
    .limit(1)
    .maybeSingle();
  if (!thread) return NextResponse.json({ tracking: {} });

  const { data: membership } = await service
    .from('inbox_members')
    .select('user_id')
    .eq('inbox_id', thread.inbox_id)
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const { data: msgs } = await service
    .from('email_messages')
    .select('gmail_message_id')
    .eq('thread_id', threadId)
    .eq('is_outbound', true);
  const gmailIds = (msgs || []).map((m: any) => m.gmail_message_id).filter(Boolean);
  if (gmailIds.length === 0) return NextResponse.json({ tracking: {} });

  const { data: rows } = await service
    .from('email_tracking')
    .select('id, gmail_message_id, open_count, click_count, first_opened_at, last_opened_at, last_clicked_at, links:email_tracking_links(idx, url, click_count)')
    .in('gmail_message_id', gmailIds);

  const tracking: Record<string, any> = {};
  for (const r of rows || []) {
    tracking[r.gmail_message_id] = {
      open_count: r.open_count,
      click_count: r.click_count,
      first_opened_at: r.first_opened_at,
      last_opened_at: r.last_opened_at,
      last_clicked_at: r.last_clicked_at,
      links: ((r as any).links || [])
        .filter((l: any) => l.click_count > 0)
        .sort((a: any, b: any) => b.click_count - a.click_count),
    };
  }
  return NextResponse.json({ tracking });
}
