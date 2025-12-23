import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/gmail';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const inboxId = searchParams.get('inbox_id'); // Optional: for reconnecting an existing inbox
  
  const authUrl = getAuthUrl(inboxId || undefined);
  
  return NextResponse.redirect(authUrl);
}
