'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import type { Inbox, User, FilteredInbox } from '@/types';

interface InboxWithFilters extends Inbox {
  filteredInboxes?: FilteredInbox[];
}

interface SidebarProps {
  currentUser: User;
  selectedInboxId: string | null;
  selectedFilteredInboxId: string | null;
  onSelectInbox: (inboxId: string, filteredInboxId?: string | null) => void;
  onSignOut: () => void;
}

export default function Sidebar({
  currentUser,
  selectedInboxId,
  selectedFilteredInboxId,
  onSelectInbox,
  onSignOut,
}: SidebarProps) {
  const [inboxes, setInboxes] = useState<InboxWithFilters[]>([]);
  const [expandedInboxes, setExpandedInboxes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    loadInboxes();
  }, []);

  // Auto-expand inbox when it has a selected filtered inbox
  useEffect(() => {
    if (selectedInboxId && selectedFilteredInboxId) {
      setExpandedInboxes(prev => new Set([...prev, selectedInboxId]));
    }
  }, [selectedInboxId, selectedFilteredInboxId]);

  async function loadInboxes() {
    setLoading(true);
    
    const { data: memberships } = await supabase
      .from('inbox_members')
      .select('inbox_id')
      .eq('user_id', currentUser.id);

    if (memberships?.length) {
      const inboxIds = memberships.map((m) => m.inbox_id);
      const { data } = await supabase
        .from('inboxes')
        .select('*')
        .in('id', inboxIds)
        .order('name');

      if (data) {
        // Load filtered inboxes for each inbox
        const inboxesWithFilters: InboxWithFilters[] = await Promise.all(
          data.map(async (inbox) => {
            const { data: filteredInboxes } = await supabase
              .from('filtered_inboxes')
              .select('*')
              .eq('inbox_id', inbox.id)
              .order('name');
            return { ...inbox, filteredInboxes: filteredInboxes || [] };
          })
        );
        setInboxes(inboxesWithFilters);
        
        if (!selectedInboxId && inboxesWithFilters.length) {
          onSelectInbox(inboxesWithFilters[0].id, null);
        }
      }
    }
    
    setLoading(false);
  }

  function toggleExpand(inboxId: string) {
    setExpandedInboxes(prev => {
      const next = new Set(prev);
      if (next.has(inboxId)) {
        next.delete(inboxId);
      } else {
        next.add(inboxId);
      }
      return next;
    });
  }

  return (
    <div className="w-64 bg-analog-surface border-r-2 border-analog-border-strong flex flex-col h-screen">
      {/* Logo */}
      <div className="p-6 border-b-2 border-analog-border-strong">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-analog-accent to-analog-accent-light flex items-center justify-center shadow-analog-accent">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-display text-xl font-medium text-analog-text">Team Inbox</span>
        </div>
      </div>

      {/* Inboxes Section */}
      <div className="p-4 border-b border-analog-border flex-1 overflow-y-auto">
        <div className="text-[11px] uppercase tracking-wider text-analog-text-faint font-semibold mb-3 px-2">
          Inboxes
        </div>

        {loading ? (
          <div className="px-2 py-4 text-center text-analog-text-muted text-sm">
            Loading...
          </div>
        ) : inboxes.length === 0 ? (
          <div className="px-2 py-4 text-center text-analog-text-muted text-sm">
            No inboxes connected
          </div>
        ) : (
          <div className="space-y-1">
            {inboxes.map((inbox) => (
              <div key={inbox.id}>
                {/* Main Inbox */}
                <div className="flex items-center gap-1">
                  {inbox.filteredInboxes && inbox.filteredInboxes.length > 0 && (
                    <button
                      onClick={() => toggleExpand(inbox.id)}
                      className="p-1 text-analog-text-faint hover:text-analog-text transition-colors"
                    >
                      <svg 
                        className={`w-3 h-3 transition-transform ${expandedInboxes.has(inbox.id) ? 'rotate-90' : ''}`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor" 
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => onSelectInbox(inbox.id, null)}
                    className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-left border ${
                      selectedInboxId === inbox.id && !selectedFilteredInboxId
                        ? 'bg-gradient-to-br from-analog-accent to-analog-accent-light text-white border-analog-accent-hover shadow-analog-accent'
                        : 'text-analog-text-muted border-transparent hover:bg-analog-surface-alt hover:border-analog-border'
                    }`}
                  >
                    {inbox.inbox_type === 'sms' ? (
                      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    ) : (
                      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    )}
                    <span className="flex-1 font-medium truncate">{inbox.name}</span>
                  </button>
                </div>

                {/* Filtered Inboxes */}
                {expandedInboxes.has(inbox.id) && inbox.filteredInboxes && inbox.filteredInboxes.length > 0 && (
                  <div className="ml-6 mt-1 space-y-1">
                    {inbox.filteredInboxes.map((fi) => (
                      <button
                        key={fi.id}
                        onClick={() => onSelectInbox(inbox.id, fi.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-150 text-left border text-sm ${
                          selectedFilteredInboxId === fi.id
                            ? 'bg-analog-secondary/20 text-analog-secondary border-analog-secondary/30'
                            : 'text-analog-text-muted border-transparent hover:bg-analog-surface-alt hover:border-analog-border'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                        <span className="flex-1 truncate">{fi.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Connect New Inbox */}
        <div className="mt-3 space-y-1">
          <a
            href="/api/auth/google"
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-analog-text-muted border border-transparent hover:bg-analog-surface-alt hover:border-analog-border transition-all duration-150"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">Connect Gmail</span>
          </a>
          <Link
            href="/settings?tab=sms"
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-analog-text-muted border border-transparent hover:bg-analog-surface-alt hover:border-analog-border transition-all duration-150"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">Connect Twilio SMS</span>
          </Link>
        </div>
      </div>

      {/* Settings Section */}
      <div className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-analog-text-faint font-semibold mb-3 px-2">
          Settings
        </div>
        <div className="space-y-1">
          <Link
            href="/settings"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-analog-text-muted border border-transparent hover:bg-analog-surface-alt hover:border-analog-border transition-all duration-150"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span className="text-sm font-medium">Team Members</span>
          </Link>
          <Link
            href="/settings"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-analog-text-muted border border-transparent hover:bg-analog-surface-alt hover:border-analog-border transition-all duration-150"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="text-sm font-medium">Templates</span>
          </Link>
        </div>
      </div>

      {/* User Section */}
      <div className="p-4 border-t-2 border-analog-border-strong">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-analog-secondary to-analog-secondary-light flex items-center justify-center text-white font-semibold text-sm border-2 border-analog-border">
            {currentUser.name?.charAt(0) || currentUser.email.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-analog-text truncate">
              {currentUser.name || currentUser.email.split('@')[0]}
            </p>
            <p className="text-xs text-analog-text-faint truncate">
              {currentUser.email}
            </p>
          </div>
          <button
            onClick={onSignOut}
            className="p-2 text-analog-text-muted hover:text-analog-accent hover:bg-analog-surface-alt rounded-lg transition-all duration-150"
            title="Sign out"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
