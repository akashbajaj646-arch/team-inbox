'use client';

import { useState, useEffect, useRef } from 'react';
import type { User } from '@/types';
import ThreadView from './ThreadView';
import SmsThreadView from './SmsThreadView';

interface SearchResult {
  id: string;
  type: 'email' | 'sms' | 'whatsapp';
  inbox_id: string;
  inbox_name: string;
  subject: string;
  snippet: string;
  from: string | null;
  last_message_at: string;
  is_read: boolean;
}

type ActiveTab = 'all' | 'search';

interface AllInboxesViewProps {
  currentUser: User;
}

export default function AllInboxesView({ currentUser }: AllInboxesViewProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('all');
  const [query, setQuery] = useState('');
  const [allResults, setAllResults] = useState<SearchResult[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [searchField, setSearchField] = useState<'all'|'from'|'subject'|'body'>('all');
  const [searchMatch, setSearchMatch] = useState<'contains'|'exact'>('contains');
  const [advancedQuery, setAdvancedQuery] = useState('');

  // Load all threads on mount
  useEffect(() => {
    loadAllThreads();
  }, []);

  // Focus search input when switching to search tab
  useEffect(() => {
    if (activeTab === 'search') {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [activeTab]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query.trim());
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function loadAllThreads() {
    setLoadingAll(true);
    try {
      const response = await fetch('/api/search?mode=all');
      const data = await response.json();
      setAllResults(data.results || []);
    } catch (err) {
      console.error('Error loading threads:', err);
    }
    setLoadingAll(false);
  }

  async function performSearch(q: string) {
    setLoadingSearch(true);
    setHasSearched(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await response.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error('Search error:', err);
      setSearchResults([]);
    }
    setLoadingSearch(false);
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

  function getInboxBadgeColor(type: string) {
    switch (type) {
      case 'sms': return 'bg-blue-100 text-blue-700';
      case 'whatsapp': return 'bg-green-100 text-green-700';
      default: return 'bg-analog-accent/10 text-analog-accent';
    }
  }

  function getTypeIcon(type: string) {
    if (type === 'sms' || type === 'whatsapp') {
      return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      );
    }
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    );
  }

  const displayResults = activeTab === 'all' ? allResults : searchResults;
  const isLoading = activeTab === 'all' ? loadingAll : loadingSearch;

  // Group search results by inbox (only for search tab)
  const grouped = activeTab === 'search'
    ? searchResults.reduce<Record<string, SearchResult[]>>((acc, result) => {
        if (!acc[result.inbox_name]) acc[result.inbox_name] = [];
        acc[result.inbox_name].push(result);
        return acc;
      }, {})
    : {};

  function renderThreadRow(result: SearchResult) {
    return (
      <div
        key={result.id}
        onClick={() => setSelectedResult(result)}
        className={`cursor-pointer border-b border-analog-border transition-all duration-150 px-5 py-4 ${
          selectedResult?.id === result.id
            ? 'bg-analog-surface border-l-4 border-l-analog-accent'
            : 'hover:bg-analog-surface'
        }`}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className={`text-sm font-medium truncate flex-1 ${!result.is_read ? 'text-analog-text' : 'text-analog-text-secondary'}`}>
            {result.subject}
          </p>
          <span className="text-xs text-analog-text-placeholder whitespace-nowrap flex-shrink-0">
            {formatDate(result.last_message_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${getInboxBadgeColor(result.type)}`}>
            {getTypeIcon(result.type)}
            {result.inbox_name}
          </span>
          {result.from && (
            <p className="text-xs text-analog-text-muted truncate">{result.from}</p>
          )}
        </div>
        {result.snippet && (
          <p className="text-xs text-analog-text-faint line-clamp-1">{result.snippet}</p>
        )}
        {!result.is_read && (
          <span className="inline-block mt-1.5 badge badge-primary">New</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-screen overflow-hidden">
      {/* Left panel */}
      <div className="w-[360px] border-r-2 border-analog-border-strong flex flex-col h-screen bg-analog-surface-alt">
        {/* Header */}
        <div className="px-6 py-5 border-b-2 border-analog-border-strong bg-analog-surface">
          <h2 className="font-display text-lg font-medium text-analog-text mb-3">All Inboxes</h2>

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-analog-surface-alt rounded-lg border border-analog-border">
            <button
              onClick={() => setActiveTab('all')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-sm font-medium transition-all duration-150 ${
                activeTab === 'all'
                  ? 'bg-analog-surface text-analog-accent shadow-sm border border-analog-border'
                  : 'text-analog-text-muted hover:text-analog-text'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              All
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-sm font-medium transition-all duration-150 ${
                activeTab === 'search'
                  ? 'bg-analog-surface text-analog-accent shadow-sm border border-analog-border'
                  : 'text-analog-text-muted hover:text-analog-text'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search
            </button>
          </div>

          {/* Search input — only on search tab */}
                    {activeTab === 'search' && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-analog-text-faint pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search across all inboxes..."
                    className="input w-full pr-3 py-2"
                    style={{paddingLeft: '2.25rem'}}
                  />
                  {query && (
                    <button
                      onClick={() => { setQuery(''); setSearchResults([]); setHasSearched(false); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-analog-text-faint hover:text-analog-text"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex-shrink-0 ${
                    showAdvancedSearch
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
              {showAdvancedSearch && (
                <div className="rounded-xl border border-analog-border bg-analog-surface-alt p-3 space-y-2">
                  <div className="flex gap-1">
                    {(['contains', 'exact'] as const).map(m => (
                      <button key={m} onClick={() => setSearchMatch(m)}
                        className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-medium transition-colors ${searchMatch === m ? 'bg-analog-accent text-white' : 'border border-analog-border text-analog-text-faint hover:text-analog-text'}`}>
                        {m === 'contains' ? 'Contains' : 'Exact match'}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <select value={searchField} onChange={e => setSearchField(e.target.value as any)}
                      className="input text-xs py-1.5 w-full">
                      <option value="all">All fields</option>
                      <option value="from">From</option>
                      <option value="subject">Subject</option>
                      <option value="body">Body</option>
                    </select>
                    <input type="text" value={advancedQuery} onChange={e => setAdvancedQuery(e.target.value)}
                      placeholder="Additional filter..."
                      className="input text-xs py-1.5 flex-1" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Result count */}
          {activeTab === 'all' && !loadingAll && (
            <p className="text-xs text-analog-text-faint mt-2">{allResults.length} conversations across all inboxes</p>
          )}
          {activeTab === 'search' && hasSearched && !loadingSearch && (
            <p className="text-xs text-analog-text-faint mt-2">
              {searchResults.length === 0
                ? `No results for "${query}"`
                : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} across ${Object.keys(grouped).length} inbox${Object.keys(grouped).length !== 1 ? 'es' : ''}`}
            </p>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center text-analog-text-muted">
              <svg className="w-5 h-5 animate-spin mx-auto mb-2 text-analog-accent" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading...
            </div>
          ) : activeTab === 'all' ? (
            allResults.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-analog-text-muted">No conversations yet</p>
              </div>
            ) : (
              <div>{allResults.map(renderThreadRow)}</div>
            )
          ) : !hasSearched ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-surface flex items-center justify-center border-2 border-analog-border">
                <svg className="w-8 h-8 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <p className="text-analog-text-muted font-medium mb-1">Search everything</p>
              <p className="text-sm text-analog-text-faint">Search emails and SMS across all inboxes at once</p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-analog-text-muted font-medium">No results found</p>
              <p className="text-sm text-analog-text-faint mt-1">Try a different search term</p>
            </div>
          ) : (
            <div>
              {Object.entries(grouped).map(([inboxName, inboxResults]) => (
                <div key={inboxName}>
                  <div className="px-4 py-2 bg-analog-surface border-b border-analog-border sticky top-0 z-10">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getInboxBadgeColor(inboxResults[0].type)}`}>
                        {getTypeIcon(inboxResults[0].type)}
                        {inboxName}
                      </span>
                      <span className="text-xs text-analog-text-faint">{inboxResults.length} result{inboxResults.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  {inboxResults.map(renderThreadRow)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — thread view */}
      {selectedResult ? (
        selectedResult.type === 'email' ? (
          <ThreadView
            threadId={selectedResult.id}
            currentUser={currentUser}
          />
        ) : (
          <SmsThreadView
            threadId={selectedResult.id}
            inbox={{ id: selectedResult.inbox_id } as any}
            currentUser={currentUser}
          />
        )
      ) : (
        <div className="flex-1 flex items-center justify-center bg-analog-surface">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-analog-surface-alt flex items-center justify-center border-2 border-analog-border">
              <svg className="w-10 h-10 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-analog-text-muted font-medium">Select a conversation to view</p>
          </div>
        </div>
      )}
    </div>
  );
}
