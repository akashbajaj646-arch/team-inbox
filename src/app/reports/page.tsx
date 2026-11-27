'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Field = 'subject' | 'body' | 'from';
type Operator = 'contains' | 'equals' | 'starts_with' | 'ends_with';

interface Rule {
  field: Field;
  operator: Operator;
  value: string;
}

interface Inbox {
  id: string;
  name: string;
  email_address: string | null;
}

interface Report {
  id?: string;
  name: string;
  inbox_ids: string[];
  filters: Rule[];
  filter_logic: 'any' | 'all';
  min_opens: number | null;
  min_clicks: number | null;
  threshold_logic: 'any' | 'all';
  days_back: number | null;
  hide_replied: boolean;
}

interface Row {
  recipient: string;
  recipient_domain: string;
  emails_sent: number;
  views: number;
  clicks: number;
  first_sent_at: string;
  last_sent_at: string;
  last_viewed_at: string | null;
  last_clicked_at: string | null;
  latest_subject: string | null;
  latest_thread_id: string | null;
  top_link: string | null;
  top_link_clicks: number | null;
  has_replied: boolean;
}

type SortKey = 'recipient' | 'emails_sent' | 'views' | 'clicks' | 'last_activity' | 'last_sent_at';

const EMPTY_REPORT: Report = {
  name: '',
  inbox_ids: [],
  filters: [{ field: 'subject', operator: 'contains', value: '' }],
  filter_logic: 'all',
  min_opens: null,
  min_clicks: null,
  threshold_logic: 'any',
  days_back: null,
  hide_replied: false,
};

const FIELD_LABELS: Record<Field, string> = { subject: 'Subject', body: 'Body', from: 'From' };
const OPERATOR_LABELS: Record<Operator, string> = {
  contains: 'contains',
  equals: 'equals',
  starts_with: 'starts with',
  ends_with: 'ends with',
};

const INPUT =
  'px-3 py-2 rounded-lg bg-analog-surface border border-analog-border text-analog-text text-sm focus:outline-none focus:border-analog-accent';

function lastActivity(r: Row): string | null {
  const a = r.last_viewed_at ? new Date(r.last_viewed_at).getTime() : 0;
  const b = r.last_clicked_at ? new Date(r.last_clicked_at).getTime() : 0;
  const max = Math.max(a, b);
  return max ? new Date(max).toISOString() : null;
}

function fmtDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function toNum(v: string): number | null {
  if (v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function csvCell(v: any) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [draft, setDraft] = useState<Report>(EMPTY_REPORT);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports() {
    const res = await fetch('/api/reports');
    if (res.status === 401) {
      router.push('/login');
      return;
    }
    const data = await res.json();
    setReports(data.reports || []);
    setInboxes(data.inboxes || []);
    setLoading(false);
  }

  async function runReport(def: Report = draft) {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(def),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Report failed');
      setRows(data.rows || []);
    } catch (err: any) {
      setError(err.message);
    }
    setRunning(false);
  }

  async function saveReport(asNew: boolean) {
    if (!draft.name.trim()) {
      setError('Give the report a name before saving');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isUpdate = !!draft.id && !asNew;
      const res = await fetch(isUpdate ? `/api/reports/${draft.id}` : '/api/reports', {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setDraft(normalize(data.report));
      await loadReports();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function deleteReport() {
    if (!draft.id) return;
    if (!confirm(`Delete the report "${draft.name}"?`)) return;
    await fetch(`/api/reports/${draft.id}`, { method: 'DELETE' });
    setDraft(EMPTY_REPORT);
    setRows(null);
    await loadReports();
  }

  function normalize(r: any): Report {
    return {
      ...EMPTY_REPORT,
      ...r,
      filters: r?.filters?.length ? r.filters : EMPTY_REPORT.filters,
      inbox_ids: r?.inbox_ids || [],
    };
  }

  function openReport(r: Report) {
    const def = normalize(r);
    setDraft(def);
    runReport(def);
  }

  function newReport() {
    setDraft(EMPTY_REPORT);
    setRows(null);
    setError(null);
  }

  function updateRule(i: number, patch: Partial<Rule>) {
    setDraft({ ...draft, filters: draft.filters.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  }

  function toggleInbox(id: string) {
    const has = draft.inbox_ids.includes(id);
    setDraft({ ...draft, inbox_ids: has ? draft.inbox_ids.filter((x) => x !== id) : [...draft.inbox_ids, id] });
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else {
      setSortKey(key);
      setSortDir(key === 'recipient' ? 'asc' : 'desc');
    }
  }

  const sortedRows = useMemo(() => {
    if (!rows) return [];
    const val = (r: Row): any => {
      if (sortKey === 'recipient') return r.recipient;
      if (sortKey === 'last_activity') return lastActivity(r) || '';
      if (sortKey === 'last_sent_at') return r.last_sent_at || '';
      return Number(r[sortKey]) || 0;
    };
    const out = [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  function exportCsv() {
    if (!sortedRows.length) return;
    const header = ['Recipient', 'Domain', 'Emails sent', 'Views', 'Clicks', 'Last activity', 'Last sent', 'Latest subject', 'Top link', 'Top link clicks', 'Replied'];
    const lines = sortedRows.map((r) =>
      [r.recipient, r.recipient_domain, r.emails_sent, r.views, r.clicks, lastActivity(r) || '', r.last_sent_at, r.latest_subject, r.top_link, r.top_link_clicks, r.has_replied ? 'Yes' : 'No']
        .map(csvCell)
        .join(',')
    );
    const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(draft.name || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const SortHeader = ({ label, k, right }: { label: string; k: SortKey; right?: boolean }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-2 font-semibold cursor-pointer select-none whitespace-nowrap hover:text-analog-text ${right ? 'text-right' : 'text-left'}`}
    >
      {label}
      {sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-texture">
        <div className="text-analog-text-muted font-medium">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-texture">
      {/* Header */}
      <div className="bg-analog-surface border-b-2 border-analog-border-strong">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center gap-4">
          <button
            onClick={() => router.push('/')}
            className="p-2 text-analog-text-muted hover:text-analog-text hover:bg-analog-hover rounded-lg transition-all duration-150"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="font-display text-xl font-medium text-analog-text">Reports</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 flex gap-8">
        {/* Saved reports */}
        <div className="w-60 flex-shrink-0 space-y-2">
          <button onClick={newReport} className="btn btn-primary w-full">
            New report
          </button>
          <div className="text-[11px] uppercase tracking-wider text-analog-text-faint font-semibold pt-4 px-2">
            Saved reports
          </div>
          {reports.length === 0 && <div className="px-2 text-sm text-analog-text-muted">None yet</div>}
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => openReport(r)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all duration-150 border ${
                draft.id === r.id
                  ? 'bg-analog-surface border-analog-accent text-analog-text'
                  : 'border-transparent text-analog-text-muted hover:bg-analog-surface-alt hover:border-analog-border'
              }`}
            >
              {r.name}
            </button>
          ))}
        </div>

        {/* Builder + results */}
        <div className="flex-1 min-w-0 space-y-6">
          <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl p-6 space-y-5">
            <input
              className={`${INPUT} w-full text-base font-medium`}
              placeholder="Report name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />

            {/* Inboxes */}
            {inboxes.length > 1 && (
              <div>
                <div className="text-sm font-semibold text-analog-text mb-2">
                  Inboxes <span className="font-normal text-analog-text-faint">(none checked = all)</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {inboxes.map((i) => (
                    <label key={i.id} className="flex items-center gap-2 text-sm text-analog-text-muted cursor-pointer">
                      <input type="checkbox" checked={draft.inbox_ids.includes(i.id)} onChange={() => toggleInbox(i.id)} />
                      {i.name || i.email_address}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Rules */}
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-analog-text mb-2">
                Emails where
                <select
                  className={INPUT}
                  value={draft.filter_logic}
                  onChange={(e) => setDraft({ ...draft, filter_logic: e.target.value as 'any' | 'all' })}
                >
                  <option value="all">all rules match</option>
                  <option value="any">any rule matches</option>
                </select>
              </div>
              <div className="space-y-2">
                {draft.filters.map((rule, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select className={INPUT} value={rule.field} onChange={(e) => updateRule(i, { field: e.target.value as Field })}>
                      {(Object.keys(FIELD_LABELS) as Field[]).map((f) => (
                        <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                      ))}
                    </select>
                    <select className={INPUT} value={rule.operator} onChange={(e) => updateRule(i, { operator: e.target.value as Operator })}>
                      {(Object.keys(OPERATOR_LABELS) as Operator[]).map((o) => (
                        <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>
                      ))}
                    </select>
                    <input
                      className={`${INPUT} flex-1`}
                      placeholder={rule.field === 'from' ? 'akash@advanceapparels.com' : 'Text to match'}
                      value={rule.value}
                      onChange={(e) => updateRule(i, { value: e.target.value })}
                    />
                    <button
                      onClick={() => setDraft({ ...draft, filters: draft.filters.filter((_, idx) => idx !== i) })}
                      className="p-2 text-analog-text-faint hover:text-analog-error"
                      title="Remove rule"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setDraft({ ...draft, filters: [...draft.filters, { field: 'subject', operator: 'contains', value: '' }] })}
                  className="text-sm text-analog-accent hover:underline font-medium"
                >
                  + Add rule
                </button>
              </div>
            </div>

            {/* Thresholds */}
            <div className="flex flex-wrap items-center gap-3 text-sm text-analog-text">
              <span className="font-semibold">Show recipients with at least</span>
              <input
                type="number"
                min={0}
                className={`${INPUT} w-20`}
                placeholder="0"
                value={draft.min_opens ?? ''}
                onChange={(e) => setDraft({ ...draft, min_opens: toNum(e.target.value) })}
              />
              <span>views</span>
              <select
                className={INPUT}
                value={draft.threshold_logic}
                onChange={(e) => setDraft({ ...draft, threshold_logic: e.target.value as 'any' | 'all' })}
              >
                <option value="any">or</option>
                <option value="all">and</option>
              </select>
              <input
                type="number"
                min={0}
                className={`${INPUT} w-20`}
                placeholder="0"
                value={draft.min_clicks ?? ''}
                onChange={(e) => setDraft({ ...draft, min_clicks: toNum(e.target.value) })}
              />
              <span>clicks</span>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-sm text-analog-text">
              <label className="flex items-center gap-2">
                Sent in the last
                <input
                  type="number"
                  min={1}
                  className={`${INPUT} w-20`}
                  placeholder="All"
                  value={draft.days_back ?? ''}
                  onChange={(e) => setDraft({ ...draft, days_back: toNum(e.target.value) })}
                />
                days
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.hide_replied}
                  onChange={(e) => setDraft({ ...draft, hide_replied: e.target.checked })}
                />
                Hide recipients who replied
              </label>
            </div>

            {error && <div className="text-sm text-analog-error">{error}</div>}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button onClick={() => runReport()} disabled={running} className="btn btn-primary">
                {running ? 'Running...' : 'Run report'}
              </button>
              <button onClick={() => saveReport(false)} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium border border-analog-border-strong text-analog-text hover:bg-analog-surface-alt transition-all duration-150">
                {saving ? 'Saving...' : draft.id ? 'Save changes' : 'Save report'}
              </button>
              {draft.id && (
                <>
                  <button onClick={() => saveReport(true)} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium border border-analog-border-strong text-analog-text hover:bg-analog-surface-alt transition-all duration-150">
                    Save as new
                  </button>
                  <button onClick={deleteReport} className="text-sm text-analog-error hover:underline ml-auto">
                    Delete report
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Results */}
          {rows && (
            <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl overflow-hidden">
              <div className="px-6 py-4 flex items-center justify-between border-b border-analog-border">
                <div className="text-sm font-semibold text-analog-text">
                  {rows.length} {rows.length === 1 ? 'recipient' : 'recipients'}
                </div>
                <button onClick={exportCsv} disabled={!rows.length} className="text-sm text-analog-accent hover:underline font-medium">
                  Export CSV
                </button>
              </div>
              {rows.length === 0 ? (
                <div className="p-8 text-center text-analog-text-muted text-sm">No recipients match this report.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-analog-text-muted bg-analog-surface-alt">
                      <tr>
                        <SortHeader label="Recipient" k="recipient" />
                        <SortHeader label="Emails" k="emails_sent" right />
                        <SortHeader label="Views" k="views" right />
                        <SortHeader label="Clicks" k="clicks" right />
                        <SortHeader label="Last activity" k="last_activity" />
                        <th className="px-3 py-2 text-left font-semibold">Latest subject</th>
                        <th className="px-3 py-2 text-left font-semibold">Top link</th>
                        <th className="px-3 py-2 text-left font-semibold">Replied</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((r) => (
                        <tr
                          key={r.recipient}
                          onClick={() => r.latest_thread_id && window.open(`/email/${r.latest_thread_id}`, '_blank')}
                          className="border-t border-analog-border hover:bg-analog-surface-alt cursor-pointer text-analog-text"
                        >
                          <td className="px-3 py-2.5">
                            <div className="font-medium">{r.recipient}</div>
                            <div className="text-xs text-analog-text-faint">{r.recipient_domain}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right">{r.emails_sent}</td>
                          <td className="px-3 py-2.5 text-right">{r.views}</td>
                          <td className="px-3 py-2.5 text-right font-semibold">{r.clicks}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-analog-text-muted">{fmtDate(lastActivity(r))}</td>
                          <td className="px-3 py-2.5 max-w-[220px] truncate text-analog-text-muted">{r.latest_subject}</td>
                          <td className="px-3 py-2.5 max-w-[220px] truncate text-analog-text-muted" title={r.top_link || ''}>
                            {r.top_link ? `${r.top_link.replace(/^https?:\/\//, '')} (${r.top_link_clicks})` : ''}
                          </td>
                          <td className="px-3 py-2.5">{r.has_replied ? 'Yes' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
