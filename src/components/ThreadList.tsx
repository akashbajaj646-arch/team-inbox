'use client';

import { useState, useEffect, useRef } from 'react';
import { useResizable } from '@/hooks/useResizable';
import { createClient } from '@/lib/supabase/client';
import { threadAction, snoozeOptions, type ThreadAction } from '@/lib/thread-actions';
import { doWithUndo, showToast } from '@/lib/toast';
import type { EmailThread, Inbox, FilteredInbox, FilterRule, Contact } from '@/types';

type EmailView = 'inbox' | 'unread' | 'starred' | 'snoozed' | 'sent' | 'all' | 'trash';
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
  const [activeView, setActiveView] = useState<EmailView>('inbox');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [snoozeMenu, setSnoozeMenu] = useState<{ ids: string[]; x: number; y: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [contactNames, setContactNames] = useState<Map<string, string>>(new Map());
  const [threadsWithAttachments, setThreadsWithAttachments] = useState<Set<string>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EmailThread[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchSource, setSearchSource] = useState<'local' | 'gmail'>('local');
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);
  const searchActive = searchQuery.trim().length > 0;

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

  useEffect(() => { setSelected(new Set()); setHiddenIds(new Set()); setThreads([]); setDisplayedThreads([]); }, [inbox.id, filteredInbox?.id, activeView]);

  useEffect(() => {
    if (!inbox.google_refresh_token) return;
    const key = `ti.reconciled.${inbox.id}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* ignore */ }
    fetch('/api/emails/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inboxId: inbox.id }) })
      .then((r) => r.json())
      .then((d) => { if (d?.unarchived || d?.archived) loadThreadsRef.current(); })
      .catch(() => {});
  }, [inbox.id, inbox.google_refresh_token]);

  // Re-evaluate snoozes every 30s so threads reappear on time
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Server-side search, debounced while typing
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); setSearching(false); setSearchError(null); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/emails/search?inboxId=${inbox.id}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (seq !== searchSeq.current) return;
        if (!res.ok) { setSearchError(data.error || 'Search failed'); setSearchResults([]); }
        else {
          setSearchError(null);
          setSearchResults(data.threads || []);
          setSearchSource(data.source || 'local');
          loadContactNames(data.threads || []);
          loadThreadAttachments(data.threads || []);
        }
      } catch {
        if (seq === searchSeq.current) { setSearchError('Search failed'); setSearchResults([]); }
      }
      if (seq === searchSeq.current) setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, inbox.id]);

  // New inbox: clear the search
  useEffect(() => { setSearchQuery(''); }, [inbox.id]);

  // "/" focuses search, Escape clears it (Gmail style)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (e.key === '/' && !typing) { e.preventDefault(); searchInputRef.current?.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

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
      setThreadsWithAttachments((prev) => { const m = new Set(prev); set.forEach((id) => m.add(id)); return m; });
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults(null);
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

  const loadSeq = useRef(0);
  const loadThreadsRef = useRef<() => Promise<void>>(async () => {});

  async function loadThreads() {
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;
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
      case 'inbox': query = query.is('deleted_at', null).or('is_archived.is.null,is_archived.eq.false'); break;
      case 'unread': query = query.eq('is_read', false).is('deleted_at', null).or('is_archived.is.null,is_archived.eq.false'); break;
      case 'starred': query = query.eq('is_starred', true).is('deleted_at', null); break;
      case 'snoozed': query = query.is('deleted_at', null).gt('snoozed_until', new Date().toISOString()); break;
      case 'sent': query = query.is('deleted_at', null); break;
      case 'all': query = query.is('deleted_at', null); break;
      case 'trash': query = query.not('deleted_at', 'is', null); break;
    }

    const { data } = await query;
    if (stale()) return;

    if (activeView === 'sent' && data) {
      const threadIds = data.map(t => t.id);
      const { data: sentMessages } = await supabase.from('email_messages').select('thread_id').in('thread_id', threadIds).eq('is_outbound', true);
      if (stale()) return;
      const sentThreadIds = new Set(sentMessages?.map(m => m.thread_id) || []);
      const filteredData = data.filter(t => sentThreadIds.has(t.id));
      if (filteredInbox && filteredInbox.filters.length > 0) {
        await applyFilteredInboxFilters(filteredData, stale);
      } else {
        setThreads(filteredData);
        setDisplayedThreads(filteredData);
        loadContactNames(filteredData);
      }
    } else if (filteredInbox && filteredInbox.filters.length > 0 && data) {
      await applyFilteredInboxFilters(data, stale);
    } else {
      setThreads(data || []);
      setDisplayedThreads(data || []);
      loadContactNames(data || []);
    }

    if (!stale()) setLoading(false);
  }
  loadThreadsRef.current = loadThreads;

  async function applyFilteredInboxFilters(threadsToFilter: EmailThread[], stale: () => boolean = () => false) {
    if (!filteredInbox || threadsToFilter.length === 0) {
      setThreads(threadsToFilter);
      setDisplayedThreads(threadsToFilter);
      loadContactNames(threadsToFilter);
      return;
    }

    const threadIds = threadsToFilter.map(t => t.id);
    const { data: messages } = await supabase.from('email_messages').select('thread_id, from_address, from_name, body_text, body_html').in('thread_id', threadIds);
    if (stale()) return;
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

    setContactNames((prev) => { const m = new Map(prev); newContactNames.forEach((v: string, k: string) => m.set(k, v)); return m; });
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

  const UNDO: Partial<Record<ThreadAction, ThreadAction>> = {
    archive: 'unarchive', unarchive: 'archive', trash: 'restore', restore: 'trash', snooze: 'unsnooze',
  };
  const DONE_LABEL: Partial<Record<ThreadAction, string>> = {
    archive: 'Archived', unarchive: 'Moved to inbox', trash: 'Moved to trash', restore: 'Restored', snooze: 'Snoozed', unsnooze: 'Unsnoozed',
  };

  /** Run an action on threads with optimistic UI and an Undo toast. */
  async function act(ids: string[], action: ThreadAction, until?: string) {
    if (ids.length === 0) return;
    setSelected(new Set());
    const removes = ['archive', 'unarchive', 'trash', 'restore', 'snooze', 'unsnooze'].includes(action);
    const leavesView =
      removes &&
      !(action === 'archive' && activeView === 'all') &&
      !(action === 'unarchive' && activeView !== 'trash');

    // Move selection to the neighbour before the open thread disappears
    if (leavesView && selectedThreadId && ids.includes(selectedThreadId)) {
      const list = visibleThreads;
      const idx = list.findIndex((t) => t.id === selectedThreadId);
      const next = list.slice(idx + 1).find((t) => !ids.includes(t.id)) || list.slice(0, idx).reverse().find((t) => !ids.includes(t.id));
      if (next) selectThread(next);
    }

    if (leavesView) setHiddenIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n; });
    if (action === 'read' || action === 'unread') {
      const val = action === 'read';
      setThreads((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, is_read: val } : t)));
      setDisplayedThreads((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, is_read: val } : t)));
      setSearchResults((prev) => prev && prev.map((t) => (ids.includes(t.id) ? { ...t, is_read: val } : t)));
    }

    const ok = await threadAction(ids, action, until);
    const unhide = () => setHiddenIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
    if (!ok) {
      unhide();
      loadThreadsRef.current();
      showToast({ message: 'That did not work. Please try again.', tone: 'error' });
      return;
    }
    await loadThreadsRef.current();
    unhide();

    const reverse = UNDO[action];
    const label = DONE_LABEL[action];
    if (reverse && label) {
      const noun = ids.length === 1 ? 'Conversation' : `${ids.length} conversations`;
      doWithUndo({
        message: `${noun} ${label.toLowerCase()}`,
        undo: async () => { await threadAction(ids, reverse); loadThreadsRef.current(); },
      });
    }
  }

  async function handleDelete(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    act([threadId], 'trash');
  }

  async function handleRestore(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    act([threadId], 'restore');
  }

  function openSnooze(e: React.MouseEvent, ids: string[]) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSnoozeMenu({ ids, x: Math.min(r.left, window.innerWidth - 260), y: Math.min(r.bottom + 4, window.innerHeight - 260) });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
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

  function selectThread(thread: { id: string; is_read: boolean }) {
    onSelectThread(thread.id);
    if (!thread.is_read) {
      // Show it as read right away; the database and Gmail update in the background
      const mark = (list: EmailThread[]) => list.map((t) => (t.id === thread.id ? { ...t, is_read: true } : t));
      setThreads(mark);
      setDisplayedThreads(mark);
      setSearchResults((prev) => (prev ? mark(prev) : prev));
      if (onThreadRead) onThreadRead(thread.id);
    }
  }

  const snoozeAware = activeView === 'inbox' || activeView === 'unread';
  const sortKey = (t: EmailThread) => {
    const last = new Date(t.last_message_at).getTime();
    const sn = t.snoozed_until ? new Date(t.snoozed_until).getTime() : 0;
    return sn && sn <= now ? Math.max(last, sn) : last;
  };
  const visibleThreads = (searchResults ?? displayedThreads)
    .filter((t) => !hiddenIds.has(t.id))
    .filter((t) => searchResults || !snoozeAware || !t.snoozed_until || new Date(t.snoozed_until).getTime() <= now)
    .sort((a, b) => (snoozeAware && !searchResults ? sortKey(b) - sortKey(a) : 0));

  // Gmail-style list shortcuts: j/k move, # trash
  const listKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  listKeyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!['j', 'k', '#', 'e', 'x', 'b', 'I', 'U'].includes(e.key) || visibleThreads.length === 0) return;
    const idx = visibleThreads.findIndex((th) => th.id === selectedThreadId);
    // Bulk selection wins over the open thread for action keys
    const targets = selected.size > 0 ? Array.from(selected) : idx >= 0 ? [visibleThreads[idx].id] : [];
    if (e.key === '#') {
      if (!targets.length || activeView === 'trash') return;
      e.preventDefault(); act(targets, 'trash'); return;
    }
    if (e.key === 'e') {
      if (!targets.length || activeView === 'trash') return;
      e.preventDefault(); act(targets, 'archive'); return;
    }
    if (e.key === 'I' || e.key === 'U') {
      if (!targets.length) return;
      e.preventDefault(); act(targets, e.key === 'I' ? 'read' : 'unread'); return;
    }
    if (e.key === 'x') {
      if (idx < 0) return;
      e.preventDefault(); toggleSelected(visibleThreads[idx].id); return;
    }
    if (e.key === 'b') {
      if (!targets.length) return;
      e.preventDefault();
      const el = listRef.current?.querySelector(`[data-thread-id="${targets[0]}"]`) as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      setSnoozeMenu({ ids: targets, x: (r?.left ?? 100) + 40, y: Math.min((r?.bottom ?? 100), window.innerHeight - 260) });
      return;
    }
    e.preventDefault();
    const nextIdx = e.key === 'j' ? Math.min(idx + 1, visibleThreads.length - 1) : Math.max(idx - 1, 0);
    const target = visibleThreads[idx < 0 ? 0 : nextIdx];
    if (!target) return;
    selectThread(target);
    listRef.current?.querySelector(`[data-thread-id="${target.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => listKeyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const views: { key: EmailView; label: string }[] = [
    { key: 'inbox', label: 'Inbox' },
    { key: 'unread', label: 'Unread' },
    { key: 'starred', label: 'Starred' },
    { key: 'snoozed', label: 'Snoozed' },
    { key: 'sent', label: 'Sent' },
    { key: 'all', label: 'All mail' },
    { key: 'trash', label: 'Trash' },
  ];
  const selectedIds = Array.from(selected);
  const allSelected = visibleThreads.length > 0 && visibleThreads.every((t) => selected.has(t.id));
  const anyUnreadSelected = visibleThreads.some((t) => selected.has(t.id) && !t.is_read);

  return (
    <div ref={listRef} className="border-r border-analog-border-light flex flex-col h-screen bg-white flex-shrink-0 relative" style={{width: 360}}>
      <div onMouseDown={startListResize} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-analog-accent/30 transition-colors z-10" />

      <div className="px-4 py-3 border-b border-analog-border-light bg-white flex items-center justify-between">
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
          <button onClick={handleSync} disabled={syncing || !inbox.google_refresh_token} className="px-4 py-2 text-sm font-medium text-analog-text-muted bg-analog-surface border border-analog-border-strong rounded-lg hover:border-analog-accent hover:text-analog-accent transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed">
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>

      <div className="px-3 pt-2.5 pb-2 border-b border-analog-border bg-white">
        <div className={`flex items-center gap-2 h-10 px-3 rounded-full transition-colors ${searchActive ? 'bg-white ring-1 ring-[#dadce0] shadow-sm' : 'bg-[#eaf1fb] focus-within:bg-white focus-within:ring-1 focus-within:ring-[#dadce0] focus-within:shadow-sm'}`}>
          <svg className="w-4 h-4 text-[#444746] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { clearSearch(); (e.target as HTMLInputElement).blur(); } }}
            placeholder="Search mail  (from:  subject:  has:attachment)"
            className="flex-1 min-w-0 bg-transparent text-sm text-[#202124] placeholder-[#5f6368] focus:outline-none"
          />
          {searching && <span className="w-3.5 h-3.5 border-2 border-[#1a73e8] border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          {searchActive && (
            <button onClick={clearSearch} className="p-1 rounded-full text-[#5f6368] hover:bg-[#f1f3f4]" title="Clear search (Esc)">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        {searchActive && searchResults && !searching && (
          <div className="mt-1.5 px-2 text-xs text-[#5f6368]">
            {searchError
              ? <span className="text-[#d93025]">{searchError}</span>
              : <>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}{searchSource === 'gmail' && searchResults.length > 0 ? ' found in Gmail' : ''}</>}
          </div>
        )}
      </div>

      {selected.size > 0 ? (
        <div className="px-2 h-11 border-b border-analog-border bg-[#f6f8fc] flex items-center gap-0.5">
          <BulkButton title={allSelected ? 'Deselect all' : 'Select all'} onClick={() => setSelected(allSelected ? new Set() : new Set(visibleThreads.map((t) => t.id)))}>
            <Checkbox checked={allSelected} partial={!allSelected} />
          </BulkButton>
          <span className="text-xs font-medium text-[#444746] px-1.5 mr-auto">{selected.size} selected</span>
          {activeView === 'trash' ? (
            <BulkButton title="Restore" onClick={() => act(selectedIds, 'restore')}><Ico d={ICON.restore} /></BulkButton>
          ) : (
            <>
              {activeView === 'all'
                ? <BulkButton title="Move to inbox" onClick={() => act(selectedIds, 'unarchive')}><Ico d={ICON.inbox} /></BulkButton>
                : <BulkButton title="Archive (e)" onClick={() => act(selectedIds, 'archive')}><Ico d={ICON.archive} /></BulkButton>}
              <BulkButton title="Move to trash (#)" onClick={() => act(selectedIds, 'trash')}><Ico d={ICON.trash} /></BulkButton>
              <BulkButton title={anyUnreadSelected ? 'Mark as read' : 'Mark as unread'} onClick={() => act(selectedIds, anyUnreadSelected ? 'read' : 'unread')}>
                <Ico d={anyUnreadSelected ? ICON.read : ICON.unread} />
              </BulkButton>
              {activeView === 'snoozed'
                ? <BulkButton title="Unsnooze" onClick={() => act(selectedIds, 'unsnooze')}><Ico d={ICON.inbox} /></BulkButton>
                : <BulkButton title="Snooze (b)" onClick={(e) => openSnooze(e, selectedIds)}><Ico d={ICON.clock} /></BulkButton>}
            </>
          )}
          <BulkButton title="Clear selection" onClick={() => setSelected(new Set())}><Ico d={ICON.close} /></BulkButton>
        </div>
      ) : (
        <div className={`px-3 py-2 border-b border-analog-border bg-white gap-1 overflow-x-auto ${searchActive ? 'hidden' : 'flex'}`}>
          {views.map((view) => (
            <button key={view.key} onClick={() => setActiveView(view.key)} className={`px-2.5 py-1 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${activeView === view.key ? 'bg-[#d3e3fd] text-[#041e49]' : 'text-[#444746] hover:bg-[#f1f3f4]'}`}>
              {view.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && !searchActive && threads.length === 0 ? (
          <div className="p-6 text-center text-analog-text-muted">Loading emails...</div>
        ) : visibleThreads.length === 0 ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-surface flex items-center justify-center">
              <svg className="w-8 h-8 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {<path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />}
              </svg>
            </div>
            <p className="text-analog-text-muted mb-2">
              {searchActive ? (searching ? 'Searching...' : 'No results in this inbox or Gmail') : ({ inbox: 'Inbox zero. Nice work.', unread: 'No unread emails', starred: 'No starred emails', snoozed: 'Nothing snoozed', sent: 'No sent emails', all: 'No emails yet', trash: 'Trash is empty' }[activeView])}
            </p>
            {searchActive ? <button onClick={clearSearch} className="text-sm text-analog-accent hover:underline font-medium">Clear search</button>
              : (activeView === 'all' || activeView === 'inbox') && threads.length === 0 && inbox.google_refresh_token ? <button onClick={handleSync} className="text-sm text-analog-accent hover:underline font-medium">Sync from Gmail</button>
              : (activeView === 'all' || activeView === 'inbox') && !inbox.google_refresh_token ? <a href="/api/auth/google" className="text-sm text-analog-accent hover:underline font-medium">Connect Gmail first</a>
              : null}
          </div>
        ) : (
          <div>
            {visibleThreads.map((thread) => {
              const isSelected = selectedThreadId === thread.id;
              const unread = !thread.is_read;
              const checked = selected.has(thread.id);
              const snoozedUntil = thread.snoozed_until && new Date(thread.snoozed_until).getTime() > now ? new Date(thread.snoozed_until) : null;
              return (
              <div
                key={thread.id}
                data-thread-id={thread.id}
                onClick={() => selectThread(thread)}
                className={`relative group cursor-pointer border-b border-[#f1f3f4] ${checked ? 'bg-[#c2dbff]' : isSelected ? 'bg-[#e8f0fe]' : 'bg-white hover:bg-[#f8f9fa] hover:shadow-[inset_1px_0_0_#dadce0,inset_-1px_0_0_#dadce0,0_1px_2px_rgba(60,64,67,.15)]'}`}
              >
                {isSelected && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#1a73e8]" />}
                <div className="pl-3 pr-3 py-2 flex gap-2">
                  <div className="w-5 pt-0.5 flex-shrink-0 flex justify-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelected(thread.id); }}
                      className={`w-5 h-5 items-center justify-center ${selected.size > 0 || checked ? 'flex' : 'hidden group-hover:flex'}`}
                      title="Select (x)"
                    >
                      <Checkbox checked={checked} />
                    </button>
                    {unread && selected.size === 0 && !checked && (
                      <span className="w-2 h-2 mt-[5px] rounded-full bg-[#1a73e8] group-hover:hidden" title="Unread" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 h-5">
                      <span className={`flex-1 min-w-0 truncate text-sm ${unread ? 'font-bold text-[#202124]' : 'text-[#3c4043]'}`}>
                        {contactNames.get(thread.id) || 'Unknown sender'}
                      </span>
                      {threadsWithAttachments.has(thread.id) && (
                        <svg className="w-3.5 h-3.5 text-[#5f6368] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      )}
                      {thread.is_starred && (
                        <svg className="w-3.5 h-3.5 text-[#f4b400] flex-shrink-0 group-hover:hidden" fill="currentColor" viewBox="0 0 24 24"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                      )}
                      <span className={`text-xs flex-shrink-0 group-hover:hidden ${unread ? 'font-bold text-[#202124]' : 'text-[#5f6368]'}`}>
                        {snoozedUntil
                          ? <span className="text-[#b06000]" title={`Snoozed until ${snoozedUntil.toLocaleString()}`}>{snoozedUntil.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                          : formatDate(thread.last_message_at)}
                      </span>
                      <div className="hidden group-hover:flex items-center gap-0.5 -mr-1">
                        {activeView !== 'trash' && (
                          <button onClick={(e) => handleStar(e, thread.id, thread.is_starred)} className={`p-1 rounded-full hover:bg-[#e8eaed] ${thread.is_starred ? 'text-[#f4b400]' : 'text-[#5f6368]'}`} title={thread.is_starred ? 'Unstar' : 'Star'}>
                            <svg className="w-4 h-4" fill={thread.is_starred ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                          </button>
                        )}
                        {activeView === 'trash' ? (
                          <>
                            <button onClick={(e) => handleRestore(e, thread.id)} className="p-1 rounded-full text-[#5f6368] hover:bg-[#e8eaed] hover:text-[#202124]" title="Restore">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                            </button>
                            <button onClick={(e) => handlePermanentDelete(e, thread.id)} className="p-1 rounded-full text-[#5f6368] hover:bg-[#e8eaed] hover:text-[#d93025]" title="Delete permanently">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </>
                        ) : (
                          <>
                          {activeView === 'all' && thread.is_archived
                            ? <RowButton title="Move to inbox" onClick={(e) => { e.stopPropagation(); act([thread.id], 'unarchive'); }}><Ico d={ICON.inbox} small /></RowButton>
                            : <RowButton title="Archive (e)" onClick={(e) => { e.stopPropagation(); act([thread.id], 'archive'); }}><Ico d={ICON.archive} small /></RowButton>}
                          <RowButton title={unread ? 'Mark as read' : 'Mark as unread'} onClick={(e) => { e.stopPropagation(); act([thread.id], unread ? 'read' : 'unread'); }}>
                            <Ico d={unread ? ICON.read : ICON.unread} small />
                          </RowButton>
                          {snoozedUntil
                            ? <RowButton title="Unsnooze" onClick={(e) => { e.stopPropagation(); act([thread.id], 'unsnooze'); }}><Ico d={ICON.inbox} small /></RowButton>
                            : <RowButton title="Snooze (b)" onClick={(e) => openSnooze(e, [thread.id])}><Ico d={ICON.clock} small /></RowButton>}
                          <button onClick={(e) => handleDelete(e, thread.id)} className="p-1 rounded-full text-[#5f6368] hover:bg-[#e8eaed] hover:text-[#202124]" title="Move to trash (#)">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className={`truncate text-[13px] leading-5 ${unread ? 'font-semibold text-[#202124]' : 'text-[#3c4043]'}`}>
                      {thread.subject || '(No subject)'}
                    </div>
                    <div className="truncate text-[13px] leading-5 text-[#5f6368]">
                      {decodeEntities(thread.snippet || '')}
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {snoozeMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setSnoozeMenu(null)} />
          <div className="fixed z-[61] w-64 bg-white border border-[#dadce0] rounded-lg shadow-xl py-2" style={{ left: snoozeMenu.x, top: snoozeMenu.y }}>
            <div className="px-4 pb-1.5 text-xs font-medium text-[#5f6368]">Snooze until...</div>
            {snoozeOptions().map((o) => (
              <button
                key={o.label}
                onClick={() => { const ids = snoozeMenu.ids; setSnoozeMenu(null); act(ids, 'snooze', o.until.toISOString()); }}
                className="w-full flex items-center justify-between px-4 py-2 text-sm text-[#202124] hover:bg-[#f1f3f4]"
              >
                <span>{o.label}</span>
                <span className="text-xs text-[#5f6368]">{o.detail}</span>
              </button>
            ))}
            <label className="block px-4 pt-2 mt-1 border-t border-[#f1f3f4] text-xs text-[#5f6368]">
              Pick date and time
              <input
                type="datetime-local"
                className="mt-1 w-full text-sm text-[#202124] border border-[#dadce0] rounded px-2 py-1"
                onChange={(e) => {
                  const d = new Date(e.target.value);
                  if (isNaN(d.getTime()) || d.getTime() <= Date.now()) return;
                  const ids = snoozeMenu.ids; setSnoozeMenu(null); act(ids, 'snooze', d.toISOString());
                }}
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}

const ICON = {
  archive: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
  inbox: 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  read: 'M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76',
  unread: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  restore: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6',
  close: 'M6 18L18 6M6 6l12 12',
};

function Ico({ d, small }: { d: string; small?: boolean }) {
  return (
    <svg className={small ? 'w-4 h-4' : 'w-[18px] h-[18px]'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function RowButton({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="p-1 rounded-full text-[#5f6368] hover:bg-[#e8eaed] hover:text-[#202124]">
      {children}
    </button>
  );
}

function BulkButton({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="p-2 rounded-full text-[#444746] hover:bg-[#e8eaed] hover:text-[#202124]">
      {children}
    </button>
  );
}

function Checkbox({ checked, partial }: { checked: boolean; partial?: boolean }) {
  return (
    <span className={`w-4 h-4 rounded-[3px] border-2 flex items-center justify-center ${checked ? 'bg-[#0b57d0] border-[#0b57d0]' : 'border-[#747775] bg-white'}`}>
      {checked && (
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      )}
      {!checked && partial && <span className="w-2 h-0.5 bg-[#747775]" />}
    </span>
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
