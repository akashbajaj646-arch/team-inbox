import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/drafts - list current user's drafts
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: drafts, error } = await supabase
    .from('drafts')
    .select('*, thread:email_threads(id, subject), inbox:inboxes(id, email_address, name)')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ drafts: drafts || [] });
}

// POST /api/drafts - upsert a draft (auto-save)
export async function POST(request: Request) {
  const body = await request.json();
  const { id, draft_type, thread_id, inbox_id, to_address, cc_address, bcc_address, subject, body_html } = body;

  if (!draft_type || (draft_type === 'reply' && !thread_id) || (draft_type === 'new' && !inbox_id)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload: any = {
    user_id: user.id,
    draft_type,
    body_html: body_html || null,
    updated_at: new Date().toISOString(),
  };
  if (thread_id) payload.thread_id = thread_id;
  if (inbox_id) payload.inbox_id = inbox_id;
  if (to_address !== undefined) payload.to_address = to_address;
  if (cc_address !== undefined) payload.cc_address = cc_address;
  if (bcc_address !== undefined) payload.bcc_address = bcc_address;
  if (subject !== undefined) payload.subject = subject;

  if (id) {
    // Update existing
    const { data: draft, error } = await supabase
      .from('drafts')
      .update(payload)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ draft });
  }

  if (draft_type === 'reply') {
    // Upsert by (thread_id, user_id)
    const { data: existing } = await supabase
      .from('drafts')
      .select('id')
      .eq('thread_id', thread_id)
      .eq('user_id', user.id)
      .eq('draft_type', 'reply')
      .maybeSingle();
    if (existing) {
      const { data: draft, error } = await supabase
        .from('drafts')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ draft });
    }
  }

  const { data: draft, error } = await supabase
    .from('drafts')
    .insert(payload)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ draft });
}

// DELETE /api/drafts?id=xxx
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('drafts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
