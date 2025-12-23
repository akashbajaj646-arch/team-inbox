'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@/types';
import ThreadView from '@/components/ThreadView';

export default function EmailPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const params = useParams();
  const router = useRouter();
  const threadId = params.threadId as string;
  const supabase = createClient();

  useEffect(() => {
    checkAccess();
  }, [threadId]);

  async function checkAccess() {
    setLoading(true);

    // Get current user
    const { data: { user: authUser } } = await supabase.auth.getUser();
    
    if (!authUser) {
      router.push('/login');
      return;
    }

    // Get user profile
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (!userData) {
      router.push('/login');
      return;
    }

    setUser(userData);

    // Check if user has access to this thread's inbox
    const { data: thread } = await supabase
      .from('email_threads')
      .select('inbox_id')
      .eq('id', threadId)
      .single();

    if (!thread) {
      setHasAccess(false);
      setLoading(false);
      return;
    }

    const { data: membership } = await supabase
      .from('inbox_members')
      .select('*')
      .eq('inbox_id', thread.inbox_id)
      .eq('user_id', authUser.id)
      .single();

    setHasAccess(!!membership);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-analog-primary">
        <div className="text-analog-text-muted">Loading...</div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-analog-primary p-4">
        <div className="max-w-md w-full bg-analog-surface border-2 border-analog-border-strong rounded-xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-error/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-analog-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-6V4a2 2 0 00-2-2H8a2 2 0 00-2 2v5" />
            </svg>
          </div>
          <h1 className="font-display text-xl font-medium text-analog-text mb-2">Access Denied</h1>
          <p className="text-analog-text-muted mb-6">You don't have permission to view this email.</p>
          <button
            onClick={() => router.push('/')}
            className="btn btn-primary"
          >
            Go to Inbox
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-analog-primary">
      {/* Header */}
      <div className="bg-analog-surface border-b-2 border-analog-border-strong px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 text-analog-text-muted hover:text-analog-text transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span className="font-medium">Back to Inbox</span>
        </button>
        
        <div className="flex items-center gap-3">
          <span className="text-sm text-analog-text-faint">Viewing in separate window</span>
        </div>
      </div>

      {/* Email Content */}
      <div className="h-[calc(100vh-57px)]">
        {user && <ThreadView threadId={threadId} currentUser={user} />}
      </div>
    </div>
  );
}
