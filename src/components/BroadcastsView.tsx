'use client';

import { useState, useEffect } from 'react';
import BroadcastCompose from './BroadcastCompose';

export default function BroadcastsView() {
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/broadcasts');
    const data = await res.json();
    setBroadcasts(data.broadcasts || []);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this broadcast record?')) return;
    await fetch(`/api/broadcasts?id=${id}`, { method: 'DELETE' });
    load();
  }

  function statusBadge(status: string) {
    const styles: Record<string, string> = {
      draft: 'bg-analog-surface-alt text-analog-text-muted',
      sending: 'bg-blue-100 text-blue-700',
      sent: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>{status}</span>;
  }

  return (
    <div className="flex flex-1 h-screen overflow-hidden">
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="font-display text-2xl font-medium text-analog-text">Broadcasts</h1>
              <p className="text-sm text-analog-text-muted mt-1">Send mass emails to customer segments</p>
            </div>
            <button onClick={() => setShowCompose(true)} className="btn btn-primary">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Broadcast
            </button>
          </div>

          {loading ? (
            <div className="text-center py-10 text-analog-text-muted">Loading...</div>
          ) : broadcasts.length === 0 ? (
            <div className="text-center py-16 bg-analog-surface border-2 border-analog-border-strong rounded-xl">
              <p className="font-medium text-analog-text mb-1">No broadcasts yet</p>
              <p className="text-sm text-analog-text-faint">Send your first broadcast to a segment of contacts</p>
            </div>
          ) : (
            <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-analog-surface-alt border-b border-analog-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Subject</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Segment</th>
                    <th className="text-center px-4 py-3 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Sent</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {broadcasts.map(b => (
                    <tr key={b.id} className="border-b border-analog-border-light hover:bg-analog-hover">
                      <td className="px-4 py-3 font-medium text-analog-text">{b.name}</td>
                      <td className="px-4 py-3 text-analog-text-muted truncate max-w-xs">{b.subject}</td>
                      <td className="px-4 py-3 text-analog-text-muted">{b.segment?.name || '—'}</td>
                      <td className="px-4 py-3 text-center">{statusBadge(b.status)}</td>
                      <td className="px-4 py-3 text-right text-analog-text-muted">
                        {b.status === 'sent' || b.status === 'sending'
                          ? `${b.sent_count || 0} / ${b.recipient_count || 0}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-analog-text-muted text-xs">
                        {b.sent_at ? new Date(b.sent_at).toLocaleDateString() : new Date(b.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDelete(b.id)}
                          className="p-1.5 text-analog-text-muted hover:text-red-500 rounded"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCompose && (
        <BroadcastCompose
          onClose={() => setShowCompose(false)}
          onSent={() => { setShowCompose(false); load(); }}
        />
      )}
    </div>
  );
}
