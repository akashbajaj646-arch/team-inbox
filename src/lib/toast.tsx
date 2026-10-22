'use client';

import { useEffect, useState } from 'react';

/*
 * Tiny global toast store. Lives at module level so a pending action
 * (like an undoable send) keeps running when the component that started
 * it unmounts, e.g. when the user switches threads.
 */

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'error';
  /** Pinned toasts (pending sends) are never pushed off screen by newer ones. */
  pinned?: boolean;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: Toast[]) => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
/** Pending undoable actions that must not be lost if the page unloads. */
const pendingOnUnload = new Map<number, () => boolean>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    let unhandled = false;
    pendingOnUnload.forEach((handle) => { if (!handle()) unhandled = true; });
    if (unhandled) {
      // Ask the browser to confirm leaving; the content is already saved as a draft
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function push(t: Toast) {
  const pinned = toasts.filter((x) => x.pinned);
  const rest = toasts.filter((x) => !x.pinned);
  toasts = [...pinned, ...rest.slice(-Math.max(0, 2 - pinned.length)), t];
}

function emit() {
  listeners.forEach((l) => l([...toasts]));
}

export function dismissToast(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}

export function showToast(opts: Omit<Toast, 'id'> & { duration?: number }): number {
  const id = nextId++;
  const { duration = 5000, ...rest } = opts;
  push({ id, ...rest });
  emit();
  timers.set(id, setTimeout(() => dismissToast(id), duration));
  return id;
}

/**
 * Show "message · Undo". `run` fires after `delayMs` unless the user clicks Undo,
 * in which case `onUndo` fires instead. Used for undo-send.
 */
export function runWithUndo(opts: {
  message: string;
  delayMs?: number;
  run: () => void | Promise<void>;
  onUndo: () => void;
  /**
   * Called if the page is closing before `run` fired. Return true if it was
   * handled (e.g. sent with fetch keepalive); false makes the browser ask first.
   */
  onUnload?: () => boolean;
}) {
  const { delayMs = 5000 } = opts;
  let done = false;
  const id = nextId++;
  const finish = () => { done = true; pendingOnUnload.delete(id); dismissToast(id); };
  const fire = () => {
    if (done) return;
    finish();
    void opts.run();
  };
  if (opts.onUnload) {
    const onUnload = opts.onUnload;
    pendingOnUnload.set(id, () => {
      if (done) return true;
      const handled = onUnload();
      if (handled) finish();
      return handled;
    });
  }
  push({
    id,
    pinned: true,
    message: opts.message,
    actionLabel: 'Undo',
    onAction: () => {
      if (done) return;
      finish();
      opts.onUndo();
    },
  });
  emit();
  timers.set(id, setTimeout(fire, delayMs));
}

/**
 * Do the action now and offer an Undo that reverses it.
 */
export function doWithUndo(opts: { message: string; undo: () => void | Promise<void>; duration?: number }) {
  const id: number = showToast({
    message: opts.message,
    actionLabel: 'Undo',
    duration: opts.duration ?? 6000,
    onAction: () => {
      dismissToast(id);
      void opts.undo();
    },
  });
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    listeners.add(setItems);
    setItems([...toasts]);
    return () => { listeners.delete(setItems); };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="fixed bottom-6 left-6 z-[100] flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-4 min-w-[280px] max-w-[440px] pl-4 pr-2 py-2.5 rounded-lg shadow-lg text-sm ${
            t.tone === 'error' ? 'bg-[#b3261e] text-white' : 'bg-[#323232] text-white'
          }`}
        >
          <span className="flex-1">{t.message}</span>
          {t.actionLabel && t.onAction && (
            <button
              onClick={t.onAction}
              className="px-2 py-1 rounded font-medium text-[#a8c7fa] hover:bg-white/10"
            >
              {t.actionLabel}
            </button>
          )}
          <button onClick={() => dismissToast(t.id)} className="p-1 rounded text-white/70 hover:bg-white/10" title="Dismiss">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
