import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTokensFromCode, getUserEmail } from '@/lib/gmail';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // Contains inbox_id if connecting an inbox
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${origin}/settings?error=${error}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/settings?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokens = await getTokensFromCode(code);
    
    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${origin}/settings?error=no_refresh_token`);
    }

    // Get the email address associated with this Google account
    const emailAddress = await getUserEmail(tokens.refresh_token);

    const supabase = await createClient();
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.redirect(`${origin}/login`);
    }

    if (state) {
      // Updating an existing inbox
      const { error: updateError } = await supabase
        .from('inboxes')
        .update({
          google_refresh_token: tokens.refresh_token,
          email_address: emailAddress,
        })
        .eq('id', state);

      if (updateError) {
        console.error('Error updating inbox:', updateError);
        return NextResponse.redirect(`${origin}/settings?error=update_failed`);
      }
    } else {
      // Creating a new inbox
      const { data: inbox, error: insertError } = await supabase
        .from('inboxes')
        .insert({
          name: emailAddress.split('@')[0],
          email_address: emailAddress,
          google_refresh_token: tokens.refresh_token,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Error creating inbox:', insertError);
        return NextResponse.redirect(`${origin}/settings?error=create_failed`);
      }

      // Add current user as admin of the inbox
      await supabase.from('inbox_members').insert({
        inbox_id: inbox.id,
        user_id: user.id,
        role: 'admin',
      });
    }

    return NextResponse.redirect(`${origin}/settings?success=connected`);
  } catch (err) {
    console.error('OAuth error:', err);
    return NextResponse.redirect(`${origin}/settings?error=oauth_failed`);
  }
}
