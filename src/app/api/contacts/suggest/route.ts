import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Recipient suggestions for the compose window.
 * Searches three name sources and merges them:
 *   1. inbox_contacts (contacts list)
 *   2. customers (Advance HQ), plus any thread_customer_links phones/emails
 *   3. sms_threads.contact_name (threads renamed with the pencil)
 * GET /api/contacts/suggest?q=angelica&mode=email|phone
 */

interface Suggestion {
  key: string;
  value: string;
  name: string;
  company: string | null;
  source: 'contact' | 'customer' | 'thread';
}

function phoneKey(p: string) {
  const d = p.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function toE164(p: string) {
  const d = p.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return p.trim().startsWith('+') ? `+${d}` : p.trim();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') === 'phone' ? 'phone' : 'email';
    const q = (searchParams.get('q') || '').replace(/[,()%*\\]/g, ' ').trim();
    if (q.length < 2) return NextResponse.json({ results: [] });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const s = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    const phoneTerm = digits.length >= 3 ? `%${digits}%` : null;

    const contactFilter = [
      `first_name.ilike.${s}`, `last_name.ilike.${s}`, `company_name.ilike.${s}`,
      `email_1.ilike.${s}`, `email_2.ilike.${s}`, `email_3.ilike.${s}`,
      ...(phoneTerm ? [`phone_number.ilike.${phoneTerm}`] : []),
    ].join(',');

    const customerFilter = [
      `customer_name.ilike.${s}`, `account_number.ilike.${s}`, `email.ilike.${s}`,
      ...(phoneTerm ? [`phone.ilike.${phoneTerm}`] : []),
    ].join(',');

    const [contactsRes, customersRes, threadsRes] = await Promise.all([
      supabase.from('inbox_contacts')
        .select('id, first_name, last_name, company_name, phone_number, email_1, email_2, email_3')
        .or(contactFilter)
        .limit(20),
      supabase.from('customers')
        .select('id, customer_name, email, phone')
        .or(customerFilter)
        .limit(10),
      mode === 'phone'
        ? supabase.from('sms_threads')
            .select('id, contact_name, contact_phone')
            .ilike('contact_name', s)
            .is('deleted_at', null)
            .limit(10)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (contactsRes.error) console.error('suggest contacts error:', contactsRes.error);
    if (customersRes.error) console.error('suggest customers error:', customersRes.error);
    if (threadsRes.error) console.error('suggest threads error:', threadsRes.error);

    const customers = customersRes.data || [];

    // Phones/emails of threads linked to the matching customers
    let links: { customer_id: string; email: string | null; phone: string | null }[] = [];
    if (customers.length > 0) {
      const { data, error } = await supabase
        .from('thread_customer_links')
        .select('customer_id, email, phone')
        .in('customer_id', customers.map(c => c.id));
      if (error) console.error('suggest links error:', error);
      links = (data as any[]) || [];
    }

    const results: Suggestion[] = [];
    const seen = new Set<string>();
    function add(raw: string | null | undefined, name: string, company: string | null, source: Suggestion['source'], id: string) {
      if (!raw || !raw.trim()) return;
      if (mode === 'email' && !raw.includes('@')) return;
      const value = mode === 'phone' ? toE164(raw) : raw.trim();
      const dedupe = mode === 'phone' ? phoneKey(value) : value.toLowerCase();
      if (!dedupe || seen.has(dedupe)) return;
      seen.add(dedupe);
      results.push({ key: `${source}:${id}:${dedupe}`, value, name, company, source });
    }

    for (const c of contactsRes.data || []) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company_name || '';
      if (mode === 'phone') add(c.phone_number, name, c.company_name, 'contact', c.id);
      else for (const e of [c.email_1, c.email_2, c.email_3]) add(e, name, c.company_name, 'contact', c.id);
    }

    for (const c of customers) {
      const name = c.customer_name || '';
      const linked = links.filter(l => l.customer_id === c.id);
      if (mode === 'phone') {
        for (const l of linked) add(l.phone, name, null, 'customer', c.id);
        add(c.phone, name, null, 'customer', c.id);
      } else {
        for (const l of linked) add(l.email, name, null, 'customer', c.id);
        add(c.email, name, null, 'customer', c.id);
      }
    }

    for (const t of (threadsRes.data || []) as any[]) {
      add(t.contact_phone, t.contact_name || '', null, 'thread', t.id);
    }

    return NextResponse.json({ results: results.slice(0, 8) });
  } catch (err) {
    console.error('suggest error:', err);
    return NextResponse.json({ results: [] });
  }
}
