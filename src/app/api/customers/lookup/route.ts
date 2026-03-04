import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const phone = searchParams.get('phone');

    if (!email && !phone) {
      return NextResponse.json({ error: 'Missing email or phone' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let query = supabase
      .from('customers')
      .select(`
        id,
        customer_name,
        account_number,
        email,
        phone,
        city,
        state,
        country,
        status,
        category,
        credit_limit,
        is_active,
        am_customer_id
      `);

    if (email) {
      query = query.ilike('email', email);
    } else if (phone) {
      // Normalize phone: strip all non-digits for comparison
      const digitsOnly = phone.replace(/\D/g, '');
      query = query.or(`phone.ilike.%${digitsOnly}%,phone.ilike.%${phone}%`);
    }

    const { data: customer, error } = await query.maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ customer });
  } catch (err) {
    console.error('Error looking up customer:', err);
    return NextResponse.json({ error: 'Failed to lookup customer' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Link an inbox_contact or thread to a customer manually
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { query: searchQuery } = await request.json();

    if (!searchQuery || searchQuery.length < 2) {
      return NextResponse.json({ customers: [] });
    }

    const { data: customers, error } = await supabase
      .from('customers')
      .select(`
        id,
        customer_name,
        account_number,
        email,
        phone,
        city,
        state,
        status
      `)
      .or(`customer_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%,account_number.ilike.%${searchQuery}%`)
      .limit(8);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ customers });
  } catch (err) {
    console.error('Error searching customers:', err);
    return NextResponse.json({ error: 'Failed to search customers' }, { status: 500 });
  }
}
