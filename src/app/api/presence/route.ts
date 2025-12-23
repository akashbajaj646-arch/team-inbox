import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { threadId, status } = await request.json();

    if (!threadId || !status) {
      return NextResponse.json(
        { error: 'Missing threadId or status' },
        { status: 400 }
      );
    }

    if (!['viewing', 'drafting'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Upsert presence
    const { error } = await supabase
      .from('thread_presence')
      .upsert(
        {
          thread_id: threadId,
          user_id: user.id,
          status,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'thread_id,user_id',
        }
      );

    if (error) {
      console.error('Presence error:', error);
      return NextResponse.json(
        { error: 'Failed to update presence' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Presence error:', err);
    return NextResponse.json(
      { error: 'Failed to update presence' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (threadId) {
      // Remove presence for specific thread
      await supabase
        .from('thread_presence')
        .delete()
        .eq('thread_id', threadId)
        .eq('user_id', user.id);
    } else {
      // Remove all presence for user (e.g., on logout or page leave)
      await supabase
        .from('thread_presence')
        .delete()
        .eq('user_id', user.id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Presence delete error:', err);
    return NextResponse.json(
      { error: 'Failed to clear presence' },
      { status: 500 }
    );
  }
}
