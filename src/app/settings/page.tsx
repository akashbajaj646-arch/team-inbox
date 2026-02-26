'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { User, Inbox } from '@/types';
import InboxSettings from '@/components/InboxSettings';
import TemplatesManager from '@/components/TemplatesManager';
import TeamMembers from '@/components/TeamMembers';
import FilteredInboxManager from '@/components/FilteredInboxManager';
import TwilioSettings from '@/components/TwilioSettings';
import ContactsManager from '@/components/ContactsManager';

export const dynamic = 'force-dynamic';

function SettingsContent() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRoles, setUserRoles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'inboxes' | 'team' | 'sms' | 'contacts'>('inboxes');
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'sms') {
      setActiveTab('sms');
    } else if (tab === 'contacts') {
      setActiveTab('contacts');
    }
    loadData();
  }, []);

  async function loadData() {
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
      router.push('/login');
      return;
    }

    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    setCurrentUser(profile);

    const { data: memberships } = await supabase
      .from('inbox_members')
      .select('inbox_id, role')
      .eq('user_id', authUser.id);

    if (memberships?.length) {
      const roles: Record<string, string> = {};
      memberships.forEach(m => {
        roles[m.inbox_id] = m.role;
      });
      setUserRoles(roles);

      const inboxIds = memberships.map((m) => m.inbox_id);
      const { data: inboxData } = await supabase
        .from('inboxes')
        .select('*')
        .in('id', inboxIds)
        .order('name');

      setInboxes(inboxData || []);

      if (inboxData?.length) {
        setSelectedInboxId(inboxData[0].id);
      }
    }

    setLoading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-texture">
        <div className="text-analog-text-muted font-medium">Loading...</div>
      </div>
    );
  }

  if (!currentUser) return null;

  const selectedInbox = inboxes.find(i => i.id === selectedInboxId);
  const isAdmin = selectedInboxId ? userRoles[selectedInboxId] === 'admin' : false;
  const isAnyAdmin = Object.values(userRoles).includes('admin');

  return (
    <div className="min-h-screen bg-texture">
      {/* Header */}
      <div className="bg-analog-surface border-b-2 border-analog-border-strong">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center gap-4">
          <button
            onClick={() => router.push('/')}
            className="p-2 text-analog-text-muted hover:text-analog-text hover:bg-analog-hover rounded-lg transition-all duration-150"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="font-display text-xl font-medium text-analog-text">Settings</h1>
        </div>

        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex gap-8">
            <button
              onClick={() => setActiveTab('inboxes')}
              className={`py-4 border-b-2 font-medium transition-all duration-150 ${
                activeTab === 'inboxes'
                  ? 'border-analog-accent text-analog-accent'
                  : 'border-transparent text-analog-text-muted hover:text-analog-text'
              }`}
            >
              Inboxes
            </button>
            <button
              onClick={() => setActiveTab('contacts')}
              className={`py-4 border-b-2 font-medium transition-all duration-150 ${
                activeTab === 'contacts'
                  ? 'border-analog-accent text-analog-accent'
                  : 'border-transparent text-analog-text-muted hover:text-analog-text'
              }`}
            >
              Contacts
            </button>
            <button
              onClick={() => setActiveTab('sms')}
              className={`py-4 border-b-2 font-medium transition-all duration-150 ${
                activeTab === 'sms'
                  ? 'border-analog-accent text-analog-accent'
                  : 'border-transparent text-analog-text-muted hover:text-analog-text'
              }`}
            >
              Twilio SMS
            </button>
            {isAnyAdmin && (
              <button
                onClick={() => setActiveTab('team')}
                className={`py-4 border-b-2 font-medium transition-all duration-150 ${
                  activeTab === 'team'
                    ? 'border-analog-accent text-analog-accent'
                    : 'border-transparent text-analog-text-muted hover:text-analog-text'
                }`}
              >
                Team Members
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {activeTab === 'contacts' ? (
          <ContactsManager currentUser={currentUser} />
        ) : activeTab === 'sms' ? (
          <div className="max-w-xl">
            <TwilioSettings
              currentUser={currentUser}
              onInboxCreated={loadData}
            />
          </div>
        ) : activeTab === 'inboxes' ? (
          <div className="flex gap-8">
            <div className="w-64 flex-shrink-0">
              <div className="text-[11px] uppercase tracking-wider text-analog-text-faint font-semibold mb-3">
                Inboxes
              </div>
              <div className="space-y-1">
                {inboxes.map((inbox) => (
                  <button
                    key={inbox.id}
                    onClick={() => setSelectedInboxId(inbox.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-150 text-left border ${
                      selectedInboxId === inbox.id
                        ? 'bg-analog-accent/10 text-analog-accent border-analog-accent/30'
                        : 'text-analog-text-muted border-transparent hover:bg-analog-surface hover:border-analog-border'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold ${
                        selectedInboxId === inbox.id
                          ? 'bg-analog-accent/20 text-analog-accent'
                          : 'bg-analog-surface border border-analog-border text-analog-text-muted'
                      }`}
                    >
                      {inbox.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{inbox.name}</p>
                      <p className="text-xs text-analog-text-faint truncate">
                        {userRoles[inbox.id] === 'admin' ? 'Admin' : 'Member'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 space-y-8">
              {selectedInbox ? (
                <>
                  <InboxSettings
                    inbox={selectedInbox}
                    currentUser={currentUser}
                    isAdmin={isAdmin}
                    onUpdate={loadData}
                  />
                  <FilteredInboxManager
                    inbox={selectedInbox}
                    isAdmin={isAdmin}
                    onUpdate={loadData}
                  />
                  <TemplatesManager
                    inbox={selectedInbox}
                    currentUser={currentUser}
                    isAdmin={isAdmin}
                  />
                </>
              ) : (
                <div className="text-center text-analog-text-muted py-12">
                  Select an inbox to manage settings
                </div>
              )}
            </div>
          </div>
        ) : (
          <TeamMembers currentUser={currentUser} isAdmin={isAnyAdmin} />
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-texture">
        <div className="text-analog-text-muted font-medium">Loading...</div>
      </div>
    }>
      <SettingsContent />
    </Suspense>
  );
}
