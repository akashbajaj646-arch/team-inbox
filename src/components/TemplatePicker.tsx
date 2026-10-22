'use client';

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import type { Template } from '@/types';

interface TemplatePickerProps {
  inboxId: string;
  onSelect: (template: Template) => void;
  /** 'icon' renders a small round icon button (used in the reply toolbar). */
  variant?: 'button' | 'icon';
}

const PANEL_W = 640;
const PANEL_H = 420;

function plain(body: string): string {
  return body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/**
 * Template picker. The panel renders in a portal on top of everything, so it is
 * never clipped by the compose window, and shows a full preview of the
 * highlighted template. Arrow keys move, Enter inserts, Esc closes.
 */
export default function TemplatePicker({ inboxId, onSelect, variant = 'button' }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; height: number }>({ left: 0, top: 0, width: PANEL_W, height: PANEL_H });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('templates')
        .select('*')
        .order('category', { ascending: true })
        .order('name', { ascending: true });
      setTemplates(data || []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxId]);

  // Place the panel next to the button, kept fully inside the window
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const place = () => {
      const r = buttonRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(PANEL_W, vw - 24);
      const height = Math.min(PANEL_H, vh - 24);
      const left = Math.max(12, Math.min(r.left, vw - width - 12));
      const above = r.top - height - 8;
      const top = above >= 12 ? above : Math.max(12, Math.min(r.bottom + 8, vh - height - 12));
      setPos({ left, top, width, height });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const q = search.toLowerCase();
  const filtered = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
  );
  // Order by category so arrow keys follow what is on screen
  const ordered = [...filtered].sort((a, b) => (a.category || 'Uncategorized').localeCompare(b.category || 'Uncategorized'));
  const current = ordered[Math.min(active, ordered.length - 1)];

  useEffect(() => { setActive(0); }, [search]);

  function choose(t: Template) {
    onSelect(t);
    setIsOpen(false);
    setSearch('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, ordered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (current) choose(current); }
    else if (e.key === 'Escape') { e.preventDefault(); setIsOpen(false); }
  }

  useEffect(() => {
    panelRef.current?.querySelector(`[data-tpl-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (loading || templates.length === 0) return null;

  let lastCategory = '';
  const panel = isOpen ? (
    <div
      ref={panelRef}
      onKeyDown={onKeyDown}
      className="fixed z-[200] bg-white border border-[#dadce0] rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style={{ left: pos.left, top: pos.top, width: pos.width, height: pos.height }}
    >
      <div className="p-2.5 border-b border-[#e8eaed]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="w-full h-9 px-3 rounded-lg bg-[#f1f3f4] text-sm text-[#202124] placeholder-[#5f6368] focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#1a73e8]"
          autoFocus
        />
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-[42%] min-w-[200px] border-r border-[#e8eaed] overflow-y-auto py-1">
          {ordered.length === 0 && <div className="text-center py-8 text-sm text-[#5f6368]">No templates found</div>}
          {ordered.map((t, i) => {
            const cat = t.category || 'Uncategorized';
            const header = cat !== lastCategory;
            lastCategory = cat;
            return (
              <div key={t.id}>
                {header && <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-[#5f6368] uppercase tracking-wider">{cat}</div>}
                <button
                  data-tpl-index={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(t)}
                  className={`w-full text-left px-3 py-2 text-sm truncate ${i === active ? 'bg-[#e8f0fe] text-[#0b57d0]' : 'text-[#202124] hover:bg-[#f1f3f4]'}`}
                >
                  {t.name}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          {current ? (
            <>
              <div className="px-4 pt-3 pb-2 border-b border-[#f1f3f4]">
                <div className="text-sm font-medium text-[#202124] truncate">{current.name}</div>
                {current.subject && <div className="text-xs text-[#5f6368] truncate">Subject: {current.subject}</div>}
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed text-[#3c4043] whitespace-pre-wrap">
                {plain(current.body)}
              </div>
              <div className="px-4 py-2.5 border-t border-[#f1f3f4] flex items-center justify-between">
                <span className="text-[11px] text-[#5f6368]">↑↓ to browse · Enter to insert</span>
                <button onClick={() => choose(current)} className="h-8 px-4 rounded-full bg-[#0b57d0] text-white text-sm font-medium hover:bg-[#0a4ebb]">
                  Insert
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1" />
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          ref={buttonRef}
          onClick={() => setIsOpen((o) => !o)}
          title="Insert template"
          className={`p-2 rounded-full transition-colors ${isOpen ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]'}`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6M8 13h8M8 17h5" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          ref={buttonRef}
          onClick={() => setIsOpen((o) => !o)}
          className={`flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-medium transition-colors ${isOpen ? 'bg-[#e8f0fe] text-[#0b57d0]' : 'text-[#444746] hover:bg-[#f1f3f4]'}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6M8 13h8M8 17h5" />
          </svg>
          Templates
        </button>
      )}
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  );
}
