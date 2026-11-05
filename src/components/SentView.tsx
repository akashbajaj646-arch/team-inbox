'use client';

import { useState, useEffect } from 'react';

interface SentMessage {
  id: string;
  thread_id: string;
  subject: string;
  to_addresses: string[];
  cc_addresses: string[];
  snippet: string;
  sent_at: string;
  inbox_id: string;
  inbox_name: string;
  is_personal: boolean;
  sent_by: string | null;
}

interface SentViewProps {
  onSelectThread: (threadId: string) => void;
}

export default function SentView({ onSelectThread }: SentViewProps) {
  const [messages, setMessages] = useState<SentMessage[]>([]);
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [inboxFilter, setInboxFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(true); }, [inboxFilter]);

  async function load(reset: boolean) {
    if (reset) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (inboxFilter) params.set('inboxId', inboxFilter);
      if (!reset && messages.length > 0) params.set('before', messages[messages.length - 1].sent_at);
      const res = await fetch(`/api/emails/sent?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setMessages(prev => reset ? (data.messages || []) : prev.concat(data.messages || []));
      if (reset && data.inboxes) setInboxes(data.inboxes);
      setHasMore(!!data.hasMore);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString();
  }

  function recipients(m: SentMessage) {
    const all = (m.to_addresses || []).concat(m.cc_addresses || []);
    if (all.length === 0) return '(no recipient)';
    if (all.length <= 2) return all.join(', ');
    return `${all.slice(0, 2).join(', ')} +${all.length - 2}`;
  }

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-analog-surface">
      <div className="px-8 py-5 border-b-2 border-analog-border-strong flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-medium text-analog-text">Sent</h2>
          <p className="text-sm text-analog-text-muted mt-1">All sent email across your shared and personal inboxes</p>
        </div>
        <select
          value={inboxFilter}
          onChange={(e) => setInboxFilter(e.target.value)}
          className="text-sm bg-analog-surface-alt border border-analog-border rounded-lg px-3 py-1.5 text-analog-text"
        >
          <option value="">All inboxes</option>
          {inboxes.map((i: any) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-center text-analog-text-muted py-10">Loading...</p>
        ) : error ? (
          <p className="text-center text-red-500 py-10">{error}</p>
        ) : messages.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-analog-text-muted font-medium">No sent email</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-4xl">
            {messages.map(m => (
              <div
                key={m.id}
                onClick={() => onSelectThread(m.thread_id)}
                className="flex items-start gap-4 p-4 bg-analog-surface-alt border border-analog-border rounded-lg hover:border-analog-accent cursor-pointer transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${m.is_personal ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {m.inbox_name || (m.is_personal ? 'Personal' : 'Shared')}
                    </span>
                    <p className="text-sm text-analog-text truncate">
                      <span className="text-analog-text-muted">To: </span>{recipients(m)}
                    </p>
                  </div>
                  <p className="font-semibold text-sm text-analog-text truncate">{m.subject}</p>
                  <p className="text-sm text-analog-text-muted truncate mt-0.5">{m.snippet || '(empty)'}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-xs text-analog-text-faint">{formatDate(m.sent_at)}</span>
                  {m.sent_by && !m.is_personal && (
                    <span className="text-[11px] text-analog-text-faint">by {m.sent_by}</span>
                  )}
                </div>
              </div>
            ))}
            {hasMore && (
              <button
                onClick={() => load(false)}
                disabled={loadingMore}
                className="w-full py-3 text-sm text-analog-text-muted hover:text-analog-text"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
