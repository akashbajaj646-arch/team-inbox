import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sanitizeDefinition, getUserEmailInboxes } from '@/lib/reports';

export const dynamic = 'force-dynamic';

// GET /api/reports -> saved reports + the email inboxes the user can report on
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createAdminClient();
  const inboxes = await getUserEmailInboxes(service, user.id);
  const allowed = new Set(inboxes.map((i: any) => i.id));

  const { data, error } = await service
    .from('email_reports')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('reports: list failed', error);
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
  }

  // Shared across the team, hidden only if none of its inboxes are visible to this user
  const reports = (data || []).filter(
    (r: any) => !r.inbox_ids?.length || r.inbox_ids.some((id: string) => allowed.has(id))
  );
  return NextResponse.json({ reports, inboxes });
}

// POST /api/reports -> save a new report
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name) return NextResponse.json({ error: 'Report name is required' }, { status: 400 });

  const def = sanitizeDefinition(body);
  const service = createAdminClient();
  const { data, error } = await service
    .from('email_reports')
    .insert({ name, ...def, created_by: user.id })
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('reports: create failed', error);
    return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
  }
  return NextResponse.json({ report: data });
}
