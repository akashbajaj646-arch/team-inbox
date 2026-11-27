import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sanitizeDefinition, getUserEmailInboxes } from '@/lib/reports';

export const dynamic = 'force-dynamic';

// POST /api/reports/run -> one row per recipient matching the report definition
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const def = sanitizeDefinition(body);

  const service = createAdminClient();
  const allowed = (await getUserEmailInboxes(service, user.id)).map((i: any) => i.id);
  const inboxIds = def.inbox_ids.length > 0 ? def.inbox_ids.filter((id) => allowed.includes(id)) : allowed;
  if (inboxIds.length === 0) return NextResponse.json({ rows: [] });

  const dateFrom = def.days_back ? new Date(Date.now() - def.days_back * 86_400_000).toISOString() : null;

  const { data, error } = await service.rpc('run_tracking_report', {
    p_inbox_ids: inboxIds,
    p_filters: def.filters,
    p_filter_logic: def.filter_logic,
    p_min_opens: def.min_opens,
    p_min_clicks: def.min_clicks,
    p_threshold_logic: def.threshold_logic,
    p_date_from: dateFrom,
    p_date_to: null,
    p_hide_replied: def.hide_replied,
  });

  if (error) {
    console.error('reports: run failed', error);
    return NextResponse.json({ error: 'Report failed to run' }, { status: 500 });
  }
  return NextResponse.json({ rows: data || [] });
}
