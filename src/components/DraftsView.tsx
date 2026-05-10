'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface DraftsViewProps {
  onSelectDraft: (draft: any) => void;
}

export default function DraftsView({ onSelectDraft }: DraftsViewProps) {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/drafts');
    const data = await res.json();
    setDrafts(data.drafts || []);
    setLoading(false);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this draft?')) return;
    await fetch(`/api/drafts?id=${id}`, { method: 'DELETE' });
    load();
  }

  function preview(html: string | null) {
    if (!html) return '(empty)';
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 120) || '(empty)';
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  }

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-analog-surface">
      <div className="px-8 py-5 border-b-2 border-analog-border-strong">
        <h2 className="font-display text-2xl font-medium text-analog-text">Drafts</h2>
        <p className="text-sm text-analog-text-muted mt-1">{drafts.length} draft{drafts.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-center text-analog-text-muted py-10">Loading...</p>
        ) : drafts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-analog-text-muted font-medium">No drafts</p>
            <p className="text-sm text-analog-text-faint mt-1">Drafts you save will appear here</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-4xl">
            {drafts.map(d => (
              <div
                key={d.id}
                onClick={() => onSelectDraft(d)}
                className="group flex items-start gap-4 p-4 bg-analog-surface-alt border border-analog-border rounded-lg hover:border-analog-accent cursor-pointer transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${d.draft_type === 'reply' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                      {d.draft_type === 'reply' ? 'Reply' : 'New'}
                    </span>
                    <p className="font-semibold text-sm text-analog-text truncate">
                      {d.draft_type === 'reply'
                        ? (d.thread?.subject || '(No subject)')
                        : (d.subject || '(No subject)')}
                    </p>
                  </div>
                  {d.draft_type === 'new' && d.to_address && (
                    <p className="text-xs text-analog-text-faint truncate">To: {d.to_address}</p>
                  )}
                  <p className="text-sm text-analog-text-muted truncate mt-1">{preview(d.body_html)}</p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className="text-xs text-analog-text-faint">{formatDate(d.updated_at)}</span>
                  <button
                    onClick={(e) => handleDelete(d.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-analog-text-muted hover:text-red-500 transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
