'use client';

import { useState } from 'react';

export type SearchField = 'all' | 'from' | 'to' | 'subject' | 'body';
export type SearchMatch = 'contains' | 'exact';
export type FilterLogic = 'and' | 'or';

export interface SearchFilter {
  id: string;
  field: SearchField;
  query: string;
}

export interface SearchConfig {
  filters: SearchFilter[];
  match: SearchMatch;
  logic: FilterLogic;
}

function uid() { return Math.random().toString(36).slice(2, 8); }

export function emptyFilter(field: SearchField = 'all'): SearchFilter {
  return { id: uid(), field, query: '' };
}

export function defaultConfig(): SearchConfig {
  return { filters: [emptyFilter()], match: 'contains', logic: 'and' };
}

export function hasActiveSearch(config: SearchConfig): boolean {
  return config.filters.some(f => f.query.trim().length > 0);
}

const FIELD_LABELS: Record<SearchField, string> = {
  all: 'All fields', from: 'From', to: 'To', subject: 'Subject', body: 'Body',
};

const FIELD_PLACEHOLDERS: Record<SearchField, string> = {
  all: 'Search emails...', from: 'e.g. john@example.com',
  to: 'e.g. support@company.com', subject: 'e.g. Order confirmation',
  body: 'e.g. tracking number',
};

interface Props {
  config: SearchConfig;
  onChange: (config: SearchConfig) => void;
  resultCount?: number;
  searching?: boolean;
}

export default function AdvancedSearchPanel({ config, onChange, resultCount, searching }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // The first filter's query is the main search input
  const mainQuery = config.filters[0]?.query || '';

  function setMainQuery(q: string) {
    const first = config.filters[0];
    onChange({
      ...config,
      filters: [{ ...first, query: q }, ...config.filters.slice(1)],
    });
  }

  function updateFilter(id: string, patch: Partial<SearchFilter>) {
    onChange({ ...config, filters: config.filters.map(f => f.id === id ? { ...f, ...patch } : f) });
  }

  function addFilter() {
    if (config.filters.length >= 3) return;
    onChange({ ...config, filters: [...config.filters, emptyFilter()] });
  }

  function removeFilter(id: string) {
    const next = config.filters.filter(f => f.id !== id);
    onChange({ ...config, filters: next.length ? next : [emptyFilter()] });
  }

  const isDefault = !hasActiveSearch(config) && config.match === 'contains' && config.logic === 'and';

  return (
    <div className="space-y-2">
      {/* Main search row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-analog-text-faint pointer-events-none" style={{zIndex:1}} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={mainQuery}
            onChange={e => setMainQuery(e.target.value)}
            placeholder={FIELD_PLACEHOLDERS[config.filters[0]?.field || 'all']}
            className="input w-full pr-3 py-2 text-sm" style={{paddingLeft: "2.25rem"}}
            autoFocus
          />
          {mainQuery && (
            <button
              onClick={() => setMainQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-analog-text-faint hover:text-analog-text"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex-shrink-0 ${
            showAdvanced
              ? 'bg-analog-accent text-white border-analog-accent'
              : 'border-analog-border text-analog-text-muted hover:text-analog-text hover:border-analog-accent'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filters
        </button>
      </div>

      {/* Status row */}
      {hasActiveSearch(config) && (
        <div className="flex items-center justify-between text-xs text-analog-text-faint px-1">
          <span>{searching ? 'Searching...' : `${resultCount ?? 0} result${resultCount !== 1 ? 's' : ''}`}</span>
          {!isDefault && (
            <button onClick={() => onChange(defaultConfig())} className="text-analog-accent hover:underline">Clear</button>
          )}
        </div>
      )}

      {/* Advanced panel */}
      {showAdvanced && (
        <div className="rounded-xl border border-analog-border bg-analog-surface-alt p-3 space-y-3">
          {/* Match type */}
          <div className="flex gap-1">
            {(['contains', 'exact'] as SearchMatch[]).map(m => (
              <button
                key={m}
                onClick={() => onChange({ ...config, match: m })}
                className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-medium transition-colors ${
                  config.match === m
                    ? 'bg-analog-accent text-white'
                    : 'border border-analog-border text-analog-text-faint hover:text-analog-text'
                }`}
              >
                {m === 'contains' ? 'Contains' : 'Exact match'}
              </button>
            ))}
          </div>

          {/* Filter rows */}
          <div className="space-y-2">
            {config.filters.map((filter, idx) => (
              <div key={filter.id}>
                {idx > 0 && (
                  <div className="flex items-center gap-2 my-2">
                    <div className="flex-1 h-px bg-analog-border" />
                    <div className="flex gap-1">
                      {(['and', 'or'] as FilterLogic[]).map(l => (
                        <button
                          key={l}
                          onClick={() => onChange({ ...config, logic: l })}
                          className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${
                            config.logic === l
                              ? 'bg-analog-accent text-white'
                              : 'border border-analog-border text-analog-text-faint hover:text-analog-text'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 h-px bg-analog-border" />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <select
                    value={filter.field}
                    onChange={e => updateFilter(filter.id, { field: e.target.value as SearchField })}
                    className="input text-xs py-1.5 w-full"
                  >
                    {Object.entries(FIELD_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={filter.query}
                    onChange={e => updateFilter(filter.id, { query: e.target.value })}
                    placeholder={FIELD_PLACEHOLDERS[filter.field]}
                    className="input text-xs py-1.5 flex-1"
                  />
                  {config.filters.length > 1 && (
                    <button
                      onClick={() => removeFilter(filter.id)}
                      className="p-1.5 text-analog-text-faint hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {config.filters.length < 3 && (
            <button onClick={addFilter} className="text-xs text-analog-accent hover:underline flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
