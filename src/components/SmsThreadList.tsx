'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SmsThread, Inbox, Contact } from '@/types';

interface SmsThreadListProps {
  inbox: Inbox;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
}

// Contact cache for SMS
const smsContactCache: Map<string, Contact | null> = new Map();

export default function SmsThreadList({
  inbox,
  selectedThreadId,
  onSelectThread,
}: SmsThreadListProps) {
  const [threads, setThreads] = useState<SmsThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [contactNames, setContactNames] = useState<Map<string, string>>(new Map());
  const supabase = createClient();

  useEffect(() => {
    loadThreads();

    const channel = supabase
      .channel(`sms-threads:${inbox.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sms_threads',
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
  }, [inbox.id]);

  async function loadThreads() {
    setLoading(true);
    
    const response = await fetch(`/api/sms/threads?inboxId=${inbox.id}`);
    const data = await response.json();
    
    if (data.threads) {
      setThreads(data.threads);
      loadContactNames(data.threads);
    }
    
    setLoading(false);
  }

  async function loadContactNames(threadsList: SmsThread[]) {
    if (threadsList.length === 0) return;

    const newContactNames = new Map<string, string>();

    // Collect all unique phones
    const phones = threadsList.map(t => t.contact_phone).filter(Boolean);
    const uniquePhones = [...new Set(phones)];

    // Batch lookup saved customer links by phone
    const customerNameByPhone = new Map<string, string>();
    if (uniquePhones.length > 0) {
      // Try each phone variant (raw and digits-only)
      const { data: links } = await supabase
        .from('thread_customer_links')
        .select('phone, customer:customers(customer_name)')
        .not('phone', 'is', null);

      if (links) {
        for (const link of links) {
          const linkPhone = (link.phone || '').replace(/\D/g, '');
          if (linkPhone) {
            const customer = Array.isArray(link.customer) ? link.customer[0] : link.customer;
            if (customer?.customer_name) {
              customerNameByPhone.set(linkPhone, customer.customer_name);
            }
          }
        }
      }
    }

    for (const thread of threadsList) {
      const phone = thread.contact_phone;
      const cleanPhone = phone.replace(/\D/g, '');

      // Check if we have a saved customer link — highest priority
      if (customerNameByPhone.has(cleanPhone)) {
        newContactNames.set(thread.id, customerNameByPhone.get(cleanPhone)!);
        continue;
      }

      // If thread already has a contact_name set, use that
      if (thread.contact_name) {
        newContactNames.set(thread.id, thread.contact_name);
        continue;
      }

      const cacheKey = `phone:${cleanPhone}`;

      if (smsContactCache.has(cacheKey)) {
        const contact = smsContactCache.get(cacheKey);
        if (contact) {
          const name = formatContactDisplayName(contact);
          newContactNames.set(thread.id, name);
        }
        continue;
      }

      // Lookup contact by phone
      try {
        const response = await fetch(`/api/contacts?phone=${encodeURIComponent(phone)}`);
        const data = await response.json();
        const contact = data.contact || null;
        smsContactCache.set(cacheKey, contact);
        
        if (contact) {
          const name = formatContactDisplayName(contact);
          newContactNames.set(thread.id, name);
        }
      } catch (err) {
        // Ignore errors
      }
    }

    setContactNames(prev => {
      const merged = new Map(Array.from(prev.entries()).concat(Array.from(newContactNames.entries())));
      return merged;
    });
  }

  function formatContactDisplayName(contact: Contact): string {
    const parts = [];
    if (contact.first_name) parts.push(contact.first_name);
    if (contact.last_name) parts.push(contact.last_name);
    
    const name = parts.join(' ');
    
    if (name && contact.company_name) {
      return `${name} (${contact.company_name})`;
    }
    
    return name || contact.company_name || '';
  }

  async function handleCreateThread() {
    if (!newPhone.trim()) return;
    
    setCreating(true);
    
    const response = await fetch('/api/sms/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inboxId: inbox.id,
        contactPhone: newPhone.trim(),
        contactName: newName.trim() || null,
      }),
    });
    
    const data = await response.json();
    
    if (data.thread) {
      onSelectThread(data.thread.id);
      setShowNewThread(false);
      setNewPhone('');
      setNewName('');
      loadThreads();
    }
    
    setCreating(false);
  }

  async function handleStar(e: React.MouseEvent, threadId: string, isStarred: boolean) {
    e.stopPropagation();
    
    await fetch('/api/sms/threads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, is_starred: !isStarred }),
    });
    
    setThreads(prev =>
      prev.map(t => t.id === threadId ? { ...t, is_starred: !isStarred } : t)
    );
  }

  async function handleSync() {
    setSyncing(true);
    setSyncStatus('Syncing messages from Twilio...');

    try {
      const response = await fetch('/api/sms/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inboxId: inbox.id }),
      });

      const data = await response.json();

      if (data.success) {
        setSyncStatus(`Synced ${data.synced} messages, ${data.threadsCreated} new conversations`);
        loadThreads();
      } else {
        setSyncStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setSyncStatus('Failed to sync messages');
    }

    setSyncing(false);
    setTimeout(() => setSyncStatus(null), 5000);
  }

  function formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  }

  function formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const filteredThreads = searchQuery
    ? threads.filter(t => 
        t.contact_phone.includes(searchQuery) ||
        t.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.last_message_preview?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contactNames.get(t.id)?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : threads;

  return (
    <div className="w-[360px] border-r-2 border-analog-border-strong flex flex-col h-screen bg-analog-surface-alt">
      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-analog-border-strong bg-analog-surface flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-medium text-analog-text">Messages</h2>
          <p className="text-xs text-analog-text-faint mt-0.5">
            {inbox.twilio_phone_number ? formatPhone(inbox.twilio_phone_number) : 'SMS Inbox'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`p-2 rounded-lg transition-all duration-150 ${
              syncing
                ? 'bg-analog-accent/20 text-analog-accent'
                : 'text-analog-text-muted hover:bg-analog-hover hover:text-analog-text'
            }`}
            title="Sync last 30 days"
          >
            <svg className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`p-2 rounded-lg transition-all duration-150 ${
              showSearch || searchQuery
                ? 'bg-analog-accent text-white'
                : 'text-analog-text-muted hover:bg-analog-hover hover:text-analog-text'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button
            onClick={() => setShowNewThread(true)}
            className="p-2 text-analog-text-muted hover:bg-analog-hover hover:text-analog-accent rounded-lg transition-all duration-150"
            title="New message"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sync Status */}
      {syncStatus && (
        <div className={`px-4 py-2 text-sm border-b border-analog-border ${
          syncStatus.startsWith('Error') 
            ? 'bg-analog-error/10 text-analog-error' 
            : 'bg-analog-accent/10 text-analog-accent'
        }`}>
          {syncStatus}
        </div>
      )}

      {/* Search Panel */}
      {showSearch && (
        <div className="px-4 py-3 border-b border-analog-border bg-analog-surface">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              className="input w-full pl-10"
              autoFocus
            />
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      )}

      {/* New Thread Modal */}
      {showNewThread && (
        <div className="px-4 py-4 border-b border-analog-border bg-analog-surface space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-analog-text">New Message</h3>
            <button
              onClick={() => setShowNewThread(false)}
              className="text-analog-text-muted hover:text-analog-text"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <input
            type="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Phone number (e.g., +1234567890)"
            className="input w-full"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Contact name (optional)"
            className="input w-full"
          />
          <button
            onClick={handleCreateThread}
            disabled={!newPhone.trim() || creating}
            className="btn btn-primary w-full disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Start Conversation'}
          </button>
        </div>
      )}

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center text-analog-text-muted">Loading messages...</div>
        ) : filteredThreads.length === 0 ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-surface flex items-center justify-center">
              <svg className="w-8 h-8 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-analog-text-muted mb-2">
              {searchQuery ? 'No matching conversations' : 'No messages yet'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowNewThread(true)}
                className="text-sm text-analog-accent hover:underline font-medium"
              >
                Start a conversation
              </button>
            )}
          </div>
        ) : (
          <div>
            {filteredThreads.map((thread) => {
              const displayName = contactNames.get(thread.id) || thread.contact_name || formatPhone(thread.contact_phone);
              const isCustomerLinked = contactNames.get(thread.id) !== undefined;

              return (
                <div
                  key={thread.id}
                  onClick={() => onSelectThread(thread.id)}
                  className={`relative group cursor-pointer transition-all duration-150 ${
                    selectedThreadId === thread.id
                      ? 'bg-analog-surface border-l-4 border-l-analog-accent border-y border-y-analog-border-strong'
                      : 'border-b border-analog-border hover:bg-analog-surface'
                  }`}
                >
                  <div className="px-6 py-4">
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

                      {/* Message icon / avatar */}
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        !thread.is_read ? 'bg-analog-accent text-white' : 'bg-analog-border text-analog-text-muted'
                      }`}>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className={`text-sm truncate ${
                            !thread.is_read ? 'font-semibold text-analog-text' : 'text-analog-text'
                          }`}>
                            {displayName}
                          </h3>
                          <span className="text-xs text-analog-text-faint whitespace-nowrap">
                            {formatTime(thread.last_message_at)}
                          </span>
                        </div>
                        {/* Show phone number as subtitle when we have a name */}
                        {(contactNames.get(thread.id) || thread.contact_name) && (
                          <p className="text-xs text-analog-text-faint truncate">
                            {formatPhone(thread.contact_phone)}
                          </p>
                        )}
                        <p className={`text-sm truncate mt-1 ${
                          !thread.is_read ? 'text-analog-text-secondary' : 'text-analog-text-muted'
                        }`}>
                          {thread.last_message_preview || 'No messages yet'}
                        </p>
                      </div>

                      {/* Unread indicator */}
                      {!thread.is_read && (
                        <div className="w-2 h-2 rounded-full bg-analog-accent flex-shrink-0 mt-2" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
