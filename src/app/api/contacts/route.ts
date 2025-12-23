import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const phone = searchParams.get('phone');
    const search = searchParams.get('search');

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find contact by email
    if (email) {
      const { data: contact } = await supabase
        .rpc('find_contact_by_email', { 
          search_email: email, 
          search_user_id: user.id 
        })
        .single();

      return NextResponse.json({ contact: contact || null });
    }

    // Find contact by phone
    if (phone) {
      const { data: contact } = await supabase
        .rpc('find_contact_by_phone', { 
          search_phone: phone, 
          search_user_id: user.id 
        })
        .single();

      return NextResponse.json({ contact: contact || null });
    }

    // Search contacts
    if (search) {
      const searchLower = `%${search.toLowerCase()}%`;
      const { data: contacts, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .or(`first_name.ilike.${searchLower},last_name.ilike.${searchLower},company_name.ilike.${searchLower},email_1.ilike.${searchLower},email_2.ilike.${searchLower},email_3.ilike.${searchLower},phone_number.ilike.${searchLower}`)
        .order('company_name', { ascending: true, nullsFirst: false })
        .order('last_name', { ascending: true, nullsFirst: false })
        .limit(50);

      if (error) {
        console.error('Search error:', error);
        return NextResponse.json({ error: 'Search failed' }, { status: 500 });
      }

      return NextResponse.json({ contacts });
    }

    // Get all contacts
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id)
      .order('company_name', { ascending: true, nullsFirst: false })
      .order('last_name', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('Contacts fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
    }

    return NextResponse.json({ contacts });
  } catch (err) {
    console.error('Contacts error:', err);
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { contacts: bulkContacts, ...singleContact } = body;

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Bulk import (CSV)
    if (bulkContacts && Array.isArray(bulkContacts)) {
      const contactsToInsert = bulkContacts.map(c => ({
        user_id: user.id,
        company_name: c.company_name || null,
        first_name: c.first_name || null,
        last_name: c.last_name || null,
        phone_number: c.phone_number || null,
        email_1: c.email_1 || null,
        email_2: c.email_2 || null,
        email_3: c.email_3 || null,
        notes: c.notes || null,
      }));

      const { data, error } = await supabase
        .from('contacts')
        .insert(contactsToInsert)
        .select();

      if (error) {
        console.error('Bulk insert error:', error);
        return NextResponse.json({ error: 'Failed to import contacts' }, { status: 500 });
      }

      return NextResponse.json({ 
        success: true, 
        imported: data.length,
        contacts: data 
      });
    }

    // Single contact creation
    const { company_name, first_name, last_name, phone_number, email_1, email_2, email_3, notes } = singleContact;

    if (!first_name && !last_name && !company_name) {
      return NextResponse.json(
        { error: 'At least a name or company is required' },
        { status: 400 }
      );
    }

    const { data: contact, error } = await supabase
      .from('contacts')
      .insert({
        user_id: user.id,
        company_name: company_name || null,
        first_name: first_name || null,
        last_name: last_name || null,
        phone_number: phone_number || null,
        email_1: email_1 || null,
        email_2: email_2 || null,
        email_3: email_3 || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Contact create error:', error);
      return NextResponse.json({ error: `Failed to create contact: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ contact });
  } catch (err: any) {
    console.error('Contact create error:', err);
    return NextResponse.json({ error: `Failed to create contact: ${err?.message || 'Unknown error'}` }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { contactId, ...updates } = await request.json();

    if (!contactId) {
      return NextResponse.json({ error: 'Contact ID required' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only allow specific fields to be updated
    const allowedFields = ['company_name', 'first_name', 'last_name', 'phone_number', 'email_1', 'email_2', 'email_3', 'notes'];
    const filteredUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
    
    for (const field of allowedFields) {
      if (field in updates) {
        filteredUpdates[field] = updates[field] || null;
      }
    }

    const { data: contact, error } = await supabase
      .from('contacts')
      .update(filteredUpdates)
      .eq('id', contactId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('Contact update error:', error);
      return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
    }

    return NextResponse.json({ contact });
  } catch (err) {
    console.error('Contact update error:', err);
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contactId');

    if (!contactId) {
      return NextResponse.json({ error: 'Contact ID required' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Contact delete error:', error);
      return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Contact delete error:', err);
    return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
  }
}
