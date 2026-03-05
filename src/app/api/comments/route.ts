import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');
    const smsThreadId = searchParams.get('smsThreadId');

    if (!threadId && !smsThreadId) {
      return NextResponse.json(
        { error: 'Missing threadId or smsThreadId' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get comments with user info
    let query = supabase
      .from('thread_comments')
      .select(`
        *,
        user:inbox_users(id, name, email, avatar_url)
      `)
      .order('created_at', { ascending: true });

    if (smsThreadId) {
      query = query.eq('sms_thread_id', smsThreadId);
    } else {
      query = query.eq('thread_id', threadId);
    }

    const { data: comments, error } = await query;

    if (error) {
      console.error('Comments fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch comments' },
        { status: 500 }
      );
    }

    return NextResponse.json({ comments });
  } catch (err) {
    console.error('Comments error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { threadId, smsThreadId, content, mentionedUserIds } = await request.json();

    if ((!threadId && !smsThreadId) || !content) {
      return NextResponse.json(
        { error: 'Missing threadId/smsThreadId or content' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let inboxId: string;

    if (smsThreadId) {
      // Verify access to SMS thread
      const { data: thread } = await supabase
        .from('sms_threads')
        .select('inbox_id')
        .eq('id', smsThreadId)
        .single();

      if (!thread) {
        return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      }
      inboxId = thread.inbox_id;
    } else {
      // Verify access to email thread
      const { data: thread } = await supabase
        .from('email_threads')
        .select('inbox_id')
        .eq('id', threadId)
        .single();

      if (!thread) {
        return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      }
      inboxId = thread.inbox_id;
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

    // Create comment
    const { data: comment, error } = await supabase
      .from('thread_comments')
      .insert({
        thread_id: threadId || null,
        sms_thread_id: smsThreadId || null,
        user_id: user.id,
        content,
        mentioned_user_ids: mentionedUserIds || [],
      })
      .select(`
        *,
        user:inbox_users(id, name, email, avatar_url)
      `)
      .single();

    if (error) {
      console.error('Comment create error:', error);
      return NextResponse.json(
        { error: 'Failed to create comment' },
        { status: 500 }
      );
    }

    // Mark thread as unread for mentioned users so it bubbles to top
    if (mentionedUserIds?.length) {
      if (threadId) {
        await supabase
          .from('email_threads')
          .update({ is_read: false })
          .eq('id', threadId);
      } else if (smsThreadId) {
        await supabase
          .from('sms_threads')
          .update({ is_read: false })
          .eq('id', smsThreadId);
      }
    }

    return NextResponse.json({ comment });
  } catch (err) {
    console.error('Comment error:', err);
    return NextResponse.json(
      { error: 'Failed to create comment' },
      { status: 500 }
    );
  }
}
