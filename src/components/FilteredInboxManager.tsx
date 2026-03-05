'use client';

import { useState, useEffect } from 'react';
import type { FilteredInbox, FilterRule, Inbox } from '@/types';

interface FilteredInboxManagerProps {
  inbox: Inbox;
  isAdmin: boolean;
  onUpdate: () => void;
}

const FIELD_OPTIONS = [
  { value: 'from', label: 'From address' },
  { value: 'subject', label: 'Subject' },
  { value: 'body', label: 'Body' },
];

const OPERATOR_OPTIONS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
];

export default function FilteredInboxManager({ inbox, isAdmin, onUpdate }: FilteredInboxManagerProps) {
  const [filteredInboxes, setFilteredInboxes] = useState<FilteredInbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<Record<string, number>>({});

  // Form state
  const [name, setName] = useState('');
  const [filterLogic, setFilterLogic] = useState<'any' | 'all'>('any');
  const [filters, setFilters] = useState<FilterRule[]>([
    { field: 'from', operator: 'contains', value: '' }
  ]);

  useEffect(() => {
    loadFilteredInboxes();
  }, [inbox.id]);

  async function loadFilteredInboxes() {
    setLoading(true);
    try {
      const response = await fetch(`/api/filtered-inboxes?inboxId=${inbox.id}`);
      const data = await response.json();
      if (response.ok) {
        setFilteredInboxes(data.filteredInboxes || []);
      }
    } catch (err) {
      console.error('Error loading filtered inboxes:', err);
    }
    setLoading(false);
  }

  function resetForm() {
    setName('');
    setFilterLogic('any');
    setFilters([{ field: 'from', operator: 'contains', value: '' }]);
    setEditingId(null);
    setShowForm(false);
    setError(null);
    setApplyToExisting(false);
  }

  function startEdit(fi: FilteredInbox) {
    setName(fi.name);
    setFilterLogic(fi.filter_logic);
    setFilters(fi.filters.length > 0 ? fi.filters : [{ field: 'from', operator: 'contains', value: '' }]);
    setEditingId(fi.id);
    setApplyToExisting(false);
    setShowForm(true);
  }

  function addFilter() {
    setFilters([...filters, { field: 'from', operator: 'contains', value: '' }]);
  }

  function removeFilter(index: number) {
    if (filters.length > 1) {
      setFilters(filters.filter((_, i) => i !== index));
    }
  }

  function updateFilter(index: number, updates: Partial<FilterRule>) {
    setFilters(filters.map((f, i) => i === index ? { ...f, ...updates } : f));
  }

  async function applyFilter(id: string) {
    setApplying(id);
    try {
      const response = await fetch('/api/filtered-inboxes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (response.ok) {
        setApplyResult(prev => ({ ...prev, [id]: data.applied }));
      }
    } catch (err) {
      console.error('Error applying filter:', err);
    }
    setApplying(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    const validFilters = filters.filter(f => f.value.trim());
    if (validFilters.length === 0) {
      setError('At least one filter with a value is required');
      return;
    }

    setSaving(true);

    try {
      const url = '/api/filtered-inboxes';
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId
        ? { id: editingId, name, filters: validFilters, filterLogic }
        : { inboxId: inbox.id, name, filters: validFilters, filterLogic };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const saved = await response.json();
        if (applyToExisting && saved.filteredInbox?.id) {
          await applyFilter(saved.filteredInbox.id);
        }
        resetForm();
        loadFilteredInboxes();
        onUpdate();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to save');
      }
    } catch (err) {
      setError('An error occurred');
    }

    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this filtered inbox?')) return;

    try {
      const response = await fetch(`/api/filtered-inboxes?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadFilteredInboxes();
        onUpdate();
      }
    } catch (err) {
      console.error('Error deleting:', err);
    }
  }

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="font-display text-lg font-medium text-analog-text">Filtered Inboxes</h3>
        {isAdmin && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="btn btn-secondary text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Filter
          </button>
        )}
      </div>

      <div className="card-body">
        {/* Form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="mb-6 p-4 bg-analog-surface-alt border border-analog-border rounded-lg">
            <h4 className="font-medium text-analog-text mb-4">
              {editingId ? 'Edit Filtered Inbox' : 'Create Filtered Inbox'}
            </h4>

            {error && (
              <div className="mb-4 p-3 bg-analog-error/10 border border-analog-error/20 rounded-lg text-sm text-analog-error">
                {error}
              </div>
            )}

            {/* Name */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-analog-text-muted mb-2">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., UPS Issues, Trade Shows"
                className="input w-full"
                required
              />
            </div>

            {/* Filter Logic */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-analog-text-muted mb-2">
                Match
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="filterLogic"
                    value="any"
                    checked={filterLogic === 'any'}
                    onChange={() => setFilterLogic('any')}
                    className="text-analog-accent"
                  />
                  <span className="text-sm text-analog-text">Any filter (OR)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="filterLogic"
                    value="all"
                    checked={filterLogic === 'all'}
                    onChange={() => setFilterLogic('all')}
                    className="text-analog-accent"
                  />
                  <span className="text-sm text-analog-text">All filters (AND)</span>
                </label>
              </div>
            </div>

            {/* Filters */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-analog-text-muted mb-2">
                Filters
              </label>
              <div className="space-y-4">
                {filters.map((filter, index) => (
                  <div key={index} className="p-3 bg-analog-surface border border-analog-border rounded-lg">
                    <div className="flex gap-2 mb-2">
                      <select
                        value={filter.field}
                        onChange={(e) => updateFilter(index, { field: e.target.value as FilterRule['field'] })}
                        className="input w-40"
                      >
                        {FIELD_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <select
                        value={filter.operator}
                        onChange={(e) => updateFilter(index, { operator: e.target.value as FilterRule['operator'] })}
                        className="input w-32"
                      >
                        {OPERATOR_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {filters.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeFilter(index)}
                          className="p-2 text-analog-text-muted hover:text-analog-error transition-colors ml-auto"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={filter.value}
                      onChange={(e) => updateFilter(index, { value: e.target.value })}
                      placeholder="Enter value to match..."
                      className="input w-full"
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addFilter}
                className="mt-2 text-sm text-analog-accent hover:underline"
              >
                + Add another filter
              </button>
            </div>

            {/* Apply to existing */}
            <div className="mb-4 p-3 bg-analog-surface border border-analog-border rounded-lg flex items-start gap-3">
              <input
                type="checkbox"
                id="applyToExisting"
                checked={applyToExisting}
                onChange={(e) => setApplyToExisting(e.target.checked)}
                className="mt-0.5"
              />
              <label htmlFor="applyToExisting" className="text-sm text-analog-text cursor-pointer">
                <span className="font-medium">Apply to existing emails</span>
                <span className="block text-analog-text-muted mt-0.5">
                  Emails matching this filter will be moved out of the main inbox and only appear here.
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary disabled:opacity-50"
              >
                {saving ? 'Saving...' : (editingId ? 'Update' : 'Create')}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* List */}
        {loading ? (
          <p className="text-analog-text-muted">Loading...</p>
        ) : filteredInboxes.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-analog-surface-alt flex items-center justify-center">
              <svg className="w-6 h-6 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </div>
            <p className="text-analog-text-muted mb-1">No filtered inboxes yet</p>
            <p className="text-sm text-analog-text-faint">
              Create filters to organize emails by sender, subject, or content
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredInboxes.map((fi) => (
              <div
                key={fi.id}
                className="flex items-center justify-between p-4 bg-analog-surface-alt border border-analog-border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-analog-secondary/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-analog-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-analog-text">{fi.name}</p>
                    <p className="text-xs text-analog-text-faint">
                      {fi.filters.length} filter{fi.filters.length !== 1 ? 's' : ''} • Match {fi.filter_logic === 'any' ? 'any' : 'all'}
                    </p>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    {applyResult[fi.id] !== undefined && (
                      <span className="text-xs text-analog-accent font-medium">
                        {applyResult[fi.id]} applied
                      </span>
                    )}
                    <button
                      onClick={() => applyFilter(fi.id)}
                      disabled={applying === fi.id}
                      className="p-2 text-analog-text-muted hover:text-analog-accent hover:bg-analog-hover rounded-lg transition-all duration-150 disabled:opacity-50"
                      title="Apply to existing emails"
                    >
                      {applying === fi.id ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => startEdit(fi)}
                      className="p-2 text-analog-text-muted hover:text-analog-accent hover:bg-analog-hover rounded-lg transition-all duration-150"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(fi.id)}
                      className="p-2 text-analog-text-muted hover:text-analog-error hover:bg-analog-error/10 rounded-lg transition-all duration-150"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
