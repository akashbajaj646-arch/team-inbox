import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import twilio from 'twilio';

export async function POST(request: Request) {
  try {
    const { inboxId } = await request.json();

    if (!inboxId) {
      return NextResponse.json({ error: 'Inbox ID required' }, { status: 400 });
    }

    const supabase = await createClient();
    const serviceSupabase = await createServiceClient();

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user has access to this inbox
    const { data: membership } = await supabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', inboxId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get Twilio credentials (use service client)
    const { data: inbox } = await serviceSupabase
      .from('inboxes')
      .select('twilio_phone_number, twilio_account_sid, twilio_auth_token')
      .eq('id', inboxId)
      .single();

    if (!inbox?.twilio_account_sid || !inbox?.twilio_auth_token || !inbox?.twilio_phone_number) {
      return NextResponse.json(
        { error: 'Twilio not configured for this inbox' },
        { status: 400 }
      );
    }

    // Initialize Twilio client
    const twilioClient = twilio(inbox.twilio_account_sid, inbox.twilio_auth_token);

    // Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Fetch messages from Twilio (both sent and received)
    const [inboundMessages, outboundMessages] = await Promise.all([
      twilioClient.messages.list({
        to: inbox.twilio_phone_number,
        dateSentAfter: thirtyDaysAgo,
        limit: 1000,
      }),
      twilioClient.messages.list({
        from: inbox.twilio_phone_number,
        dateSentAfter: thirtyDaysAgo,
        limit: 1000,
      }),
    ]);

    const allMessages = [...inboundMessages, ...outboundMessages];
    
    // Sort by date
    allMessages.sort((a, b) => 
      new Date(a.dateSent || a.dateCreated).getTime() - 
      new Date(b.dateSent || b.dateCreated).getTime()
    );

    let syncedCount = 0;
    let threadsCreated = 0;
    const processedSids = new Set<string>();

    for (const msg of allMessages) {
      // Skip duplicates (in case a message appears in both lists)
      if (processedSids.has(msg.sid)) continue;
      processedSids.add(msg.sid);

      // Determine direction and contact phone
      const isInbound = msg.to === inbox.twilio_phone_number;
      const contactPhone = isInbound ? msg.from : msg.to;
      const direction = isInbound ? 'inbound' : 'outbound';

      // Check if message already exists
      const { data: existingMessage } = await serviceSupabase
        .from('sms_messages')
        .select('id')
        .eq('twilio_message_sid', msg.sid)
        .single();

      if (existingMessage) continue; // Skip if already synced

      // Find or create thread for this contact
      let { data: thread } = await serviceSupabase
        .from('sms_threads')
        .select('id')
        .eq('inbox_id', inboxId)
        .eq('contact_phone', contactPhone)
        .single();

      if (!thread) {
        // Create new thread
        const { data: newThread, error: threadError } = await serviceSupabase
          .from('sms_threads')
          .insert({
            inbox_id: inboxId,
            contact_phone: contactPhone,
            contact_name: null,
            last_message_at: msg.dateSent || msg.dateCreated,
            last_message_preview: msg.body?.substring(0, 100) || '[Media]',
            is_read: !isInbound, // Mark as read if outbound
          })
          .select()
          .single();

        if (threadError) {
          console.error('Error creating thread:', threadError);
          continue;
        }
        thread = newThread;
        threadsCreated++;
      }

      // Insert the message
      const { data: newMessage, error: messageError } = await serviceSupabase
        .from('sms_messages')
        .insert({
          thread_id: thread.id,
          twilio_message_sid: msg.sid,
          direction,
          from_number: msg.from,
          to_number: msg.to,
          body: msg.body || null,
          status: msg.status,
          sent_at: msg.dateSent || msg.dateCreated,
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error inserting message:', messageError);
        continue;
      }

      // Fetch and save MMS attachments if any
      if (msg.numMedia && parseInt(msg.numMedia) > 0 && newMessage) {
        try {
          const mediaList = await twilioClient
            .messages(msg.sid)
            .media.list();

          for (const media of mediaList) {
            const mediaUrl = `https://api.twilio.com${media.uri.replace('.json', '')}`;
            
            await serviceSupabase.from('sms_attachments').insert({
              message_id: newMessage.id,
              media_url: mediaUrl,
              content_type: media.contentType,
            });
          }
        } catch (mediaErr) {
          console.error('Error fetching media:', mediaErr);
        }
      }

      syncedCount++;

      // Update thread's last message info
      await serviceSupabase
        .from('sms_threads')
        .update({
          last_message_at: msg.dateSent || msg.dateCreated,
          last_message_preview: msg.body?.substring(0, 100) || '[Media]',
          updated_at: new Date().toISOString(),
        })
        .eq('id', thread.id)
        .lt('last_message_at', msg.dateSent || msg.dateCreated);
    }

    return NextResponse.json({
      success: true,
      synced: syncedCount,
      threadsCreated,
      totalFound: allMessages.length,
    });
  } catch (err: any) {
    console.error('SMS sync error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to sync SMS' },
      { status: 500 }
    );
  }
}
