import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { filters } = await request.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let query = supabase
    .from('inbox_contacts')
    .select('id, company_name, first_name, last_name, email_1, total_spend, last_invoice_date, categories_purchased', { count: 'exact' })
    .not('email_1', 'is', null);

  for (const f of filters || []) {
    const { field, operator, value, value2 } = f;
    switch (field) {
      case 'last_invoice_date':
        if (operator === 'within_days') {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - parseInt(value));
          query = query.gte('last_invoice_date', cutoff.toISOString().split('T')[0]);
        } else if (operator === 'older_than_days') {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - parseInt(value));
          query = query.lt('last_invoice_date', cutoff.toISOString().split('T')[0]);
        } else if (operator === 'never') {
          query = query.is('last_invoice_date', null);
        }
        break;
      case 'total_spend':
        if (operator === 'greater_than') query = query.gt('total_spend', parseFloat(value));
        else if (operator === 'less_than') query = query.lt('total_spend', parseFloat(value));
        else if (operator === 'between') query = query.gte('total_spend', parseFloat(value)).lte('total_spend', parseFloat(value2));
        break;
      case 'total_invoices':
        if (operator === 'greater_than') query = query.gt('total_invoices', parseInt(value));
        else if (operator === 'less_than') query = query.lt('total_invoices', parseInt(value));
        break;
      case 'outstanding_balance':
        if (operator === 'has_balance') query = query.gt('outstanding_balance', 0);
        else if (operator === 'no_balance') query = query.eq('outstanding_balance', 0);
        break;
      case 'categories_purchased':
        if (operator === 'includes') query = query.contains('categories_purchased', [value]);
        else if (operator === 'excludes') query = query.not('categories_purchased', 'cs', `{${value}}`);
        break;
      case 'state':
        if (operator === 'equals') query = query.eq('state', value);
        break;
      case 'price_group':
        if (operator === 'equals') query = query.eq('price_group', value);
        break;
      case 'is_active':
        query = query.eq('is_active', value === 'true' || value === true);
        break;
    }
  }

  const { data, count, error } = await query.limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ count: count || 0, preview: data || [] });
}
