'use client';

import { useState, useEffect, useCallback } from 'react';
import { useResizable } from '@/hooks/useResizable';
import { createClient } from '@/lib/supabase/client';
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

// Contact cache
const contactCache: Map<string, Contact | null> = new Map();

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
  
  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('all');
  const [searchMatch, setSearchMatch] = useState<SearchMatch>('contains');
  const [searching, setSearching] = useState(false);
  
  const supabase = createClient();
  const { elementRef: listRef, startResize: startListResize } = useResizable(360, 240, 560, 'threadlist-width');

  useEffect(() => {
    loadThreads();

    const channel = supabase
      .channel(`threads:${inbox.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_threads',
          filter: `inbox_id=eq.${inbox.id}`,
        },
        () => {
          loadThreads();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [inbox.id, filteredInbox?.id, activeView]);

  // Apply search when query changes
  useEffect(() => {
    if (searchQuery.trim()) {
      performSearch();
    } else {
      setDisplayedThreads(threads);
    }
  }, [searchQuery, searchField, searchMatch, threads]);

  async function performSearch() {
    if (!searchQuery.trim()) {
      setDisplayedThreads(threads);
      return;
    }

    setSearching(true);
    const query = searchMatch === 'exact' 
      ? searchQuery.toLowerCase() 
      : searchQuery.toLowerCase();

    // Get thread IDs to search
    const threadIds = threads.map(t => t.id);
    
    if (threadIds.length === 0) {
      setDisplayedThreads([]);
      setSearching(false);
      return;
    }

    // Fetch messages for search
    const { data: messages } = await supabase
      .from('email_messages')
      .select('thread_id, from_address, from_name, body_text, body_html')
      .in('thread_id', threadIds);

    const messagesByThread: Record<string, any[]> = {};
    (messages || []).forEach(m => {
      if (!messagesByThread[m.thread_id]) {
        messagesByThread[m.thread_id] = [];
      }
      messagesByThread[m.thread_id].push(m);
    });

    const matchingThreads = threads.filter(thread => {
      const threadMessages = messagesByThread[thread.id] || [];
      
      // Check subject
      const subjectMatch = () => {
        const subject = (thread.subject || '').toLowerCase();
        return searchMatch === 'exact' 
          ? subject === query 
          : subject.includes(query);
      };

      // Check from
      const fromMatch = () => {
        return threadMessages.some(m => {
          const from = ((m.from_address || '') + ' ' + (m.from_name || '')).toLowerCase();
          return searchMatch === 'exact' 
            ? from === query || (m.from_address || '').toLowerCase() === query
            : from.includes(query);
        });
      };

      // Check body
      const bodyMatch = () => {
        return threadMessages.some(m => {
          const body = ((m.body_text || '') + ' ' + (m.body_html || '')).toLowerCase();
          return searchMatch === 'exact' 
            ? body === query 
            : body.includes(query);
        });
      };

      switch (searchField) {
        case 'from':
          return fromMatch();
        case 'subject':
          return subjectMatch();
        case 'body':
          return bodyMatch();
        case 'all':
        default:
          return subjectMatch() || fromMatch() || bodyMatch();
      }
    });

    setDisplayedThreads(matchingThreads);
    setSearching(false);
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchField('all');
    setSearchMatch('contains');
    setDisplayedThreads(threads);
  }

  // Apply filter rules to check if a thread matches
  function matchesFilter(thread: EmailThread, messages: any[], filter: FilterRule): boolean {
    const value = filter.value.toLowerCase();
    
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
      case 'subject':
        const subject = (thread.subject || '').toLowerCase();
        switch (filter.operator) {
          case 'contains': return subject.includes(value);
          case 'equals': return subject === value;
          case 'starts_with': return subject.startsWith(value);
          case 'ends_with': return subject.endsWith(value);
          default: return false;
        }
      case 'body':
        return messages.some(m => {
          const body = ((m.body_text || '') + (m.body_html || '')).toLowerCase();
          switch (filter.operator) {
            case 'contains': return body.includes(value);
            case 'equals': return body === value;
            case 'starts_with': return body.startsWith(value);
            case 'ends_with': return body.endsWith(value);
            default: return false;
          }
        });
      default:
        return false;
    }
  }

  async function loadThreads() {
    setLoading(true);

    let query = supabase
      .from('email_threads')
      .select('*')
      .eq('inbox_id', inbox.id)
      .order('last_message_at', { ascending: false });

    // Hide threads assigned to a filtered inbox when viewing parent
    if (!filteredInbox) {
      query = query.is('filtered_inbox_id', null);
    }

    // Apply filters based on view
    switch (activeView) {
      case 'all':
        query = query.is('deleted_at', null);
        break;
      case 'unread':
        query = query.eq('is_read', false).is('deleted_at', null);
        break;
      case 'starred':
        query = query.eq('is_starred', true).is('deleted_at', null);
        break;
      case 'sent':
        query = query.is('deleted_at', null);
        break;
      case 'trash':
        query = query.not('deleted_at', 'is', null);
        break;
    }

    const { data } = await query;
    
    // For 'sent' view, we need to filter threads that have outbound messages
    if (activeView === 'sent' && data) {
      const threadIds = data.map(t => t.id);
      const { data: sentMessages } = await supabase
        .from('email_messages')
        .select('thread_id')
        .in('thread_id', threadIds)
        .eq('is_outbound', true);
      
      const sentThreadIds = new Set(sentMessages?.map(m => m.thread_id) || []);
      const filteredData = data.filter(t => sentThreadIds.has(t.id));
      
      // Apply filtered inbox filters if present
      if (filteredInbox && filteredInbox.filters.length > 0) {
        await applyFilteredInboxFilters(filteredData);
      } else {
        setThreads(filteredData);
        setDisplayedThreads(filteredData);
        loadContactNames(filteredData);
      }
    } else if (filteredInbox && filteredInbox.filters.length > 0 && data) {
      // Apply filtered inbox filters
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

    // Load messages for these threads to check body/from filters
    const threadIds = threadsToFilter.map(t => t.id);
    const { data: messages } = await supabase
      .from('email_messages')
      .select('thread_id, from_address, from_name, body_text, body_html')
      .in('thread_id', threadIds);

    const messagesByThread: Record<string, any[]> = {};
    (messages || []).forEach(m => {
      if (!messagesByThread[m.thread_id]) {
        messagesByThread[m.thread_id] = [];
      }
      messagesByThread[m.thread_id].push(m);
    });

    const matchingThreads = threadsToFilter.filter(thread => {
      const threadMessages = messagesByThread[thread.id] || [];
      
      if (filteredInbox.filter_logic === 'all') {
        // ALL filters must match
        return filteredInbox.filters.every(filter => 
          matchesFilter(thread, threadMessages, filter)
        );
      } else {
        // ANY filter must match
        return filteredInbox.filters.some(filter => 
          matchesFilter(thread, threadMessages, filter)
        );
      }
    });

    setThreads(matchingThreads);
    setDisplayedThreads(matchingThreads);
    loadContactNames(matchingThreads);
  }

  // Load contact names for threads
  async function loadContactNames(threadsList: EmailThread[]) {
    if (threadsList.length === 0) return;

    const threadIds = threadsList.map(t => t.id);
    
    // Get first message from each thread to get sender email (batched to avoid URL limit)
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

    // Group by thread, get first message
    const senderByThread: Record<string, { email: string; name: string }> = {};
    messages.forEach(m => {
      if (!senderByThread[m.thread_id]) {
        senderByThread[m.thread_id] = {
          email: m.from_address || '',
          name: m.from_name || '',
        };
      }
    });

    // Get unique emails to lookup
    const uniqueEmails = [...new Set(Object.values(senderByThread).map(s => s.email).filter(Boolean))];
    
    if (uniqueEmails.length === 0) return;

    // Batch lookup contacts
    const newContactNames = new Map<string, string>();
    
    for (const [threadId, sender] of Object.entries(senderByThread)) {
      // Check cache first
      const cacheKey = `email:${sender.email.toLowerCase()}`;
      if (contactCache.has(cacheKey)) {
        const contact = contactCache.get(cacheKey);
        if (contact) {
          const name = formatContactDisplayName(contact);
          newContactNames.set(threadId, name);
        } else {
          newContactNames.set(threadId, sender.name || sender.email);
        }
        continue;
      }

      // Lookup contact
      try {
        const response = await fetch(`/api/contacts?email=${encodeURIComponent(sender.email)}`);
        const data = await response.json();
        const contact = data.contact || null;
        contactCache.set(cacheKey, contact);
        
        if (contact) {
          const name = formatContactDisplayName(contact);
          newContactNames.set(threadId, name);
        } else {
          newContactNames.set(threadId, sender.name || sender.email);
        }
      } catch (err) {
        newContactNames.set(threadId, sender.name || sender.email);
      }
    }

    setContactNames(new Map([...contactNames, ...newContactNames]));
  }

  function formatContactDisplayName(contact: Contact): string {
    const parts = [];
    if (contact.first_name) parts.push(contact.first_name);
    if (contact.last_name) parts.push(contact.last_name);
    
    const name = parts.join(' ');
    
    if (name && contact.company_name) {
      return `${name} (${contact.company_name})`;
    }
    
    return name || contact.company_name || 'Unknown';
  }

  async function handleSync() {
    setSyncing(true);

    try {
      const response = await fetch('/api/emails/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inboxId: inbox.id }),
      });

      if (response.ok) {
        await loadThreads();
      }
    } catch (err) {
      console.error('Sync error:', err);
    }

    setSyncing(false);
  }

  async function handleStar(e: React.MouseEvent, threadId: string, currentStarred: boolean) {
    e.stopPropagation();
    
    await supabase
      .from('email_threads')
      .update({ is_starred: !currentStarred })
      .eq('id', threadId);
    
    loadThreads();
  }

  async function handleDelete(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    
    await supabase
      .from('email_threads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', threadId);
    
    loadThreads();
  }

  async function handleRestore(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    
    await supabase
      .from('email_threads')
      .update({ deleted_at: null })
      .eq('id', threadId);
    
    loadThreads();
  }

  async function handlePermanentDelete(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    
    if (!confirm('Permanently delete this email? This cannot be undone.')) {
      return;
    }
    
    // Delete messages first, then thread
    await supabase.from('email_messages').delete().eq('thread_id', threadId);
    await supabase.from('thread_comments').delete().eq('thread_id', threadId);
    await supabase.from('thread_presence').delete().eq('thread_id', threadId);
    await supabase.from('email_threads').delete().eq('id', threadId);
    
    loadThreads();
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  const views: { key: EmailView; label: string; icon: JSX.Element }[] = [
    {
      key: 'all',
      label: 'All',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      key: 'unread',
      label: 'Unread',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          <circle cx="18" cy="6" r="3" fill="currentColor" />
        </svg>
      ),
    },
    {
      key: 'starred',
      label: 'Starred',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ),
    },
    {
      key: 'sent',
      label: 'Sent',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      ),
    },
    {
      key: 'trash',
      label: 'Trash',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
    },
  ];

  return (
    <div ref={listRef} className="border-r-2 border-analog-border-strong flex flex-col h-screen bg-analog-surface-alt flex-shrink-0 relative" style={{width: 360}}>
      {/* Resize handle */}
      <div
        onMouseDown={startListResize}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-analog-accent/30 transition-colors z-10"
      />
      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-analog-border-strong bg-analog-surface flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-medium text-analog-text">
            {filteredInbox ? filteredInbox.name : 'Emails'}
          </h2>
          {filteredInbox && (
            <p className="text-xs text-analog-text-faint mt-0.5 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              {filteredInbox.filters.length} filter{filteredInbox.filters.length !== 1 ? 's' : ''} • {filteredInbox.filter_logic === 'any' ? 'Match any' : 'Match all'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`p-2 rounded-lg transition-all duration-150 ${
              showSearch || searchQuery
                ? 'bg-analog-accent text-white'
                : 'text-analog-text-muted hover:bg-analog-hover hover:text-analog-text'
            }`}
            title="Search emails"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button
            onClick={handleSync}
            disabled={syncing || !inbox.google_refresh_token}
            className="px-4 py-2 text-sm font-medium text-analog-text-muted bg-analog-surface border border-analog-border-strong rounded-lg hover:border-analog-accent hover:text-analog-accent transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>

      {/* Search Panel */}
      {showSearch && (
        <div className="px-4 py-3 border-b border-analog-border bg-analog-surface space-y-3">
          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search emails..."
              className="input w-full pl-10 pr-10"
              autoFocus
            />
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-analog-text-faint hover:text-analog-text"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Search Options */}
          <div className="flex gap-2">
            <select
              value={searchField}
              onChange={(e) => setSearchField(e.target.value as SearchField)}
              className="input text-sm py-2 flex-1"
            >
              <option value="all">All fields</option>
              <option value="from">From</option>
              <option value="subject">Subject</option>
              <option value="body">Body</option>
            </select>
            <select
              value={searchMatch}
              onChange={(e) => setSearchMatch(e.target.value as SearchMatch)}
              className="input text-sm py-2 flex-1"
            >
              <option value="contains">Contains</option>
              <option value="exact">Exact match</option>
            </select>
          </div>

          {/* Search Status */}
          {searchQuery && (
            <div className="flex items-center justify-between text-xs text-analog-text-faint">
              <span>
                {searching ? 'Searching...' : `${displayedThreads.length} result${displayedThreads.length !== 1 ? 's' : ''}`}
              </span>
              {searchQuery && (
                <button
                  onClick={clearSearch}
                  className="text-analog-accent hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Active Search Indicator (when search panel is closed but search is active) */}
      {!showSearch && searchQuery && (
        <div className="px-4 py-2 border-b border-analog-border bg-analog-accent/10 flex items-center justify-between">
          <span className="text-sm text-analog-accent">
            Searching: "{searchQuery}" ({displayedThreads.length} results)
          </span>
          <button
            onClick={clearSearch}
            className="text-sm text-analog-accent hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* View Tabs */}
      <div className="px-4 py-3 border-b border-analog-border bg-analog-surface flex gap-1 overflow-x-auto">
        {views.map((view) => (
          <button
            key={view.key}
            onClick={() => setActiveView(view.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 ${
              activeView === view.key
                ? 'bg-analog-accent text-white'
                : 'text-analog-text-muted hover:bg-analog-hover hover:text-analog-text'
            }`}
          >
            {view.icon}
            {view.label}
          </button>
        ))}
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center text-analog-text-muted">Loading emails...</div>
        ) : displayedThreads.length === 0 ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-surface flex items-center justify-center">
              <svg className="w-8 h-8 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {searchQuery ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                )}
              </svg>
            </div>
            <p className="text-analog-text-muted mb-2">
              {searchQuery ? `No results for "${searchQuery}"` : (
                <>
                  {activeView === 'all' && 'No emails yet'}
                  {activeView === 'unread' && 'No unread emails'}
                  {activeView === 'starred' && 'No starred emails'}
                  {activeView === 'sent' && 'No sent emails'}
                  {activeView === 'trash' && 'Trash is empty'}
                </>
              )}
            </p>
            {searchQuery ? (
              <button
                onClick={clearSearch}
                className="text-sm text-analog-accent hover:underline font-medium"
              >
                Clear search
              </button>
            ) : activeView === 'all' && inbox.google_refresh_token ? (
              <button
                onClick={handleSync}
                className="text-sm text-analog-accent hover:underline font-medium"
              >
                Sync from Gmail
              </button>
            ) : activeView === 'all' && !inbox.google_refresh_token ? (
              <a
                href="/api/auth/google"
                className="text-sm text-analog-accent hover:underline font-medium"
              >
                Connect Gmail first
              </a>
            ) : null}
          </div>
        ) : (
          <div>
            {displayedThreads.map((thread, index) => (
              <div
                key={thread.id}
                onClick={() => {
                  onSelectThread(thread.id);
                  if (!thread.is_read && onThreadRead) onThreadRead(thread.id);
                }}
                className={`relative group cursor-pointer transition-all duration-150 ${
                  selectedThreadId === thread.id
                    ? 'bg-analog-surface border-l-4 border-l-analog-accent border-y border-y-analog-border-strong'
                    : 'border-b border-analog-border hover:bg-analog-surface'
                }`}
              >
                <div className="px-6 py-5">
                  <div className="flex items-start gap-3">
                    {/* Star button */}
                    <button
                      onClick={(e) => handleStar(e, thread.id, thread.is_starred)}
                      className={`mt-0.5 flex-shrink-0 transition-all duration-150 ${
                        thread.is_starred
                          ? 'text-analog-warning'
                          : 'text-analog-border-strong hover:text-analog-warning opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <svg 
                        className="w-4 h-4" 
                        fill={thread.is_starred ? 'currentColor' : 'none'} 
                        viewBox="0 0 24 24" 
                        stroke="currentColor" 
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </button>

                    <div className="flex-1 min-w-0">
                      {/* Sender with contact name lookup */}
                      <div className="text-xs text-analog-text-muted mb-1 truncate">
                        {contactNames.get(thread.id) || ''}
                      </div>
                      <div className="font-body text-[15px] font-medium text-analog-text mb-1.5 line-clamp-1">
                        {thread.subject || '(No subject)'}
                      </div>
                      <div className="text-[13px] text-analog-text-faint line-clamp-2 leading-relaxed">
                        {thread.snippet}
                      </div>
                      <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-analog-border-light">
                        {!thread.is_read && (
                          <span className="badge badge-primary">New</span>
                        )}
                        <span className="text-xs text-analog-text-placeholder">
                          {formatDate(thread.last_message_at)}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {activeView === 'trash' ? (
                        <>
                          <button
                            onClick={(e) => handleRestore(e, thread.id)}
                            className="p-1.5 text-analog-text-muted hover:text-analog-success hover:bg-analog-success/10 rounded transition-all duration-150"
                            title="Restore"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => handlePermanentDelete(e, thread.id)}
                            className="p-1.5 text-analog-text-muted hover:text-analog-error hover:bg-analog-error/10 rounded transition-all duration-150"
                            title="Delete permanently"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={(e) => handleDelete(e, thread.id)}
                          className="p-1.5 text-analog-text-muted hover:text-analog-error hover:bg-analog-error/10 rounded transition-all duration-150"
                          title="Move to trash"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
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
