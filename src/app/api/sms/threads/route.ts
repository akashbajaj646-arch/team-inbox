import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET: List SMS threads for an inbox
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inboxId = searchParams.get('inboxId');
    const view = searchParams.get('view') || 'all'; // all | unread | starred | trash

    if (!inboxId) {
      return NextResponse.json({ error: 'Missing inboxId' }, { status: 400 });
    }

    const supabase = await createClient();

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

    let query = supabase
      .from('sms_threads')
      .select('*')
      .eq('inbox_id', inboxId)
      .order('last_message_at', { ascending: false });

    switch (view) {
      case 'trash':
        query = query.not('deleted_at', 'is', null);
        break;
      case 'unread':
        query = query.is('deleted_at', null).eq('is_read', false);
        break;
      case 'starred':
        query = query.is('deleted_at', null).eq('is_starred', true);
        break;
      default: // 'all'
        query = query.is('deleted_at', null);
        break;
    }

    const { data: threads, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ threads });
  } catch (err) {
    console.error('Error fetching SMS threads:', err);
    return NextResponse.json({ error: 'Failed to fetch threads' }, { status: 500 });
  }
}

// POST: Create a new SMS thread (start conversation with new contact)
export async function POST(request: Request) {
  try {
    const { inboxId, contactPhone, contactName } = await request.json();

    if (!inboxId || !contactPhone) {
      return NextResponse.json(
        { error: 'Missing inboxId or contactPhone' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

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

    // Check if thread already exists
    const { data: existingThread } = await supabase
      .from('sms_threads')
      .select('*')
      .eq('inbox_id', inboxId)
      .eq('contact_phone', contactPhone)
      .single();

    if (existingThread) {
      // If thread was deleted, restore it
      if (existingThread.deleted_at) {
        await supabase
          .from('sms_threads')
          .update({ deleted_at: null, updated_at: new Date().toISOString() })
          .eq('id', existingThread.id);
      }
      return NextResponse.json({ thread: existingThread, existing: true });
    }

    // Create new thread
    const { data: thread, error } = await supabase
      .from('sms_threads')
      .insert({
        inbox_id: inboxId,
        contact_phone: contactPhone,
        contact_name: contactName || null,
        is_read: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ thread, existing: false });
  } catch (err) {
    console.error('Error creating SMS thread:', err);
    return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 });
  }
}

// PATCH: Update thread (mark read, star, soft-delete, restore, update contact name, etc.)
export async function PATCH(request: Request) {
  try {
    const { threadId, ...updates } = await request.json();

    if (!threadId) {
      return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: thread } = await supabase
      .from('sms_threads')
      .select('inbox_id')
      .eq('id', threadId)
      .single();

    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', thread.inbox_id)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const allowedFields = ['is_read', 'is_starred', 'is_archived', 'contact_name', 'deleted_at'];
    const sanitizedUpdates: Record<string, any> = { updated_at: new Date().toISOString() };

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        sanitizedUpdates[key] = value;
      }
    }

    const { data: updatedThread, error } = await supabase
      .from('sms_threads')
      .update(sanitizedUpdates)
      .eq('id', threadId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ thread: updatedThread });
  } catch (err) {
    console.error('Error updating SMS thread:', err);
    return NextResponse.json({ error: 'Failed to update thread' }, { status: 500 });
  }
}

// DELETE: Permanently delete a thread and all its messages
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: thread } = await supabase
      .from('sms_threads')
      .select('inbox_id')
      .eq('id', threadId)
      .single();

    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', thread.inbox_id)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // CASCADE will handle sms_messages and sms_attachments automatically
    const { error } = await supabase
      .from('sms_threads')
      .delete()
      .eq('id', threadId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting SMS thread:', err);
    return NextResponse.json({ error: 'Failed to delete thread' }, { status: 500 });
  }
}
