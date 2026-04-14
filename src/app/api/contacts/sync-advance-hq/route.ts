import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    // Verify admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .limit(1)
      .single();
    if (!membership) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    // Connect to Advance HQ
    const advanceHQ = createSupabaseClient(
      process.env.ADVANCE_HQ_SUPABASE_URL!,
      process.env.ADVANCE_HQ_SERVICE_ROLE_KEY!
    );

    // Fetch all customers with emails from Advance HQ
    const { data: customers, error: fetchError } = await advanceHQ
      .from('customers')
      .select('id, am_customer_id, customer_name, first_name, last_name, email, phone, city, state, status, is_active, price_group, category')
      .not('email', 'is', null)
      .neq('email', '');

    if (fetchError) {
      console.error('Advance HQ fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch from Advance HQ' }, { status: 500 });
    }

    if (!customers?.length) {
      return NextResponse.json({ synced: 0, message: 'No customers with emails found' });
    }

    // Upsert into Team Inbox contacts
    let synced = 0;
    let errors = 0;
    const batchSize = 50;

    for (let i = 0; i < customers.length; i += batchSize) {
      const batch = customers.slice(i, i + batchSize);

      const upsertData = batch.map(c => ({
        user_id: user.id,
        advance_hq_id: c.id,
        company_name: c.customer_name || null,
        first_name: c.first_name || null,
        last_name: c.last_name || null,
        email_1: c.email ? c.email.toLowerCase().trim() : null,
        phone_number: c.phone || null,
        city: c.city || null,
        state: c.state || null,
        status: c.status || null,
        is_active: c.is_active === 'true' || c.is_active === true,
        price_group: c.price_group || null,
        category: c.category || null,
        last_synced_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await serviceSupabase
        .from('inbox_contacts')
        .upsert(upsertData, {
          onConflict: 'advance_hq_id',
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        errors++;
      } else {
        synced += batch.length;
      }
    }

    return NextResponse.json({
      success: true,
      synced,
      errors,
      total: customers.length,
      message: `Successfully synced ${synced} contacts from Advance HQ`,
    });
  } catch (err: any) {
    console.error('Sync error:', err);
    return NextResponse.json({ error: err.message || 'Sync failed' }, { status: 500 });
  }
}
