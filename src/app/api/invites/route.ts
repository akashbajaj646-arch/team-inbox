import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { randomBytes } from 'crypto';

// GET - List pending invites for an inbox
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inboxId = searchParams.get('inboxId');

    if (!inboxId) {
      return NextResponse.json({ error: 'Missing inboxId' }, { status: 400 });
    }

    const supabase = await createClient();

    // Check if user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('role')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (membership?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get pending invites
    const { data: invites, error } = await supabase
      .from('inbox_invites')
      .select('*, invited_by_user:users!invited_by(name, email)')
      .eq('inbox_id', inboxId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching invites:', error);
      return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 });
    }

    return NextResponse.json({ invites });
  } catch (err) {
    console.error('Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST - Create a new invite
export async function POST(request: Request) {
  try {
    const { email, inboxId, role = 'member' } = await request.json();

    if (!email || !inboxId) {
      return NextResponse.json({ error: 'Missing email or inboxId' }, { status: 400 });
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    // Check if user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('role')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (membership?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Check if user already exists and is a member
    const { data: existingUser } = await serviceSupabase
      .from('inbox_users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existingUser) {
      const { data: existingMembership } = await supabase
        .from('inbox_members')
        .select('*')
        .eq('inbox_id', inboxId)
        .eq('user_id', existingUser.id)
        .single();

      if (existingMembership) {
        return NextResponse.json(
          { error: 'User is already a member of this inbox' },
          { status: 400 }
        );
      }
    }

    // Check for existing pending invite
    const { data: existingInvite } = await supabase
      .from('inbox_invites')
      .select('*')
      .eq('inbox_id', inboxId)
      .eq('email', email.toLowerCase().trim())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (existingInvite) {
      return NextResponse.json(
        { error: 'An invite is already pending for this email' },
        { status: 400 }
      );
    }

    // Generate invite token
    const token = randomBytes(32).toString('hex');

    // Create the invite
    const { data: invite, error } = await supabase
      .from('inbox_invites')
      .insert({
        email: email.toLowerCase().trim(),
        inbox_id: inboxId,
        role,
        token,
        invited_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating invite:', error);
      return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
    }

    // Get inbox details for the email
    const { data: inbox } = await supabase
      .from('inboxes')
      .select('name')
      .eq('id', inboxId)
      .single();

    // Get inviter details
    const { data: inviter } = await supabase
      .from('inbox_users')
      .select('name, email')
      .eq('id', user.id)
      .single();

    // Send invite email using the connected Gmail
    // For now, we'll return the invite link - you can add email sending later
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/invite/${token}`;

    return NextResponse.json({
      success: true,
      invite,
      inviteUrl,
      message: `Invite created. Share this link with ${email}: ${inviteUrl}`,
    });
  } catch (err) {
    console.error('Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE - Cancel an invite
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const inviteId = searchParams.get('inviteId');

    if (!inviteId) {
      return NextResponse.json({ error: 'Missing inviteId' }, { status: 400 });
    }

    const supabase = await createClient();

    // Get the invite to check permissions
    const { data: invite } = await supabase
      .from('inbox_invites')
      .select('inbox_id')
      .eq('id', inviteId)
      .single();

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    // Check if user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('role')
      .eq('inbox_id', invite.inbox_id)
      .eq('user_id', user.id)
      .single();

    if (membership?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Delete the invite
    const { error } = await supabase
      .from('inbox_invites')
      .delete()
      .eq('id', inviteId);

    if (error) {
      console.error('Error deleting invite:', error);
      return NextResponse.json({ error: 'Failed to delete invite' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
