import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET: Get messages for a thread
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });
    }

    const supabase = await createClient();

    // Verify user has access
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get thread to verify access
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

    // Get messages with attachments
    const { data: messages, error } = await supabase
      .from('sms_messages')
      .select(`
        *,
        attachments:sms_attachments(*)
      `)
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages });
  } catch (err) {
    console.error('Error fetching SMS messages:', err);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}
