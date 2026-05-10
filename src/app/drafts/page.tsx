'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import DraftsView from '@/components/DraftsView';

export const dynamic = 'force-dynamic';

export default function DraftsPage() {
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) router.push('/login');
      else setLoading(false);
    })();
  }, []);

  function handleSelectDraft(draft: any) {
    // Store the draft in sessionStorage and route to the appropriate place
    if (draft.draft_type === 'reply' && draft.thread_id) {
      sessionStorage.setItem('resumeDraft', JSON.stringify(draft));
      router.push(`/?thread=${draft.thread_id}`);
    } else if (draft.draft_type === 'new' && draft.inbox_id) {
      sessionStorage.setItem('resumeDraft', JSON.stringify(draft));
      router.push(`/?inbox=${draft.inbox_id}&compose=1`);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-texture">
        <div className="text-analog-text-muted font-medium">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-texture">
      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-10 p-2 text-analog-text-muted hover:text-analog-text hover:bg-analog-hover rounded-lg"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
      </button>
      <DraftsView onSelectDraft={handleSelectDraft} />
    </div>
  );
}
