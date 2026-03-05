'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User, FilteredInbox, Inbox } from '@/types';
import Sidebar from '@/components/Sidebar';
import ThreadList from '@/components/ThreadList';
import ThreadView from '@/components/ThreadView';
import SmsThreadList from '@/components/SmsThreadList';
import SmsThreadView from '@/components/SmsThreadView';
import ComposeModal from '@/components/ComposeModal';
import AllInboxesView from '@/components/AllInboxesView';

export default function HomePage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  const [selectedFilteredInboxId, setSelectedFilteredInboxId] = useState<string | null>(null);
  const [selectedFilteredInbox, setSelectedFilteredInbox] = useState<FilteredInbox | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedInbox, setSelectedInbox] = useState<Inbox | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showAllInboxes, setShowAllInboxes] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (selectedInboxId) {
      loadInbox();
    }
  }, [selectedInboxId]);

  useEffect(() => {
    if (selectedFilteredInboxId) {
      loadFilteredInbox();
    } else {
      setSelectedFilteredInbox(null);
    }
  }, [selectedFilteredInboxId]);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }

    const { data: profile } = await supabase
      .from('inbox_users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!profile) {
      const { data: newProfile } = await supabase
        .from('inbox_users')
        .insert({
          id: user.id,
          email: user.email!,
          name: user.user_metadata?.full_name || null,
          avatar_url: user.user_metadata?.avatar_url || null,
        })
        .select()
        .single();

      setCurrentUser(newProfile);
    } else {
      setCurrentUser(profile);
    }

    setLoading(false);
  }

  async function loadInbox() {
    const { data } = await supabase
      .from('inboxes')
      .select('*')
      .eq('id', selectedInboxId)
      .single();

    setSelectedInbox(data);
    setSelectedThreadId(null);
  }

  async function loadFilteredInbox() {
    const { data } = await supabase
      .from('filtered_inboxes')
      .select('*')
      .eq('id', selectedFilteredInboxId)
      .single();

    setSelectedFilteredInbox(data);
    setSelectedThreadId(null);
  }

  async function handleThreadRead(threadId: string) {
    await supabase
      .from('email_threads')
      .update({ is_read: true })
      .eq('id', threadId);
  }

  function handleSelectThread(threadId: string, inboxId: string) {
    setShowAllInboxes(false);
    setSelectedInboxId(inboxId);
    setSelectedFilteredInboxId(null);
    setSelectedThreadId(threadId);
    setShowCompose(false);
  }

  function handleSelectInbox(inboxId: string, filteredInboxId?: string | null) {
    setShowAllInboxes(false);
    setSelectedInboxId(inboxId);
    setSelectedFilteredInboxId(filteredInboxId || null);
    setShowCompose(false);
  }

  function handleSelectAllInboxes() {
    setShowAllInboxes(true);
    setSelectedInboxId(null);
    setSelectedInbox(null);
    setSelectedThreadId(null);
    setSelectedFilteredInboxId(null);
    setShowCompose(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-texture">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-br from-analog-accent to-analog-accent-light flex items-center justify-center shadow-analog-accent">
            <svg className="w-6 h-6 text-white animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-analog-text-muted font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) return null;

  const isSmsInbox = selectedInbox?.inbox_type === 'sms';
  const isWhatsAppInbox = selectedInbox?.inbox_type === 'whatsapp';
  const isMessagingInbox = isSmsInbox || isWhatsAppInbox;

  return (
    <div className="flex h-screen bg-texture">
      <Sidebar
        currentUser={currentUser}
        selectedInboxId={selectedInboxId}
        selectedFilteredInboxId={selectedFilteredInboxId}
        showAllInboxes={showAllInboxes}
        onSelectInbox={handleSelectInbox}
        onSelectAllInboxes={handleSelectAllInboxes}
        onSignOut={handleSignOut}
        onCompose={() => setShowCompose(true)}
        onSelectThread={handleSelectThread}
      />

      {showAllInboxes ? (
        <AllInboxesView currentUser={currentUser} />
      ) : selectedInbox ? (
        <>
          {isMessagingInbox ? (
            <>
              <SmsThreadList
                inbox={selectedInbox}
                selectedThreadId={selectedThreadId}
                onSelectThread={setSelectedThreadId}
                onThreadRead={handleThreadRead}
              />
              {selectedThreadId ? (
                <SmsThreadView
                  threadId={selectedThreadId}
                  inbox={selectedInbox}
                  currentUser={currentUser}
                />
              ) : (
                <EmptyPane
                  icon="chat"
                  label={`Select a ${isWhatsAppInbox ? 'WhatsApp' : 'SMS'} conversation to view`}
                />
              )}
            </>
          ) : (
            <>
              <ThreadList
                inbox={selectedInbox}
                filteredInbox={selectedFilteredInbox}
                selectedThreadId={selectedThreadId}
                onSelectThread={setSelectedThreadId}
                onThreadRead={handleThreadRead}
              />
              {selectedThreadId ? (
                <ThreadView
                  threadId={selectedThreadId}
                  currentUser={currentUser}
                />
              ) : (
                <EmptyPane icon="email" label="Select an email to view" />
              )}
            </>
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-analog-surface">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-analog-surface-alt flex items-center justify-center border-2 border-analog-border">
              <svg className="w-10 h-10 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <h2 className="font-display text-xl font-medium text-analog-text mb-2">No inbox selected</h2>
            <p className="text-analog-text-muted mb-6">Connect a Gmail account or Twilio SMS to get started.</p>
            <div className="flex gap-3 justify-center">
              <a href="/api/auth/google?personal=true" className="btn btn-primary">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Connect My Gmail
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Compose Modal */}
      {showCompose && selectedInbox && currentUser && (
        <ComposeModal
          inbox={selectedInbox}
          currentUser={currentUser}
          onClose={() => setShowCompose(false)}
          onSent={() => setShowCompose(false)}
        />
      )}
    </div>
  );
}

function EmptyPane({ icon, label }: { icon: 'email' | 'chat'; label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-analog-surface">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-analog-surface-alt flex items-center justify-center border-2 border-analog-border">
          {icon === 'email' ? (
            <svg className="w-10 h-10 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-10 h-10 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          )}
        </div>
        <p className="text-analog-text-muted font-medium">{label}</p>
      </div>
    </div>
  );
}
