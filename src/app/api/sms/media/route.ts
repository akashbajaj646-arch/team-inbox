import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const inboxId = searchParams.get('inboxId');

  if (!url || !inboxId) {
    return NextResponse.json({ error: 'Missing url or inboxId' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const serviceSupabase = await createServiceClient();
  const { data: inbox } = await serviceSupabase
    .from('inboxes')
    .select('twilio_account_sid, twilio_auth_token')
    .eq('id', inboxId)
    .single();

  if (!inbox) return NextResponse.json({ error: 'Inbox not found' }, { status: 404 });

  const credentials = Buffer.from(`${inbox.twilio_account_sid}:${inbox.twilio_auth_token}`).toString('base64');
  const mediaResponse = await fetch(url, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!mediaResponse.ok) {
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 502 });
  }

  const contentType = mediaResponse.headers.get('content-type') || 'application/octet-stream';
  const buffer = await mediaResponse.arrayBuffer();

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
