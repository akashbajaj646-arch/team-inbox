import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const { filters } = await request.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  function buildQuery() {
    let q = supabase
      .from('inbox_contacts')
      .select('id, company_name, first_name, last_name, email_1, phone_number, city, state, total_spend, total_invoices, last_invoice_date, categories_purchased')
      .not('email_1', 'is', null);

    for (const f of filters || []) {
      const { field, operator, value, value2 } = f;
      switch (field) {
        case 'last_invoice_date':
          if (operator === 'within_days') {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - parseInt(value));
            q = q.gte('last_invoice_date', cutoff.toISOString().split('T')[0]);
          } else if (operator === 'older_than_days') {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - parseInt(value));
            q = q.lt('last_invoice_date', cutoff.toISOString().split('T')[0]);
          } else if (operator === 'never') q = q.is('last_invoice_date', null);
          break;
        case 'total_spend':
          if (operator === 'greater_than') q = q.gt('total_spend', parseFloat(value));
          else if (operator === 'less_than') q = q.lt('total_spend', parseFloat(value));
          else if (operator === 'between') q = q.gte('total_spend', parseFloat(value)).lte('total_spend', parseFloat(value2));
          break;
        case 'total_invoices':
          if (operator === 'greater_than') q = q.gt('total_invoices', parseInt(value));
          else if (operator === 'less_than') q = q.lt('total_invoices', parseInt(value));
          break;
        case 'outstanding_balance':
          if (operator === 'has_balance') q = q.gt('outstanding_balance', 0);
          else if (operator === 'no_balance') q = q.eq('outstanding_balance', 0);
          break;
        case 'categories_purchased':
          if (operator === 'includes') q = q.contains('categories_purchased', [value]);
          else if (operator === 'excludes') q = q.not('categories_purchased', 'cs', `{${value}}`);
          break;
        case 'state':
          if (operator === 'equals') q = q.eq('state', value);
          break;
        case 'price_group':
          if (operator === 'equals') q = q.eq('price_group', value);
          break;
        case 'is_active':
          q = q.eq('is_active', value === 'true' || value === true);
          break;
      }
    }
    return q;
  }

  // Paginate through all results
  let all: any[] = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await buildQuery()
      .order('company_name', { ascending: true, nullsFirst: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    page++;
  }

  return NextResponse.json({ contacts: all, total: all.length });
}
