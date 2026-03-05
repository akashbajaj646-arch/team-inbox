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
  showAllInboxes?: boolean;
  onSelectInbox: (inboxId: string, filteredInboxId?: string | null) => void;
  onSelectAllInboxes?: () => void;
  onSelectThread?: (threadId: string, inboxId: string) => void;
  onSignOut: () => void;
  onCompose: () => void;
}

export default function Sidebar({
  currentUser,
  selectedInboxId,
  selectedFilteredInboxId,
  showAllInboxes = false,
  onSelectInbox,
  onSelectAllInboxes,
  onSelectThread,
  onSignOut,
  onCompose,
}: SidebarProps) {
  const [inboxes, setInboxes] = useState<InboxWithFilters[]>([]);
  const [expandedInboxes, setExpandedInboxes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [mentions, setMentions] = useState<any[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    loadInboxes();
    loadMentions();

    const interval = setInterval(loadMentions, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedInboxId && selectedFilteredInboxId) {
      setExpandedInboxes(prev => new Set(Array.from(prev).concat(selectedInboxId)));
    }
  }, [selectedInboxId, selectedFilteredInboxId]);

  async function loadMentions() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('thread_comments')
      .select(`
        id,
        content,
        created_at,
        thread_id,
        sms_thread_id,
        mention_read_by,
        user:inbox_users(name, email),
        email_thread:email_threads(subject, inbox_id),
        sms_thread:sms_threads(contact_phone, inbox_id)
      `)
      .contains('mentioned_user_ids', [currentUser.id])
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(50);

    setMentions(data || []);
  }

  async function markMentionRead(commentId: string) {
    await supabase.rpc('append_mention_read', {
      comment_id: commentId,
      user_id: currentUser.id,
    });
    await loadMentions();
  }

  async function markAllMentionsRead() {
    const unread = mentions.filter(m => !((m.mention_read_by || []).includes(currentUser.id)));
    for (const mention of unread) {
      await supabase.rpc('append_mention_read', {
        comment_id: mention.id,
        user_id: currentUser.id,
      });
    }
    await loadMentions();
    setShowMentions(false);
  }

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

  // Split inboxes into personal and shared
  const personalInboxes = inboxes.filter(
    (i) => i.is_personal && i.owner_user_id === currentUser.id
  );
  const sharedInboxes = inboxes.filter(
    (i) => !i.is_personal || i.owner_user_id !== currentUser.id
  );

  function InboxIcon({ inbox }: { inbox: Inbox }) {
    if (inbox.inbox_type === 'whatsapp') {
      return (
        <svg className="w-[18px] h-[18px] flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      );
    }
    if (inbox.inbox_type === 'sms') {
      return (
        <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      );
    }
    return (
      <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    );
  }

  function InboxItem({ inbox }: { inbox: InboxWithFilters }) {
    return (
      <div key={inbox.id}>
        <div className="flex items-center gap-1">
          {inbox.filteredInboxes && inbox.filteredInboxes.length > 0 && (
            <button
              onClick={() => toggleExpand(inbox.id)}
              className="p-1 text-analog-text-faint hover:text-analog-text transition-colors flex-shrink-0"
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
            <InboxIcon inbox={inbox} />
            <span className="flex-1 font-medium truncate">{inbox.name}</span>
          </button>
        </div>

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
    );
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

      {/* Compose Button */}
      <div className="px-4 pt-4 pb-2">
        <button
          onClick={onCompose}
          disabled={!selectedInboxId}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-analog-accent to-analog-accent-light shadow-analog-accent hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Compose
        </button>

        {/* Mentions Badge */}
        <div className="relative mt-2">
          <button
            onClick={() => setShowMentions(!showMentions)}
            className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
              showMentions
                ? 'bg-analog-accent/10 text-analog-accent border border-analog-accent/20'
                : 'text-analog-text-muted hover:bg-analog-hover hover:text-analog-text border border-transparent'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
            </svg>
            <span className="flex-1 text-left">Mentions</span>
            {(() => { const unreadCount = mentions.filter(m => !((m.mention_read_by || []).includes(currentUser.id))).length; return unreadCount > 0 ? (
              <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null; })()}
          </button>

          {/* Mentions Dropdown */}
          {showMentions && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-analog-border rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-analog-border">
                <span className="text-xs font-semibold text-analog-text-muted uppercase tracking-wider">
                  {mentions.filter(m => !((m.mention_read_by || []).includes(currentUser.id))).length} unread mention{mentions.filter(m => !((m.mention_read_by || []).includes(currentUser.id))).length !== 1 ? 's' : ''}
                </span>
                {mentions.length > 0 && (
                  <button
                    onClick={markAllMentionsRead}
                    className="text-xs text-analog-accent hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {mentions.length === 0 ? (
                <div className="px-3 py-4 text-sm text-analog-text-muted text-center">
                  No mentions in the last 7 days
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {(() => {
                    const unread = mentions.filter(m => !((m.mention_read_by || []).includes(currentUser.id)));
                    const read = mentions.filter(m => (m.mention_read_by || []).includes(currentUser.id));
                    const renderMention = (mention: any, isRead: boolean) => {
                      const subject = mention.email_thread?.subject || mention.sms_thread?.contact_phone || 'Unknown thread';
                      const author = mention.user?.name || mention.user?.email?.split('@')[0] || 'Someone';
                      const threadId = mention.thread_id || mention.sms_thread_id;
                      const inboxId = mention.email_thread?.inbox_id || mention.sms_thread?.inbox_id;
                      return (
                        <div
                          key={mention.id}
                          className={`px-3 py-3 border-b border-analog-border-light last:border-b-0 hover:bg-analog-hover cursor-pointer ${isRead ? 'opacity-60' : ''}`}
                          onClick={() => {
                            if (!isRead) markMentionRead(mention.id);
                            if (inboxId) onSelectInbox(inboxId, null);
                            if (threadId && onSelectThread && inboxId) onSelectThread(threadId, inboxId);
                            setShowMentions(false);
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-analog-text truncate">{subject}</p>
                              <p className="text-xs text-analog-text-muted mt-0.5">
                                <span className="font-medium text-analog-accent">{author}</span> mentioned you
                              </p>
                              <p className="text-xs text-analog-text-faint mt-0.5 line-clamp-1">{mention.content}</p>
                            </div>
                            {!isRead && (
                              <button
                                onClick={(e) => { e.stopPropagation(); markMentionRead(mention.id); }}
                                className="text-analog-text-faint hover:text-analog-text flex-shrink-0 mt-0.5"
                                title="Mark as read"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    };
                    return (
                      <>
                        {unread.length > 0 && unread.map(m => renderMention(m, false))}
                        {read.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 bg-analog-surface-alt border-y border-analog-border">
                              <span className="text-[10px] uppercase tracking-wider text-analog-text-faint font-semibold">Already read</span>
                            </div>
                            {read.map(m => renderMention(m, true))}
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* All Inboxes Search */}
        <button
          onClick={onSelectAllInboxes}
          className={`mt-2 w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
            showAllInboxes
              ? 'bg-analog-accent/10 text-analog-accent border border-analog-accent/20'
              : 'text-analog-text-muted hover:bg-analog-hover hover:text-analog-text border border-transparent'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Search All Inboxes
        </button>
      </div>

      {/* Inboxes */}
      <div className="p-4 border-b border-analog-border flex-1 overflow-y-auto space-y-4">
        {loading ? (
          <div className="px-2 py-4 text-center text-analog-text-muted text-sm">Loading...</div>
        ) : (
          <>
            {/* My Inboxes (Personal) */}
            {personalInboxes.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-analog-text-faint font-semibold mb-2 px-2">
                  My Inbox
                </div>
                <div className="space-y-1">
                  {personalInboxes.map((inbox) => (
                    <InboxItem key={inbox.id} inbox={inbox} />
                  ))}
                </div>
              </div>
            )}

            {/* Shared Inboxes */}
            {sharedInboxes.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-analog-text-faint font-semibold mb-2 px-2">
                  {personalInboxes.length > 0 ? 'Shared Inboxes' : 'Inboxes'}
                </div>
                <div className="space-y-1">
                  {sharedInboxes.map((inbox) => (
                    <InboxItem key={inbox.id} inbox={inbox} />
                  ))}
                </div>
              </div>
            )}

            {inboxes.length === 0 && (
              <div className="px-2 py-4 text-center text-analog-text-muted text-sm">
                No inboxes connected
              </div>
            )}
          </>
        )}

        {/* Connect New */}
        <div className="space-y-1 pt-2">
          <div className="text-[11px] uppercase tracking-wider text-analog-text-faint font-semibold mb-2 px-2">
            Connect
          </div>
          <a
            href="/api/auth/google?personal=true"
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-analog-text-muted border border-transparent hover:bg-analog-surface-alt hover:border-analog-border transition-all duration-150"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">My Gmail (Personal)</span>
          </a>
          <a
            href="/api/auth/google"
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-analog-text-muted border border-transparent hover:bg-analog-surface-alt hover:border-analog-border transition-all duration-150"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">Shared Gmail</span>
          </a>
          <Link
            href="/settings?tab=sms"
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-analog-text-muted border border-transparent hover:bg-analog-surface-alt hover:border-analog-border transition-all duration-150"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">Twilio SMS / WhatsApp</span>
          </Link>
        </div>
      </div>

      {/* Settings */}
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

      {/* User */}
      <div className="p-4 border-t-2 border-analog-border-strong">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-analog-secondary to-analog-secondary-light flex items-center justify-center text-white font-semibold text-sm border-2 border-analog-border">
            {currentUser.name?.charAt(0) || currentUser.email.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-analog-text truncate">
              {currentUser.name || currentUser.email.split('@')[0]}
            </p>
            <p className="text-xs text-analog-text-faint truncate">{currentUser.email}</p>
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
