import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Product search for the //: picker. Proxies to Advance HQ, which returns each style
 * with a thumbnail and a signed link to its read-only style page.
 * Env: ADVANCE_HQ_URL (e.g. https://advance-hq.vercel.app), STYLE_LINK_SECRET (same value as in Advance HQ).
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const q = (new URL(request.url).searchParams.get('q') || '').trim();
    if (q.length < 2) return NextResponse.json({ products: [] });

    const base = process.env.ADVANCE_HQ_URL;
    const key = process.env.STYLE_LINK_SECRET;
    if (!base || !key) {
      return NextResponse.json({ error: 'Product links are not configured (ADVANCE_HQ_URL / STYLE_LINK_SECRET)' }, { status: 500 });
    }

    const res = await fetch(`${base.replace(/\/$/, '')}/api/style/search?q=${encodeURIComponent(q)}`, {
      headers: { 'x-style-key': key },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Advance HQ style search failed:', res.status, data);
      return NextResponse.json({ error: data.error || 'Product search failed' }, { status: 502 });
    }
    return NextResponse.json({ products: data.products || [] });
  } catch (err) {
    console.error('Product search error:', err);
    return NextResponse.json({ error: 'Failed to search products' }, { status: 500 });
  }
}
