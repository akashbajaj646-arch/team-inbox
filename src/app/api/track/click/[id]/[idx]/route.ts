import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { BOT_UA, TRACKING_GRACE_MS } from '@/lib/email-tracking';

export const dynamic = 'force-dynamic';

const FALLBACK_URL = 'https://advanceapparels.com';

export async function GET(request: Request, { params }: { params: { id: string; idx: string } }) {
  const { id } = params;
  const idx = Number(params.idx);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(idx)) {
    return NextResponse.redirect(FALLBACK_URL, 302);
  }

  const service = await createServiceClient();
  const { data: link } = await service
    .from('email_tracking_links')
    .select('url, tracking:email_tracking(sent_at)')
    .eq('tracking_id', id)
    .eq('idx', idx)
    .limit(1)
    .maybeSingle();

  const target = link?.url && /^https?:\/\//i.test(link.url) ? link.url : FALLBACK_URL;

  try {
    if (link) {
      const ua = request.headers.get('user-agent') || '';
      const sentAt = (link as any).tracking?.sent_at;
      const tooSoon = sentAt && Date.now() - new Date(sentAt).getTime() < TRACKING_GRACE_MS;

      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user && !tooSoon && !BOT_UA.test(ua)) {
        const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
        const { error } = await service.rpc('record_tracking_event', {
          p_tracking_id: id,
          p_type: 'click',
          p_link_idx: idx,
          p_user_agent: ua.slice(0, 500),
          p_ip: ip,
        });
        if (error) console.error('track click failed', id, idx, error);
      }
    }
  } catch (err) {
    console.error('track click error', err);
  }

  return NextResponse.redirect(target, 302);
}
