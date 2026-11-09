'use client';

import { useState, useRef, useEffect } from 'react';

type Mode = 'email' | 'phone';

interface Option {
  key: string;
  value: string; // email address or phone number
  name: string;
  company: string | null;
}

interface Props {
  mode: Mode;
  value: string; // comma separated list of addresses / numbers
  onChange: (value: string) => void;
  multiple?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

// Remember display names for picked addresses across instances (To, Cc, reopened compose)
const labelCache: Map<string, string> = new Map();

function splitTokens(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

export default function ContactAutocomplete({
  mode, value, onChange, multiple = false, placeholder, autoFocus, className,
}: Props) {
  const [chips, setChips] = useState<string[]>(() => splitTokens(value));
  const [text, setText] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const lastEmitted = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  // Sync when the value is changed from outside (e.g. a resumed draft loads)
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setChips(splitTokens(value));
      setText('');
    }
  }, [value]);

  function emit(nextChips: string[], nextText: string) {
    const v = [...nextChips, nextText.trim()].filter(Boolean).join(', ');
    lastEmitted.current = v;
    onChange(v);
  }

  // Debounced contact search
  useEffect(() => {
    const q = text.trim().replace(/[,()]/g, '');
    if (q.length < 2) { setOptions([]); setOpen(false); return; }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts/suggest?mode=${mode}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (id !== reqId.current) return;
        const list: Option[] = ((data.results || []) as Option[]).filter(o => !chips.includes(o.value));
        setOptions(list.slice(0, 8));
        setActive(0);
        setOpen(list.length > 0);
      } catch {
        if (id === reqId.current) { setOptions([]); setOpen(false); }
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, mode]);

  function addChip(v: string, label?: string) {
    const clean = v.trim();
    if (!clean) return;
    if (label) labelCache.set(clean.toLowerCase(), label);
    const next = multiple ? (chips.includes(clean) ? chips : [...chips, clean]) : [clean];
    setChips(next);
    setText('');
    setOpen(false);
    setOptions([]);
    emit(next, '');
    inputRef.current?.focus();
  }

  function removeChip(i: number) {
    const next = chips.filter((_, idx) => idx !== i);
    setChips(next);
    emit(next, text);
    inputRef.current?.focus();
  }

  function pick(o: Option) {
    const label = o.name ? (o.company && o.company !== o.name ? `${o.name} · ${o.company}` : o.name) : (o.company || '');
    addChip(o.value, label || undefined);
  }

  function handleText(v: string) {
    // Typing or pasting a comma commits everything before it
    if (v.includes(',')) {
      const parts = v.split(',');
      const tail = parts.pop() || '';
      let next = [...chips];
      for (const p of parts.map(s => s.trim()).filter(Boolean)) {
        next = multiple ? (next.includes(p) ? next : [...next, p]) : [p];
      }
      setChips(next);
      setText(tail);
      emit(next, tail);
      return;
    }
    if (!multiple && chips.length > 0) {
      // Single mode: typing replaces the existing value
      setChips([]);
      setText(v);
      emit([], v);
      return;
    }
    setText(v);
    emit(chips, v);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && options.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % options.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + options.length) % options.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(options[active]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    }
    if (e.key === 'Enter' && text.trim()) { e.preventDefault(); addChip(text); return; }
    if (e.key === 'Backspace' && !text && chips.length > 0) {
      e.preventDefault();
      removeChip(chips.length - 1);
    }
  }

  function onBlur() {
    // Delay so a mouse click on an option still registers
    setTimeout(() => {
      setOpen(false);
      if (text.trim()) addChip(text);
    }, 150);
  }

  return (
    <div className={`relative flex-1 ${className || ''}`}>
      <div className="flex flex-wrap items-center gap-1.5" onClick={() => inputRef.current?.focus()}>
        {chips.map((c, i) => {
          const label = labelCache.get(c.toLowerCase());
          return (
            <span
              key={`${c}-${i}`}
              title={c}
              className="inline-flex items-center gap-1 rounded-full bg-analog-surface border border-analog-border px-2 py-0.5 text-xs text-analog-text max-w-[260px]"
            >
              <span className="truncate">{label || c}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); removeChip(i); }}
                className="text-analog-text-faint hover:text-analog-accent"
                aria-label={`Remove ${c}`}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => handleText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onFocus={() => { if (options.length > 0) setOpen(true); }}
          placeholder={chips.length === 0 ? placeholder : ''}
          autoFocus={autoFocus}
          autoComplete="off"
          className="flex-1 min-w-[120px] bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none"
        />
      </div>

      {open && options.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-72 overflow-y-auto rounded-lg border border-analog-border bg-analog-surface shadow-lg">
          {options.map((o, i) => (
            <button
              key={o.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              onMouseEnter={() => setActive(i)}
              className={`block w-full text-left px-3 py-2 ${i === active ? 'bg-analog-border/40' : ''}`}
            >
              <div className="text-sm text-analog-text truncate">
                {o.name || o.company || o.value}
                {o.name && o.company && o.company !== o.name && (
                  <span className="text-analog-text-faint"> · {o.company}</span>
                )}
              </div>
              <div className="text-xs text-analog-text-faint truncate">{o.value}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
