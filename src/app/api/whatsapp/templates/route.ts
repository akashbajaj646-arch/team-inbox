import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inboxId = searchParams.get('inboxId');

    if (!inboxId) {
      return NextResponse.json({ error: 'inboxId is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { data: inbox } = await serviceSupabase
      .from('inboxes')
      .select('twilio_account_sid, twilio_auth_token')
      .eq('id', inboxId)
      .single();

    if (!inbox?.twilio_account_sid || !inbox?.twilio_auth_token) {
      return NextResponse.json({ error: 'Twilio not configured for this inbox' }, { status: 400 });
    }

    const auth = Buffer.from(`${inbox.twilio_account_sid}:${inbox.twilio_auth_token}`).toString('base64');
    const apiResponse = await fetch('https://content.twilio.com/v1/Content', {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!apiResponse.ok) {
      const error = await apiResponse.text();
      console.error('Twilio Content API error:', error);
      return NextResponse.json({ error: 'Failed to fetch templates from Twilio' }, { status: 500 });
    }

    const data = await apiResponse.json();

    // DEBUG MODE: return all templates without filtering + full raw object
    // so we can inspect the actual approval field structure from Twilio
    const raw = data.contents || [];

    const templates = raw.map((t: any) => {
      const body =
        t.types?.['twilio/text']?.body ||
        t.types?.['twilio/quick-reply']?.body ||
        t.types?.['twilio/call-to-action']?.body ||
        t.types?.['twilio/media']?.body ||
        '';

      const variableMatches = body.match(/\{\{(\d+)\}\}/g) || [];
      const variableCount = variableMatches.length
        ? Math.max(...variableMatches.map((v: string) => parseInt(v.replace(/[{}]/g, ''))))
        : 0;

      return {
        sid: t.sid,
        friendlyName: t.friendly_name,
        body,
        variableCount,
        variables: t.variables || {},
        language: t.language,
        approvalRequests: t.approvalRequests,
        approval_requests: t.approval_requests,
        _raw: t,
      };
    });

    return NextResponse.json({ templates, _debug: true, totalCount: raw.length });
  } catch (err: any) {
    console.error('Templates fetch error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch templates' }, { status: 500 });
  }
}
