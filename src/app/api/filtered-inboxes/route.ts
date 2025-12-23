import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET - List filtered inboxes for a parent inbox
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inboxId = searchParams.get('inboxId');

    if (!inboxId) {
      return NextResponse.json({ error: 'Missing inboxId' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify membership
    const { data: membership } = await supabase
      .from('inbox_members')
      .select('role')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { data: filteredInboxes, error } = await supabase
      .from('filtered_inboxes')
      .select('*')
      .eq('inbox_id', inboxId)
      .order('name');

    if (error) {
      console.error('Error fetching filtered inboxes:', error);
      return NextResponse.json({ error: 'Failed to fetch filtered inboxes' }, { status: 500 });
    }

    return NextResponse.json({ filteredInboxes, isAdmin: membership.role === 'admin' });
  } catch (err) {
    console.error('Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST - Create a new filtered inbox
export async function POST(request: Request) {
  try {
    const { inboxId, name, filters, filterLogic = 'any' } = await request.json();

    if (!inboxId || !name || !filters) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify admin role
    const { data: membership } = await supabase
      .from('inbox_members')
      .select('role')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (membership?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { data: filteredInbox, error } = await supabase
      .from('filtered_inboxes')
      .insert({
        inbox_id: inboxId,
        name,
        filters,
        filter_logic: filterLogic,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating filtered inbox:', error);
      return NextResponse.json({ error: 'Failed to create filtered inbox' }, { status: 500 });
    }

    return NextResponse.json({ filteredInbox });
  } catch (err) {
    console.error('Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// PUT - Update a filtered inbox
export async function PUT(request: Request) {
  try {
    const { id, name, filters, filterLogic } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the filtered inbox to check permissions
    const { data: existing } = await supabase
      .from('filtered_inboxes')
      .select('inbox_id')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Verify admin role
    const { data: membership } = await supabase
      .from('inbox_members')
      .select('role')
      .eq('inbox_id', existing.inbox_id)
      .eq('user_id', user.id)
      .single();

    if (membership?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name) updateData.name = name;
    if (filters) updateData.filters = filters;
    if (filterLogic) updateData.filter_logic = filterLogic;

    const { data: filteredInbox, error } = await supabase
      .from('filtered_inboxes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating filtered inbox:', error);
      return NextResponse.json({ error: 'Failed to update filtered inbox' }, { status: 500 });
    }

    return NextResponse.json({ filteredInbox });
  } catch (err) {
    console.error('Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE - Delete a filtered inbox
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the filtered inbox to check permissions
    const { data: existing } = await supabase
      .from('filtered_inboxes')
      .select('inbox_id')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Verify admin role
    const { data: membership } = await supabase
      .from('inbox_members')
      .select('role')
      .eq('inbox_id', existing.inbox_id)
      .eq('user_id', user.id)
      .single();

    if (membership?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { error } = await supabase
      .from('filtered_inboxes')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting filtered inbox:', error);
      return NextResponse.json({ error: 'Failed to delete filtered inbox' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
