import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sanitizeDefinition } from '@/lib/reports';

export const dynamic = 'force-dynamic';

// PATCH /api/reports/[id] -> update a saved report
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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
    .update({ name, ...def, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('reports: update failed', error);
    return NextResponse.json({ error: 'Failed to update report' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  return NextResponse.json({ report: data });
}

// DELETE /api/reports/[id]
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createAdminClient();
  const { error } = await service.from('email_reports').delete().eq('id', params.id);
  if (error) {
    console.error('reports: delete failed', error);
    return NextResponse.json({ error: 'Failed to delete report' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
