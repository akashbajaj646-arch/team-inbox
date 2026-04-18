'use client';

import { useState, useEffect } from 'react';
import SegmentBuilder from './SegmentBuilder';
import SegmentViewModal from './SegmentViewModal';

export default function SegmentsManager() {
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [viewing, setViewing] = useState<any>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/segments');
    const data = await res.json();
    setSegments(data.segments || []);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this segment?')) return;
    await fetch(`/api/segments?id=${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl overflow-hidden">
      <div className="px-6 py-5 border-b-2 border-analog-border-strong flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-medium text-analog-text">Segments</h2>
          <p className="text-sm text-analog-text-faint mt-0.5">Saved customer filters for broadcasts</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowBuilder(true); }}
          className="btn btn-primary text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Segment
        </button>
      </div>

      <div className="p-6">
        {loading ? (
          <p className="text-analog-text-muted text-center py-8">Loading...</p>
        ) : segments.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-analog-text-muted font-medium mb-1">No segments yet</p>
            <p className="text-sm text-analog-text-faint">Create your first segment to target customers for broadcasts</p>
          </div>
        ) : (
          <div className="space-y-2">
            {segments.map(seg => (
              <div key={seg.id} className="flex items-center justify-between p-4 bg-analog-surface-alt border border-analog-border rounded-lg hover:border-analog-accent transition-colors">
                <div className="flex-1">
                  <p className="font-medium text-analog-text">{seg.name}</p>
                  {seg.description && <p className="text-sm text-analog-text-muted mt-0.5">{seg.description}</p>}
                  <p className="text-xs text-analog-text-faint mt-1">
                    {(seg.filters || []).length} filter{(seg.filters || []).length !== 1 ? 's' : ''}
                    {seg.created_by_user?.name && ` • Created by ${seg.created_by_user.name}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setViewing(seg)}
                    className="p-2 text-analog-text-muted hover:text-analog-accent hover:bg-analog-hover rounded-lg"
                    title="View contacts"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => { setEditing(seg); setShowBuilder(true); }}
                    className="p-2 text-analog-text-muted hover:text-analog-accent hover:bg-analog-hover rounded-lg"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(seg.id)}
                    className="p-2 text-analog-text-muted hover:text-red-500 hover:bg-analog-hover rounded-lg"
                    title="Delete"
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

      {showBuilder && (
        <SegmentBuilder
          segment={editing}
          onClose={() => setShowBuilder(false)}
          onSaved={() => { setShowBuilder(false); load(); }}
        />
      )}

      {viewing && (
        <SegmentViewModal
          segment={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
