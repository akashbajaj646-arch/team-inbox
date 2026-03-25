import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAttachment } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('messageId');
    const attachmentId = searchParams.get('attachmentId');
    const inboxId = searchParams.get('inboxId');

    if (!messageId || !attachmentId || !inboxId) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    const supabase = await createServiceClient();

    const { data: inbox } = await supabase
      .from('inboxes')
      .select('google_refresh_token')
      .eq('id', inboxId)
      .single();

    if (!inbox?.google_refresh_token) {
      return NextResponse.json({ error: 'Inbox not found' }, { status: 404 });
    }

    const data = await getAttachment(inbox.google_refresh_token, messageId, attachmentId);
    const buffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('Image proxy error:', err);
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
  }
}
