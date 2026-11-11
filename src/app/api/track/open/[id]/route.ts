import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { BOT_UA, TRACKING_GRACE_MS } from '@/lib/email-tracking';

export const dynamic = 'force-dynamic';

// 1x1 transparent GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function pixelResponse() {
  return new NextResponse(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return pixelResponse();

    const ua = request.headers.get('user-agent') || '';
    if (BOT_UA.test(ua) && !/GoogleImageProxy/i.test(ua)) return pixelResponse();

    // Team members viewing the email inside Team Inbox are signed in: don't count them
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return pixelResponse();

    const service = await createServiceClient();
    const { data: tracking } = await service
      .from('email_tracking')
      .select('id, sent_at')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (!tracking) return pixelResponse();
    if (Date.now() - new Date(tracking.sent_at).getTime() < TRACKING_GRACE_MS) return pixelResponse();

    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
    const { error } = await service.rpc('record_tracking_event', {
      p_tracking_id: id,
      p_type: 'open',
      p_link_idx: null,
      p_user_agent: ua.slice(0, 500),
      p_ip: ip,
    });
    if (error) console.error('track open failed', id, error);
  } catch (err) {
    console.error('track open error', err);
  }
  return pixelResponse();
}
