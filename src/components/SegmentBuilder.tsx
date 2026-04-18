'use client';

import { useState, useEffect } from 'react';

interface Filter {
  id: string;
  field: string;
  operator: string;
  value: string;
  value2?: string;
}

interface SegmentBuilderProps {
  segment?: any;
  onClose: () => void;
  onSaved: () => void;
}

const FIELD_OPTIONS = [
  { value: 'last_invoice_date', label: 'Last purchased' },
  { value: 'total_spend', label: 'Total spend' },
  { value: 'total_invoices', label: 'Number of orders' },
  { value: 'outstanding_balance', label: 'Outstanding balance' },
  { value: 'categories_purchased', label: 'Category purchased' },
  { value: 'state', label: 'State' },
  { value: 'price_group', label: 'Price group' },
  { value: 'is_active', label: 'Active status' },
];

const OPERATORS: Record<string, { value: string; label: string }[]> = {
  last_invoice_date: [
    { value: 'within_days', label: 'Within last (days)' },
    { value: 'older_than_days', label: 'More than (days) ago' },
    { value: 'never', label: 'Never purchased' },
  ],
  total_spend: [
    { value: 'greater_than', label: 'Greater than' },
    { value: 'less_than', label: 'Less than' },
    { value: 'between', label: 'Between' },
  ],
  total_invoices: [
    { value: 'greater_than', label: 'Greater than' },
    { value: 'less_than', label: 'Less than' },
  ],
  outstanding_balance: [
    { value: 'has_balance', label: 'Has outstanding balance' },
    { value: 'no_balance', label: 'No balance' },
  ],
  categories_purchased: [
    { value: 'includes', label: 'Has purchased from' },
    { value: 'excludes', label: 'Has NOT purchased from' },
  ],
  state: [{ value: 'equals', label: 'Equals' }],
  price_group: [{ value: 'equals', label: 'Equals' }],
  is_active: [{ value: 'equals', label: 'Equals' }],
};

function uid() { return Math.random().toString(36).slice(2, 10); }

export default function SegmentBuilder({ segment, onClose, onSaved }: SegmentBuilderProps) {
  const [name, setName] = useState(segment?.name || '');
  const [description, setDescription] = useState(segment?.description || '');
  const [filters, setFilters] = useState<Filter[]>(
    segment?.filters?.length
      ? segment.filters.map((f: any) => ({ ...f, id: uid() }))
      : [{ id: uid(), field: 'last_invoice_date', operator: 'within_days', value: '30' }]
  );
  const [count, setCount] = useState(0);
  const [preview, setPreview] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => loadPreview(), 400);
    return () => clearTimeout(timer);
  }, [JSON.stringify(filters)]);

  async function loadPreview() {
    setLoading(true);
    const res = await fetch('/api/segments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: filters.filter(f => f.value || f.operator === 'never' || f.operator === 'has_balance' || f.operator === 'no_balance') }),
    });
    const data = await res.json();
    if (res.ok) {
      setCount(data.count);
      setPreview(data.preview);
    }
    setLoading(false);
  }

  function addFilter() {
    setFilters([...filters, { id: uid(), field: 'total_spend', operator: 'greater_than', value: '' }]);
  }

  function removeFilter(id: string) {
    setFilters(filters.filter(f => f.id !== id));
  }

  function updateFilter(id: string, patch: Partial<Filter>) {
    setFilters(filters.map(f => {
      if (f.id !== id) return f;
      const updated = { ...f, ...patch };
      // Reset operator if field changed
      if (patch.field && patch.field !== f.field) {
        updated.operator = OPERATORS[patch.field][0].value;
        updated.value = '';
      }
      return updated;
    }));
  }

  async function handleSave() {
    if (!name.trim()) { alert('Name required'); return; }
    setSaving(true);
    const method = segment?.id ? 'PATCH' : 'POST';
    const body = segment?.id
      ? { id: segment.id, name, description, filters: filters.filter(f => f.value || ['never', 'has_balance', 'no_balance'].includes(f.operator)) }
      : { name, description, filters: filters.filter(f => f.value || ['never', 'has_balance', 'no_balance'].includes(f.operator)) };
    const res = await fetch('/api/segments', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else alert('Failed to save segment');
  }

  const needsValue = (op: string) => !['never', 'has_balance', 'no_balance'].includes(op);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-analog-surface border-2 border-analog-border-strong rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-analog-border flex items-center justify-between">
          <h2 className="font-display text-lg font-medium">{segment?.id ? 'Edit Segment' : 'Create Segment'}</h2>
          <button onClick={onClose} className="p-1.5 text-analog-text-muted hover:text-analog-text">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. VIP customers - last 90 days" className="input w-full" autoFocus />
            </div>
            <div>
              <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block">Description</label>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" className="input w-full" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-2 block">Filters (all must match)</label>
            <div className="space-y-2">
              {filters.map(filter => (
                <div key={filter.id} className="flex gap-2 items-start">
                  <select value={filter.field} onChange={e => updateFilter(filter.id, { field: e.target.value })} className="input py-2 flex-1 text-sm">
                    {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <select value={filter.operator} onChange={e => updateFilter(filter.id, { operator: e.target.value, value: '' })} className="input py-2 flex-1 text-sm">
                    {OPERATORS[filter.field]?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {needsValue(filter.operator) && (
                    <input type="text" value={filter.value} onChange={e => updateFilter(filter.id, { value: e.target.value })} placeholder="Value" className="input py-2 flex-1 text-sm" />
                  )}
                  {filter.operator === 'between' && (
                    <input type="text" value={filter.value2 || ''} onChange={e => updateFilter(filter.id, { value2: e.target.value })} placeholder="Max" className="input py-2 flex-1 text-sm" />
                  )}
                  <button onClick={() => removeFilter(filter.id)} className="p-2 text-analog-text-muted hover:text-red-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <button onClick={addFilter} className="mt-2 text-sm text-analog-accent hover:underline flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add filter
            </button>
          </div>

          <div className="rounded-xl border border-analog-border bg-analog-surface-alt p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider">Preview</span>
              <span className="text-sm font-semibold text-analog-accent">{loading ? 'Loading...' : `${count.toLocaleString()} contacts`}</span>
            </div>
            {preview.length > 0 && (
              <div className="text-xs text-analog-text-muted space-y-1 max-h-32 overflow-y-auto">
                {preview.slice(0, 5).map((c, i) => (
                  <div key={i} className="truncate">• {c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()} — {c.email_1}</div>
                ))}
                {preview.length > 5 && <div className="text-analog-text-faint">and {count - 5} more...</div>}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-analog-border flex justify-end gap-3">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="btn btn-primary disabled:opacity-50">
            {saving ? 'Saving...' : (segment?.id ? 'Update Segment' : 'Save Segment')}
          </button>
        </div>
      </div>
    </div>
  );
}
