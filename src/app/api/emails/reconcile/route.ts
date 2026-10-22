import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { reconcileArchived } from '@/lib/inbox-reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { inboxId } : align archive state with the Gmail inbox
export async function POST(request: Request) {
  try {
    const { inboxId } = await request.json();
    if (!inboxId) return NextResponse.json({ error: 'inboxId required' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const svc = await createServiceClient();
    const { data: membership } = await svc
      .from('inbox_members').select('inbox_id').eq('inbox_id', inboxId).eq('user_id', user.id).limit(1).maybeSingle();
    if (!membership) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const { data: inbox } = await svc
      .from('inboxes').select('id, google_refresh_token, inbox_type').eq('id', inboxId).limit(1).maybeSingle();
    if (!inbox?.google_refresh_token || inbox.inbox_type !== 'email') {
      return NextResponse.json({ skipped: true });
    }

    const result = await reconcileArchived(svc, inbox);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Reconcile error:', err);
    return NextResponse.json({ error: err.message || 'Reconcile failed' }, { status: 500 });
  }
}
