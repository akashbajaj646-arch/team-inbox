import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET - Get invite details by token
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const serviceSupabase = await createServiceClient();

    // Get the invite
    const { data: invite, error } = await serviceSupabase
      .from('invites')
      .select(`
        id,
        email,
        role,
        expires_at,
        inbox:inboxes(id, name),
        inviter:users!invited_by(name, email)
      `)
      .eq('token', token)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !invite) {
      return NextResponse.json(
        { error: 'Invalid or expired invite' },
        { status: 404 }
      );
    }

    // Check if account exists for this email
    const { data: existingUser } = await serviceSupabase
      .from('users')
      .select('id')
      .eq('email', invite.email)
      .single();

    return NextResponse.json({
      invite,
      needsAccount: !existingUser,
    });
  } catch (err) {
    console.error('Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST - Accept an invite
export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Please sign in first' }, { status: 401 });
    }

    // Get the invite
    const { data: invite, error: inviteError } = await serviceSupabase
      .from('invites')
      .select('*')
      .eq('token', token)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: 'Invalid or expired invite' },
        { status: 404 }
      );
    }

    // Verify email matches
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      return NextResponse.json(
        { error: 'This invite was sent to a different email address' },
        { status: 403 }
      );
    }

    // Ensure user profile exists
    const { data: existingProfile } = await serviceSupabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .single();

    if (!existingProfile) {
      await serviceSupabase.from('users').insert({
        id: user.id,
        email: user.email!,
        name: user.user_metadata?.full_name || null,
        avatar_url: user.user_metadata?.avatar_url || null,
      });
    }

    // Check if already a member
    const { data: existingMembership } = await serviceSupabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', invite.inbox_id)
      .eq('user_id', user.id)
      .single();

    if (existingMembership) {
      // Already a member, just mark invite as accepted
      await serviceSupabase
        .from('invites')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', invite.id);

      return NextResponse.json({ success: true, alreadyMember: true });
    }

    // Add user to inbox
    const { error: memberError } = await serviceSupabase
      .from('inbox_members')
      .insert({
        inbox_id: invite.inbox_id,
        user_id: user.id,
        role: invite.role,
      });

    if (memberError) {
      console.error('Error adding member:', memberError);
      return NextResponse.json(
        { error: 'Failed to add you to the inbox' },
        { status: 500 }
      );
    }

    // Mark invite as accepted
    await serviceSupabase
      .from('invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
