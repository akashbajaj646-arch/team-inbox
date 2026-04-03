'use client';

import { useState, useEffect } from 'react';
import { useResizable } from '@/hooks/useResizable';
import { createClient } from '@/lib/supabase/client';
import AdvancedSearchPanel, { defaultConfig, hasActiveSearch, type SearchConfig, type SearchFilter, type FilterLogic } from './AdvancedSearchPanel';
import type { EmailThread, Inbox, FilteredInbox, FilterRule, Contact } from '@/types';

type EmailView = 'all' | 'unread' | 'starred' | 'sent' | 'trash';
type SearchField = 'all' | 'from' | 'subject' | 'body';
type SearchMatch = 'contains' | 'exact';

interface ThreadListProps {
  inbox: Inbox;
  filteredInbox?: FilteredInbox | null;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onThreadRead?: (threadId: string) => void;
}

export default function ThreadList({
  inbox,
  filteredInbox,
  selectedThreadId,
  onSelectThread,
  onThreadRead,
}: ThreadListProps) {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [displayedThreads, setDisplayedThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeView, setActiveView] = useState<EmailView>('all');
  const [contactNames, setContactNames] = useState<Map<string, string>>(new Map());
  const [threadsWithAttachments, setThreadsWithAttachments] = useState<Set<string>>(new Set());

  const [showSearch, setShowSearch] = useState(false);
  const [searchConfig, setSearchConfig] = useState<SearchConfig>(defaultConfig());
  const [searching, setSearching] = useState(false);

  const supabase = createClient();
  const { elementRef: listRef, startResize: startListResize } = useResizable(360, 240, 560, 'threadlist-width');

  useEffect(() => {
    loadThreads();

    const channel = supabase
      .channel(`threads:${inbox.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_threads', filter: `inbox_id=eq.${inbox.id}` }, () => {
        loadThreads();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [inbox.id, filteredInbox?.id, activeView]);

  useEffect(() => {
    if (hasActiveSearch(searchConfig)) {
      performSearch();
    } else {
      setDisplayedThreads(threads);
    }
  }, [searchConfig, threads]);

  async function loadThreadAttachments(threadsList: EmailThread[]) {
    if (threadsList.length === 0) return;
    const threadIds = threadsList.map(t => t.id);
    const { data } = await supabase
      .from('email_attachments')
      .select('thread_id')
      .in('thread_id', threadIds)
      .eq('is_inline', false)
      .limit(500);
    if (data) {
      const set = new Set(data.map((a: any) => a.thread_id as string));
      setThreadsWithAttachments(set);
    }
  }

  function clearSearch() {
    setSearchConfig(defaultConfig());
    setDisplayedThreads(threads);
  }

  async function performSearch() {
    if (!hasActiveSearch(searchConfig)) { setDisplayedThreads(threads); return; }
    setSearching(true);

    const threadIds = threads.map(t => t.id);
    if (threadIds.length === 0) { setDisplayedThreads([]); setSearching(false); return; }

    const { data: messages } = await supabase
      .from('email_messages')
      .select('thread_id, from_address, from_name, to_addresses, body_text, body_html')
      .in('thread_id', threadIds);

    const messagesByThread: Record<string, any[]> = {};
    (messages || []).forEach(m => {
      if (!messagesByThread[m.thread_id]) messagesByThread[m.thread_id] = [];
      messagesByThread[m.thread_id].push(m);
    });

    function testFilter(thread: any, msgs: any[], filter: any): boolean {
      const q = filter.query.toLowerCase().trim();
      if (!q) return true;
      const test = (str: string) => searchConfig.match === 'exact' ? str.toLowerCase() === q : str.toLowerCase().includes(q);
      switch (filter.field) {
        case 'from': return msgs.some(m => test(m.from_address || '') || test(m.from_name || ''));
        case 'to': return msgs.some(m => (m.to_addresses || []).some((a: string) => test(a)));
        case 'subject': return test(thread.subject || '');
        case 'body': return msgs.some(m => test(m.body_text || '') || test(m.body_html || ''));
        default: return test(thread.subject || '') ||
          msgs.some(m => test(m.from_address || '') || test(m.from_name || '') || test(m.body_text || ''));
      }
    }

    const activeFilters = searchConfig.filters.filter(f => f.query.trim());
    const matchingThreads = threads.filter(thread => {
      const msgs = messagesByThread[thread.id] || [];
      if (searchConfig.logic === 'and') return activeFilters.every(f => testFilter(thread, msgs, f));
      return activeFilters.some(f => testFilter(thread, msgs, f));
    });

    setDisplayedThreads(matchingThreads);
    loadContactNames(matchingThreads);
    setSearching(false);
  }

  
  function matchesFilter(thread: any, messages: any[], filter: any): boolean {
    const value = (filter.value || '').toLowerCase();
    switch (filter.field) {
      case 'from':
        return messages.some(m => {
          const from = (m.from_address || '').toLowerCase();
          const fromName = (m.from_name || '').toLowerCase();
          switch (filter.operator) {
            case 'contains': return from.includes(value) || fromName.includes(value);
            case 'equals': return from === value || fromName === value;
            case 'starts_with': return from.startsWith(value) || fromName.startsWith(value);
            case 'ends_with': return from.endsWith(value) || fromName.endsWith(value);
            default: return false;
          }
        });
      case 'subject': {
        const subject = (thread.subject || '').toLowerCase();
        switch (filter.operator) {
          case 'contains': return subject.includes(value);
          case 'equals': return subject === value;
          case 'starts_with': return subject.startsWith(value);
          case 'ends_with': return subject.endsWith(value);
          default: return false;
        }
      }
      case 'body':
        return messages.some(m => {
          const body = ((m.body_text || '') + ' ' + (m.body_html || '')).toLowerCase();
          switch (filter.operator) {
            case 'contains': return body.includes(value);
            case 'equals': return body === value;
            case 'starts_with': return body.startsWith(value);
            case 'ends_with': return body.endsWith(value);
            default: return false;
          }
        });
      default: return false;
    }
  }

  async function loadThreads() {
    setLoading(true);

    let query = supabase
      .from('email_threads')
      .select('*')
      .eq('inbox_id', inbox.id)
      .order('last_message_at', { ascending: false });

    if (!filteredInbox) {
      query = query.is('filtered_inbox_id', null);
    } else {
      query = query.eq('filtered_inbox_id', filteredInbox.id);
    }

    switch (activeView) {
      case 'all': query = query.is('deleted_at', null); break;
      case 'unread': query = query.eq('is_read', false).is('deleted_at', null); break;
      case 'starred': query = query.eq('is_starred', true).is('deleted_at', null); break;
      case 'sent': query = query.is('deleted_at', null); break;
      case 'trash': query = query.not('deleted_at', 'is', null); break;
    }

    const { data } = await query;

    if (activeView === 'sent' && data) {
      const threadIds = data.map(t => t.id);
      const { data: sentMessages } = await supabase.from('email_messages').select('thread_id').in('thread_id', threadIds).eq('is_outbound', true);
      const sentThreadIds = new Set(sentMessages?.map(m => m.thread_id) || []);
      const filteredData = data.filter(t => sentThreadIds.has(t.id));
      if (filteredInbox && filteredInbox.filters.length > 0) {
        await applyFilteredInboxFilters(filteredData);
      } else {
        setThreads(filteredData);
        setDisplayedThreads(filteredData);
        loadContactNames(filteredData);
      }
    } else if (filteredInbox && filteredInbox.filters.length > 0 && data) {
      await applyFilteredInboxFilters(data);
    } else {
      setThreads(data || []);
      setDisplayedThreads(data || []);
      loadContactNames(data || []);
    }

    setLoading(false);
  }

  async function applyFilteredInboxFilters(threadsToFilter: EmailThread[]) {
    if (!filteredInbox || threadsToFilter.length === 0) {
      setThreads(threadsToFilter);
      setDisplayedThreads(threadsToFilter);
      loadContactNames(threadsToFilter);
      return;
    }

    const threadIds = threadsToFilter.map(t => t.id);
    const { data: messages } = await supabase.from('email_messages').select('thread_id, from_address, from_name, body_text, body_html').in('thread_id', threadIds);
    const messagesByThread: Record<string, any[]> = {};
    (messages || []).forEach(m => {
      if (!messagesByThread[m.thread_id]) messagesByThread[m.thread_id] = [];
      messagesByThread[m.thread_id].push(m);
    });

    const matchingThreads = threadsToFilter.filter(thread => {
      const threadMessages = messagesByThread[thread.id] || [];
      if (filteredInbox.filter_logic === 'all') {
        return filteredInbox.filters.every(filter => matchesFilter(thread, threadMessages, filter));
      } else {
        return filteredInbox.filters.some(filter => matchesFilter(thread, threadMessages, filter));
      }
    });

    setThreads(matchingThreads);
    setDisplayedThreads(matchingThreads);
    loadContactNames(matchingThreads);
    loadThreadAttachments(matchingThreads);
  }

  async function loadContactNames(threadsList: EmailThread[]) {
    if (threadsList.length === 0) return;

    const threadIds = threadsList.map(t => t.id);

    // Bulk fetch first message per thread to get sender emails
    let messages: any[] = [];
    const batchSize = 50;
    for (let i = 0; i < threadIds.length; i += batchSize) {
      const batch = threadIds.slice(i, i + batchSize);
      const { data: batchData } = await supabase
        .from('email_messages')
        .select('thread_id, from_address, from_name')
        .in('thread_id', batch)
        .order('sent_at', { ascending: true });
      if (batchData) messages = [...messages, ...batchData];
    }

    if (!messages.length) return;

    const senderByThread: Record<string, { email: string; name: string }> = {};
    messages.forEach(m => {
      if (!senderByThread[m.thread_id]) {
        senderByThread[m.thread_id] = { email: m.from_address || '', name: m.from_name || '' };
      }
    });

    const uniqueEmails = [...new Set(
      Object.values(senderByThread).map(s => s.email.toLowerCase()).filter(Boolean)
    )];

    if (uniqueEmails.length === 0) return;

    // Single bulk query for all customer links
    const customerNameByEmail = new Map<string, string>();
    const { data: links } = await supabase
      .from('thread_customer_links')
      .select('email, customer:customers(customer_name)')
      .not('email', 'is', null);

    if (links) {
      for (const link of links) {
        const linkEmail = ((link as any).email || '').toLowerCase();
        if (linkEmail) {
          const customer = Array.isArray(link.customer) ? link.customer[0] : link.customer;
          if (customer?.customer_name) {
            customerNameByEmail.set(linkEmail, customer.customer_name);
          }
        }
      }
    }

    // Single bulk query for all inbox contacts by email
    const contactNameByEmail = new Map<string, string>();
    const { data: contacts } = await supabase
      .from('inbox_contacts')
      .select('email, first_name, last_name, company_name')
      .not('email', 'is', null);

    if (contacts) {
      for (const contact of contacts) {
        const contactEmail = (contact.email || '').toLowerCase();
        if (contactEmail && uniqueEmails.includes(contactEmail)) {
          const parts = [];
          if (contact.first_name) parts.push(contact.first_name);
          if (contact.last_name) parts.push(contact.last_name);
          const name = parts.join(' ');
          const displayName = name && contact.company_name
            ? `${name} (${contact.company_name})`
            : name || contact.company_name || '';
          if (displayName) contactNameByEmail.set(contactEmail, displayName);
        }
      }
    }

    const newContactNames = new Map<string, string>();
    for (const [threadId, sender] of Object.entries(senderByThread)) {
      const emailLower = sender.email.toLowerCase();

      if (customerNameByEmail.has(emailLower)) {
        newContactNames.set(threadId, customerNameByEmail.get(emailLower)!);
      } else if (contactNameByEmail.has(emailLower)) {
        newContactNames.set(threadId, contactNameByEmail.get(emailLower)!);
      } else {
        newContactNames.set(threadId, sender.name || sender.email);
      }
    }

    setContactNames(newContactNames);
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const response = await fetch('/api/emails/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inboxId: inbox.id }) });
      if (response.ok) await loadThreads();
    } catch (err) { console.error('Sync error:', err); }
    setSyncing(false);
  }

  async function handleStar(e: React.MouseEvent, threadId: string, currentStarred: boolean) {
    e.stopPropagation();
    await supabase.from('email_threads').update({ is_starred: !currentStarred }).eq('id', threadId);
    loadThreads();
  }

  async function handleDelete(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    await supabase.from('email_threads').update({ deleted_at: new Date().toISOString() }).eq('id', threadId);
    loadThreads();
  }

  async function handleRestore(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    await supabase.from('email_threads').update({ deleted_at: null }).eq('id', threadId);
    loadThreads();
  }

  async function handlePermanentDelete(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    if (!confirm('Permanently delete this email? This cannot be undone.')) return;
    await supabase.from('email_messages').delete().eq('thread_id', threadId);
    await supabase.from('thread_comments').delete().eq('thread_id', threadId);
    await supabase.from('thread_presence').delete().eq('thread_id', threadId);
    await supabase.from('email_threads').delete().eq('id', threadId);
    loadThreads();
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  const views: { key: EmailView; label: string; icon: JSX.Element }[] = [
    { key: 'all', label: 'All', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg> },
    { key: 'unread', label: 'Unread', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /><circle cx="18" cy="6" r="3" fill="currentColor" /></svg> },
    { key: 'starred', label: 'Starred', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg> },
    { key: 'sent', label: 'Sent', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg> },
    { key: 'trash', label: 'Trash', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> },
  ];

  return (
    <div ref={listRef} className="border-r border-analog-border-light flex flex-col h-screen bg-analog-surface-alt flex-shrink-0 relative" style={{width: 360}}>
      <div onMouseDown={startListResize} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-analog-accent/30 transition-colors z-10" />

      <div className="px-6 py-5 border-b border-analog-border-light bg-analog-surface flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-medium text-analog-text">{filteredInbox ? filteredInbox.name : 'Emails'}</h2>
          {filteredInbox && (
            <p className="text-xs text-analog-text-faint mt-0.5 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
              {filteredInbox.filters.length} filter{filteredInbox.filters.length !== 1 ? 's' : ''} • {filteredInbox.filter_logic === 'any' ? 'Match any' : 'Match all'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSearch(!showSearch)} className={`p-2 rounded-lg transition-all duration-150 ${showSearch || hasActiveSearch(searchConfig) ? 'bg-analog-accent text-white' : 'text-analog-text-muted hover:bg-analog-hover hover:text-analog-text'}`} title="Search emails">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </button>
          <button onClick={handleSync} disabled={syncing || !inbox.google_refresh_token} className="px-4 py-2 text-sm font-medium text-analog-text-muted bg-analog-surface border border-analog-border-strong rounded-lg hover:border-analog-accent hover:text-analog-accent transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed">
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="px-4 py-3 border-b border-analog-border bg-analog-surface">
          <AdvancedSearchPanel
            config={searchConfig}
            onChange={setSearchConfig}
            resultCount={displayedThreads.length}
            searching={searching}
          />
        </div>
      )}
      {!showSearch && hasActiveSearch(searchConfig) && (
        <div className="px-4 py-2 border-b border-analog-border bg-analog-accent/10 flex items-center justify-between">
          <span className="text-sm text-analog-accent">{displayedThreads.length} result{displayedThreads.length !== 1 ? 's' : ''}</span>
          <button onClick={clearSearch} className="text-sm text-analog-accent hover:underline">Clear</button>
        </div>
      )}

      <div className="px-4 py-3 border-b border-analog-border bg-analog-surface flex gap-1 overflow-x-auto">
        {views.map((view) => (
          <button key={view.key} onClick={() => setActiveView(view.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 ${activeView === view.key ? 'bg-analog-accent text-white' : 'text-analog-text-muted hover:bg-analog-hover hover:text-analog-text'}`}>
            {view.icon}{view.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center text-analog-text-muted">Loading emails...</div>
        ) : displayedThreads.length === 0 ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-surface flex items-center justify-center">
              <svg className="w-8 h-8 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {<path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />}
              </svg>
            </div>
            <p className="text-analog-text-muted mb-2">
              {hasActiveSearch(searchConfig) ? 'No results found' : (<>{activeView === 'all' && 'No emails yet'}{activeView === 'unread' && 'No unread emails'}{activeView === 'starred' && 'No starred emails'}{activeView === 'sent' && 'No sent emails'}{activeView === 'trash' && 'Trash is empty'}</>)}
            </p>
            {hasActiveSearch(searchConfig) ? <button onClick={clearSearch} className="text-sm text-analog-accent hover:underline font-medium">Clear search</button>
              : activeView === 'all' && inbox.google_refresh_token ? <button onClick={handleSync} className="text-sm text-analog-accent hover:underline font-medium">Sync from Gmail</button>
              : activeView === 'all' && !inbox.google_refresh_token ? <a href="/api/auth/google" className="text-sm text-analog-accent hover:underline font-medium">Connect Gmail first</a>
              : null}
          </div>
        ) : (
          <div>
            {displayedThreads.map((thread) => (
              <div
                key={thread.id}
                onClick={() => { onSelectThread(thread.id); if (!thread.is_read && onThreadRead) onThreadRead(thread.id); }}
                className={`relative group cursor-pointer transition-all duration-150 ${selectedThreadId === thread.id ? 'bg-white shadow-[0_1px_4px_rgba(42,52,57,0.07)] border-l-4 border-l-analog-accent rounded-lg mx-2 mb-1' : 'bg-white rounded-lg mx-2 mb-1 hover:shadow-[0_1px_4px_rgba(42,52,57,0.07)] transition-shadow'}`}
              >
                <div className="px-6 py-5">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={(e) => handleStar(e, thread.id, thread.is_starred)}
                      className={`mt-0.5 flex-shrink-0 transition-all duration-150 ${thread.is_starred ? 'text-analog-warning' : 'text-analog-border-strong hover:text-analog-warning opacity-0 group-hover:opacity-100'}`}
                    >
                      <svg className="w-4 h-4" fill={thread.is_starred ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-analog-text-muted mb-1 truncate font-medium">
                        {contactNames.get(thread.id) || ''}
                      </div>
                      <div className="font-body text-[15px] font-medium text-analog-text mb-1.5 line-clamp-1">
                        {thread.subject || '(No subject)'}
                      </div>
                      <div className="text-[13px] text-analog-text-faint line-clamp-2 leading-relaxed">
                        {thread.snippet}
                      </div>
                      <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-analog-border-light">
                        {!thread.is_read && <span className="badge badge-primary">New</span>}
                        <span className="text-xs text-analog-text-placeholder">{formatDate(thread.last_message_at)}</span>
                        {threadsWithAttachments.has(thread.id) && (
                          <svg className="w-3.5 h-3.5 text-analog-text-faint flex-shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {activeView === 'trash' ? (
                        <>
                          <button onClick={(e) => handleRestore(e, thread.id)} className="p-1.5 text-analog-text-muted hover:text-analog-success hover:bg-analog-success/10 rounded transition-all duration-150" title="Restore">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                          </button>
                          <button onClick={(e) => handlePermanentDelete(e, thread.id)} className="p-1.5 text-analog-text-muted hover:text-analog-error hover:bg-analog-error/10 rounded transition-all duration-150" title="Delete permanently">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </>
                      ) : (
                        <button onClick={(e) => handleDelete(e, thread.id)} className="p-1.5 text-analog-text-muted hover:text-analog-error hover:bg-analog-error/10 rounded transition-all duration-150" title="Move to trash">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
