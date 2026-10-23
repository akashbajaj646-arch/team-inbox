'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@/types';

/*
 * Desktop notifications (sound + system notification) while a Team Inbox tab is open:
 *  - every incoming SMS / WhatsApp message in an inbox you belong to
 *  - a teammate @mentioning you in a comment
 * Only one open tab (the "leader", via Web Locks) listens, so you get one ping, not one per tab.
 */

const ENABLED_KEY = 'ti.notify.enabled';
const listeners = new Set<() => void>();
type ConnStatus = 'idle' | 'connecting' | 'live' | 'error' | 'standby';
let connectionStatus: ConnStatus = 'idle';
function setConnectionStatus(s: ConnStatus) {
  connectionStatus = s;
  listeners.forEach((l) => l());
}

export function notificationsEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch { return true; }
}

export function setNotificationsEnabled(on: boolean) {
  try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

/* ---------- sound: short two-tone ping, generated (no audio file) ---------- */
let audioCtx: AudioContext | null = null;
function ensureAudio() {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}
function playPing(kind: 'message' | 'mention') {
  const ctx = ensureAudio();
  if (!ctx) return;
  const notes = kind === 'mention' ? [880, 1175, 1568] : [988, 1319];
  const t0 = ctx.currentTime;
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = t0 + i * 0.11;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.25);
  });
}

interface NotifierProps {
  currentUser: User;
  activeThreadId: string | null;
  onOpenThread: (threadId: string, inboxId: string) => void;
}

export default function Notifier({ currentUser, activeThreadId, onOpenThread }: NotifierProps) {
  const supabase = createClient();
  const [isLeader, setIsLeader] = useState(false);
  const activeRef = useRef(activeThreadId);
  activeRef.current = activeThreadId;
  const openRef = useRef(onOpenThread);
  openRef.current = onOpenThread;
  const seen = useRef(new Set<string>());

  // Browsers only allow audio after a user gesture: unlock on the first click/key
  useEffect(() => {
    const unlock = () => { ensureAudio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  // One tab per browser does the listening
  useEffect(() => {
    const locks = (navigator as any).locks;
    if (!locks?.request) { setIsLeader(true); return; }
    let release: (() => void) | null = null;
    let cancelled = false;
    locks.request('ti-notifier-leader', () => new Promise<void>((resolve) => {
      if (cancelled) { resolve(); return; }
      release = resolve;
      setIsLeader(true);
    }));
    return () => { cancelled = true; release?.(); setIsLeader(false); };
  }, []);

  useEffect(() => {
    if (!isLeader) { setConnectionStatus('standby'); return; }
    setConnectionStatus('connecting');
    let memberInboxes = new Map<string, { name: string; type: string }>();
    let cancelled = false;

    (async () => {
      const { data: memberships } = await supabase.from('inbox_members').select('inbox_id').eq('user_id', currentUser.id);
      const ids = (memberships || []).map((m: { inbox_id: string }) => m.inbox_id);
      if (ids.length === 0) return;
      const { data: inboxes } = await supabase.from('inboxes').select('id, name, inbox_type').in('id', ids);
      if (!cancelled) memberInboxes = new Map((inboxes || []).map((i: any) => [i.id, { name: i.name, type: i.inbox_type }]));
    })();

    function notify(opts: { key: string; title: string; body: string; kind: 'message' | 'mention'; threadId: string; inboxId: string }) {
      if (!notificationsEnabled()) return;
      if (seen.current.has(opts.key)) return;
      seen.current.add(opts.key);
      // Already looking at this conversation: stay quiet
      if (document.visibilityState === 'visible' && document.hasFocus() && activeRef.current === opts.threadId) return;

      playPing(opts.kind);
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      try {
        const n = new Notification(opts.title, { body: opts.body.slice(0, 180), tag: opts.key, silent: true, icon: '/favicon.ico' });
        n.onclick = () => { window.focus(); openRef.current(opts.threadId, opts.inboxId); n.close(); };
      } catch { /* some browsers block constructing notifications */ }
    }

    const channel = supabase
      .channel(`notify:${currentUser.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sms_messages' }, async (payload: any) => {
        const m = payload.new;
        if (!m || m.direction !== 'inbound') return;
        const { data: thread } = await supabase
          .from('sms_threads')
          .select('id, inbox_id, contact_name, contact_phone')
          .eq('id', m.thread_id)
          .limit(1)
          .maybeSingle();
        if (!thread) return;
        const inbox = memberInboxes.get(thread.inbox_id);
        if (!inbox) return; // not one of my inboxes
        const channelLabel = inbox.type === 'whatsapp' ? 'WhatsApp' : 'SMS';
        notify({
          key: `sms:${m.id}`,
          kind: 'message',
          title: `${thread.contact_name || thread.contact_phone} · ${channelLabel}`,
          body: m.body?.trim() || 'Sent an attachment',
          threadId: thread.id,
          inboxId: thread.inbox_id,
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'thread_comments' }, async (payload: any) => {
        const c = payload.new;
        if (!c || c.user_id === currentUser.id) return;
        if (!Array.isArray(c.mentioned_user_ids) || !c.mentioned_user_ids.includes(currentUser.id)) return;
        const [{ data: author }, threadInfo] = await Promise.all([
          supabase.from('inbox_users').select('name, email').eq('id', c.user_id).limit(1).maybeSingle(),
          c.sms_thread_id
            ? supabase.from('sms_threads').select('id, inbox_id, contact_name, contact_phone').eq('id', c.sms_thread_id).limit(1).maybeSingle()
            : supabase.from('email_threads').select('id, inbox_id, subject').eq('id', c.thread_id).limit(1).maybeSingle(),
        ]);
        const t: any = threadInfo.data;
        if (!t) return;
        const who = author?.name || author?.email || 'A teammate';
        const where = c.sms_thread_id ? (t.contact_name || t.contact_phone) : (t.subject || '(No subject)');
        notify({
          key: `mention:${c.id}`,
          kind: 'mention',
          title: `${who} mentioned you`,
          body: `${where}: ${(c.content || '').replace(/\s+/g, ' ').trim()}`,
          threadId: t.id,
          inboxId: t.inbox_id,
        });
      })
      .subscribe((state: string, err?: Error) => {
        if (state === 'SUBSCRIBED') setConnectionStatus('live');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          console.error('Notifications channel error:', state, err);
          setConnectionStatus('error');
        }
      });

    return () => { cancelled = true; supabase.removeChannel(channel); setConnectionStatus('idle'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeader, currentUser.id]);

  return null;
}

/** Shows a sample notification so permissions can be checked without waiting for a message. */
export function sendTestNotification(): string {
  playPing('message');
  if (typeof Notification === 'undefined') return 'This browser does not support desktop notifications. You should have heard the sound.';
  if (Notification.permission !== 'granted') return `Desktop pop-ups are ${Notification.permission === 'denied' ? 'blocked' : 'not allowed yet'} for this site. You should have heard the sound.`;
  try {
    new Notification('Team Inbox test', { body: 'If you can see this, desktop notifications are working.', tag: 'ti-test', silent: true, icon: '/favicon.ico' });
    return 'Test sent. No pop-up? Check System Settings > Notifications > your browser, and turn off Focus / Do Not Disturb.';
  } catch {
    return 'The browser refused to show the pop-up.';
  }
}

/** Bell in the sidebar: permission, mute toggle, test, and live connection status. */
export function NotificationBell() {
  const [enabled, setEnabled] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState(connectionStatus);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => {
      setEnabled(notificationsEnabled());
      setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
      setStatus(connectionStatus);
    };
    sync();
    listeners.add(sync);
    return () => { listeners.delete(sync); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function allow() {
    ensureAudio();
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPermission(p);
    setNotificationsEnabled(true);
    if (p === 'granted') setNote(sendTestNotification());
  }

  const on = enabled && permission === 'granted';
  const permLabel =
    permission === 'unsupported' ? 'Not supported in this browser'
    : permission === 'granted' ? 'Allowed'
    : permission === 'denied' ? 'Blocked in browser settings'
    : 'Not allowed yet';
  const statusLabel = { idle: 'Not connected', connecting: 'Connecting...', live: 'Live', error: 'Connection failed', standby: 'Another tab is listening' }[status];

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => { ensureAudio(); setNote(null); setOpen((o) => !o); }}
        title="Notifications"
        className={`relative p-2 rounded-lg transition-colors ${on ? 'text-[#0b57d0] hover:bg-[#e8f0fe]' : 'text-analog-text-muted hover:bg-analog-surface-alt'}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          {!enabled && <path strokeLinecap="round" d="M3 3l18 18" />}
        </svg>
        {permission === 'default' && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#d93025]" />}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 bg-white border border-[#dadce0] rounded-xl shadow-xl p-3 z-50 text-sm">
          <div className="font-medium text-[#202124] mb-2">Notifications</div>
          <div className="space-y-1 text-xs text-[#5f6368] mb-3">
            <div className="flex justify-between"><span>Desktop pop-ups</span><span className={permission === 'granted' ? 'text-[#188038]' : 'text-[#d93025]'}>{permLabel}</span></div>
            <div className="flex justify-between"><span>Live updates</span><span className={status === 'live' || status === 'standby' ? 'text-[#188038]' : 'text-[#d93025]'}>{statusLabel}</span></div>
            <div className="flex justify-between"><span>Pings</span><span>{enabled ? 'On' : 'Muted'}</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {permission === 'default' && (
              <button onClick={allow} className="h-8 px-3 rounded-full bg-[#0b57d0] text-white text-xs font-medium">Allow notifications</button>
            )}
            <button onClick={() => setNotificationsEnabled(!enabled)} className="h-8 px-3 rounded-full border border-[#dadce0] text-xs font-medium text-[#444746] hover:bg-[#f1f3f4]">
              {enabled ? 'Mute' : 'Unmute'}
            </button>
            <button onClick={() => setNote(sendTestNotification())} className="h-8 px-3 rounded-full border border-[#dadce0] text-xs font-medium text-[#444746] hover:bg-[#f1f3f4]">
              Send test
            </button>
          </div>
          {permission === 'denied' && (
            <p className="mt-2 text-xs text-[#5f6368]">Click the lock icon left of the address bar, set Notifications to Allow, then reload.</p>
          )}
          {note && <p className="mt-2 text-xs text-[#3c4043]">{note}</p>}
        </div>
      )}
    </div>
  );
}
