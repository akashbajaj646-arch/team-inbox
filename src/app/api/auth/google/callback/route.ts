import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTokensFromCode, getUserEmail } from '@/lib/gmail';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const stateRaw = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${origin}/settings?error=${error}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/settings?error=no_code`);
  }

  // Parse state — supports both old format (plain inboxId string) and new format (JSON)
  let inboxId: string | null = null;
  let isPersonal = false;

  if (stateRaw) {
    try {
      const parsed = JSON.parse(stateRaw);
      inboxId = parsed.inboxId || null;
      isPersonal = parsed.isPersonal === true;
    } catch {
      // Old format: state was just the inboxId string
      inboxId = stateRaw;
    }
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

    if (inboxId) {
      // Updating an existing inbox (reconnecting)
      const { error: updateError } = await supabase
        .from('inboxes')
        .update({
          google_refresh_token: tokens.refresh_token,
          email_address: emailAddress,
        })
        .eq('id', inboxId);

      if (updateError) {
        console.error('Error updating inbox:', updateError);
        return NextResponse.redirect(`${origin}/settings?error=update_failed`);
      }
    } else {
      // Creating a new inbox
      const { data: inbox, error: insertError } = await supabase
        .from('inboxes')
        .insert({
          name: isPersonal
            ? emailAddress.split('@')[0]   // "camilo" for personal
            : emailAddress,                 // full email for shared
          email_address: emailAddress,
          google_refresh_token: tokens.refresh_token,
          inbox_type: 'email',
          is_personal: isPersonal,
          owner_user_id: isPersonal ? user.id : null,
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

    return NextResponse.redirect(`${origin}/?success=connected`);
  } catch (err) {
    console.error('OAuth error:', err);
    return NextResponse.redirect(`${origin}/settings?error=oauth_failed`);
  }
}
