'use client';
import React from 'react';
import { useAutoSave } from '@/lib/use-autosave';
import { extractInlineImages, attachImageResizer, attachImagePasteHandler, MAX_INLINE_IMAGES, type InlineImage } from '@/lib/inline-images';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { EmailThread, EmailMessage, ThreadPresence, User, Template, Inbox } from '@/types';
import CommentSection from './CommentSection';
import TemplatePicker from './TemplatePicker';
import RichTextEditor from './RichTextEditor';
import CustomerCard from './CustomerCard';
import ComposeModal from './ComposeModal';
import { runWithUndo, showToast, doWithUndo } from '@/lib/toast';
import { threadAction } from '@/lib/thread-actions';

interface Attachment {
  file: File;
  name: string;
  size: number;
  type: string;
}

interface EmailAttachment {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  size: number;
  is_inline: boolean;
}

interface SentByUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

interface EmailMessageWithUser extends EmailMessage {
  sent_by?: SentByUser | null;
}

interface ThreadViewProps {
  threadId: string;
  currentUser: User;
}

type ReplyMode = 'reply' | 'replyAll';

const SIDEBAR_KEY = 'ti.threadSidebarOpen';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function extractEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim().toLowerCase();
}

function displayName(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return m ? m[1].trim() : addr.trim();
}

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetOf(m: EmailMessage): string {
  const text = m.body_text ? m.body_text.replace(/\s+/g, ' ').trim() : stripHtml(m.body_html || '');
  // Drop quoted history from the preview
  const cut = text.split(/\sOn .{5,80}wrote:|\s-{2,} ?Original Message|\sFrom: .{3,80}Sent:/)[0];
  return cut.slice(0, 160);
}

function formatShortDate(dateString: string): string {
  const d = new Date(dateString);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFullDate(dateString: string): string {
  const d = new Date(dateString);
  const full = d.toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  let rel = '';
  if (diffMin < 1) rel = 'just now';
  else if (diffMin < 60) rel = `${diffMin} min ago`;
  else if (diffMin < 60 * 24) rel = `${Math.round(diffMin / 60)} hr ago`;
  else if (diffMin < 60 * 24 * 14) rel = `${Math.round(diffMin / 1440)} days ago`;
  return rel ? `${full} (${rel})` : full;
}

function getInitials(name: string | null | undefined, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  return (email || '?').charAt(0).toUpperCase();
}

const AVATAR_COLORS = ['#5b6cf9', '#0f9d76', '#e0712c', '#d6457a', '#1a8fb5', '#8a5cf6', '#c9a227', '#4f7a3a'];

function colorFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------ */
/* Email body renderer                                                 */
/* ------------------------------------------------------------------ */

const IFRAME_BASE_STYLE = `
  html,body{margin:0;padding:0;background:#fff;height:auto !important;min-height:0 !important;}
  body{display:flow-root;}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#202124;word-wrap:break-word;overflow-wrap:anywhere;}
  img{max-width:100%;height:auto;}
  table{max-width:100% !important;}
  pre{white-space:pre-wrap;}
  a{color:#1a73e8;}
  blockquote{margin:0 0 0 .8ex;border-left:2px solid #dadce0;padding-left:1ex;color:#5f6368;}
  .ti-quote-hidden{display:none !important;}
`;

const QUOTE_SELECTORS = [
  '.gmail_quote',
  'blockquote[type="cite"]',
  '.yahoo_quoted',
  '#divRplyFwdMsg',
  '#appendonsend',
];

function hideQuoted(doc: Document): number {
  let hidden = 0;
  const seen = new Set<Element>();
  for (const sel of QUOTE_SELECTORS) {
    doc.querySelectorAll(sel).forEach((el) => {
      // Never hide forwarded content, only reply history
      const txt = (el.textContent || '').slice(0, 200);
      if (/Forwarded message|Begin forwarded message/i.test(txt)) return;
      // Skip nested matches inside something already hidden
      for (const s of Array.from(seen)) if (s.contains(el)) return;
      el.classList.add('ti-quote-hidden');
      seen.add(el);
      hidden++;
      // Outlook: everything after the reply header is history
      if (sel === '#divRplyFwdMsg' || sel === '#appendonsend') {
        let sib = el.nextElementSibling;
        while (sib) { sib.classList.add('ti-quote-hidden'); sib = sib.nextElementSibling; }
        const prev = el.previousElementSibling;
        if (prev && prev.tagName === 'HR') prev.classList.add('ti-quote-hidden');
      }
    });
  }
  return hidden;
}

function EmailBody({ html, text, cidMap }: { html: string | null; text: string | null; cidMap?: Record<string, string> }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hasQuote, setHasQuote] = useState(false);
  const [showQuote, setShowQuote] = useState(false);

  const source = useMemo(() => {
    if (html) {
      // Inline images reference attachments by Content-ID; point them at our attachment proxy
      return html.replace(/(src\s*=\s*["'])cid:([^"']+)(["'])/gi, (m, pre, cid, post) => {
        const id = cidMap?.[cid.trim().toLowerCase()];
        return id ? `${pre}/api/gmail/attachment?id=${id}&inline=1${post}` : m;
      });
    }
    // Plain text: render inside the iframe too so links and quotes look consistent
    const escaped = escapeHtml(text || '').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    return `<div style="white-space:pre-wrap">${escaped}</div>`;
  }, [html, text, cidMap]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${IFRAME_BASE_STYLE}</style></head><body>${source}</body></html>`
    );
    doc.close();

    setHasQuote(hideQuoted(doc) > 0);
    setShowQuote(false);

    const resize = () => {
      if (!iframe || !doc.body) return;
      // Measure the content itself; documentElement.scrollHeight never shrinks below the iframe's own height
      const h = Math.ceil(doc.body.getBoundingClientRect().height);
      iframe.style.height = Math.max(h, 20) + 'px';
    };
    resize();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && doc.body) {
      ro = new ResizeObserver(resize);
      ro.observe(doc.body);
    }
    doc.querySelectorAll('img').forEach((img) => img.addEventListener('load', resize));
    const t1 = setTimeout(resize, 150);
    const t2 = setTimeout(resize, 800);
    return () => {
      ro?.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [source]);

  function toggleQuote() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const next = !showQuote;
    doc.querySelectorAll('[data-ti-q], .ti-quote-hidden').forEach((el) => {
      el.setAttribute('data-ti-q', '1');
      el.classList.toggle('ti-quote-hidden', !next);
    });
    setShowQuote(next);
  }

  return (
    <div>
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="w-full border-0 block"
        style={{ minHeight: '40px' }}
        title="Email body"
      />
      {hasQuote && (
        <button
          onClick={toggleQuote}
          title={showQuote ? 'Hide quoted text' : 'Show trimmed content'}
          className="mt-2 px-2 h-5 inline-flex items-center rounded bg-[#e8eaed] hover:bg-[#dadce0] text-[#5f6368] text-xs leading-none tracking-widest"
        >
          •••
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const Icon = {
  reply: <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />,
  replyAll: <><path strokeLinecap="round" strokeLinejoin="round" d="M7 10h7a7 7 0 017 7v2M7 10l5 5m-5-5l5-5" /><path strokeLinecap="round" strokeLinejoin="round" d="M7 5l-5 5 5 5" /></>,
  forward: <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />,
  more: <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
  clip: <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />,
  trash: <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />,
  sparkle: <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path strokeLinecap="round" d="M15 4v16" /></>,
  external: <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />,
  download: <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />,
  close: <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />,
  unfold: <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M16 15l-4 4-4-4" />,
  archive: <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />,
  unread: <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />,
};

function Svg({ children, className = 'w-4 h-4' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      {children}
    </svg>
  );
}

function IconButton({ onClick, title, children, active }: { onClick: (e: React.MouseEvent) => void; title: string; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-2 rounded-full transition-colors ${active ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]'}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function ThreadView({ threadId, currentUser }: ThreadViewProps) {
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [messages, setMessages] = useState<EmailMessageWithUser[]>([]);
  const [presence, setPresence] = useState<ThreadPresence[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Composer
  const [showComposer, setShowComposer] = useState(false);
  const [replyMode, setReplyMode] = useState<ReplyMode>('reply');
  const [replyBody, setReplyBody] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [ccField, setCcField] = useState('');
  const [bccField, setBccField] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [userSignature, setUserSignature] = useState<string | null>(null);
  const [showForward, setShowForward] = useState(false);

  const [customerLinkedName, setCustomerLinkedName] = useState<string | null>(null);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const [messageAttachments, setMessageAttachments] = useState<Record<string, EmailAttachment[]>>({});
  const [messageCids, setMessageCids] = useState<Record<string, Record<string, string>>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inlineRegistryRef = useRef<Map<string, InlineImage>>(new Map());
  const initialBodyRef = useRef<string>('');
  const lastMessageIdRef = useRef<string | null>(null);
  const activeThreadRef = useRef(threadId);
  const sendingRef = useRef(false);
  useEffect(() => {
    activeThreadRef.current = threadId;
    return () => { activeThreadRef.current = ''; };
  }, [threadId]);
  const [, setInlineCount] = useState(0);
  const supabase = createClient();

  /* ---------- sidebar preference ---------- */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_KEY);
      if (stored !== null) setSidebarOpen(stored === '1');
      else setSidebarOpen(window.innerWidth >= 1500);
    } catch { /* storage unavailable */ }
  }, []);

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  /* ---------- load + realtime ---------- */
  useEffect(() => {
    setDraftId(null);
    setDraftLoaded(false);
    setShowComposer(false);
    setReplyBody('');
    setCcField('');
    setBccField('');
    setShowCcBcc(false);
    setAttachments([]);
    setExpanded(new Set());
    lastMessageIdRef.current = null;
    loadThread();
    loadDraft();
    updatePresence('viewing');
    loadSignature();

    const messageChannel = supabase
      .channel(`messages:${threadId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_messages', filter: `thread_id=eq.${threadId}` }, () => {
        loadMessages();
      })
      .subscribe();

    const presenceChannel = supabase
      .channel(`presence:${threadId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'thread_presence', filter: `thread_id=eq.${threadId}` }, () => {
        loadPresence();
      })
      .subscribe();

    return () => {
      clearPresence();
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(presenceChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Always keep the newest message expanded (also when a new one arrives)
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (lastMessageIdRef.current !== last.id) {
      lastMessageIdRef.current = last.id;
      setExpanded((prev) => new Set(prev).add(last.id));
    }
  }, [messages]);

  // Close the "more" menu on any outside click
  useEffect(() => {
    if (!activeActionMenu) return;
    const close = () => setActiveActionMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [activeActionMenu]);

  /* ---------- inline image paste in composer ---------- */
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  useEffect(() => {
    if (!showComposer) return;
    let cleanupResize: (() => void) | null = null;
    let cleanupPaste: (() => void) | null = null;
    let cancelled = false;
    const tryAttach = () => {
      if (cancelled) return;
      const editor = composerRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null;
      if (!editor) { setTimeout(tryAttach, 100); return; }
      cleanupResize = attachImageResizer(editor);
      cleanupPaste = attachImagePasteHandler(editor, {
        canAddMore: () => inlineRegistryRef.current.size < MAX_INLINE_IMAGES,
        onTooMany: () => alert(`Maximum ${MAX_INLINE_IMAGES} inline images allowed.`),
        onWouldExceedSize: (bytes) => {
          const totalAttachBytes = attachmentsRef.current.reduce((s: number, f: Attachment) => s + (f.file?.size || 0), 0);
          const inlineBytes = Array.from(inlineRegistryRef.current.values()).reduce((s, m) => s + Math.floor(m.data.length * 0.75), 0);
          if (totalAttachBytes + inlineBytes + bytes > 25 * 1024 * 1024) {
            alert('Adding this image would exceed the 25MB total size limit.');
            return true;
          }
          return false;
        },
        onAdded: (meta) => {
          inlineRegistryRef.current.set(meta.cid, meta);
          setInlineCount(inlineRegistryRef.current.size);
        },
      });
      editor.focus();
    };
    tryAttach();
    return () => {
      cancelled = true;
      if (cleanupResize) cleanupResize();
      if (cleanupPaste) cleanupPaste();
    };
  }, [showComposer]);

  useEffect(() => {
    if (showComposer && replyBody.length > 0 && replyBody !== initialBodyRef.current) {
      updatePresence('drafting');
    } else {
      updatePresence('viewing');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showComposer, replyBody]);

  /* ---------- data ---------- */
  async function loadSignature() {
    const { data } = await supabase
      .from('inbox_users')
      .select('email_signature')
      .eq('id', currentUser.id)
      .single();
    setUserSignature(data?.email_signature || null);
  }

  async function loadDraft() {
    try {
      const stored = sessionStorage.getItem('resumeDraft');
      if (stored) {
        const draft = JSON.parse(stored);
        if (draft.draft_type === 'reply' && draft.thread_id === threadId) {
          setDraftId(draft.id);
          setReplyBody(draft.body_html || '');
          if (draft.cc_address) { setCcField(draft.cc_address); setShowCcBcc(true); }
          if (draft.bcc_address) { setBccField(draft.bcc_address); setShowCcBcc(true); }
          initialBodyRef.current = '';
          setShowComposer(true);
          sessionStorage.removeItem('resumeDraft');
          setDraftLoaded(true);
          return;
        }
      }
      const res = await fetch('/api/drafts');
      if (res.ok) {
        const data = await res.json();
        const existing = (data.drafts || []).find((d: any) => d.thread_id === threadId && d.draft_type === 'reply');
        if (existing) {
          setDraftId(existing.id);
          setReplyBody(existing.body_html || '');
          if (existing.cc_address) { setCcField(existing.cc_address); setShowCcBcc(true); }
          if (existing.bcc_address) { setBccField(existing.bcc_address); setShowCcBcc(true); }
          initialBodyRef.current = '';
          setShowComposer(true);
        }
      }
    } catch (err) { console.error('Draft load error:', err); }
    setDraftLoaded(true);
  }

  async function loadThread() {
    setLoading(true);
    const { data: threadData } = await supabase
      .from('email_threads')
      .select('*')
      .eq('id', threadId)
      .single();
    setThread(threadData);

    if (threadData?.inbox_id) {
      const { data: inboxData } = await supabase
        .from('inboxes')
        .select('id, name, email_address, inbox_type')
        .eq('id', threadData.inbox_id)
        .single();
      setInbox((inboxData as unknown as Inbox) || null);
    }

    await loadMessages();
    await loadPresence();
    setLoading(false);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from('email_messages')
      .select(`*, sent_by:inbox_users(id, name, email, avatar_url)`)
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: true });

    setMessages(data || []);
    if (data && data.length > 0) {
      await loadAttachmentsForMessages(data.map((m: any) => m.id));
    }
  }

  async function loadAttachmentsForMessages(messageIds: string[]) {
    if (messageIds.length === 0) return;
    const { data } = await supabase
      .from('email_attachments')
      .select('id, message_id, filename, mime_type, size, is_inline, content_id')
      .in('message_id', messageIds)
      .order('filename', { ascending: true });

    if (data) {
      const byMessage: Record<string, EmailAttachment[]> = {};
      const cids: Record<string, Record<string, string>> = {};
      const seenPart = new Set<string>();
      data.forEach((att: EmailAttachment & { content_id?: string | null }) => {
        // Older rows were sometimes saved twice; show each part once
        const partKey = `${att.message_id}|${att.filename}|${att.content_id || ''}|${att.mime_type || ''}|${att.size ?? ''}`;
        if (seenPart.has(partKey)) return;
        seenPart.add(partKey);
        if (att.content_id) {
          (cids[att.message_id] ||= {})[att.content_id.trim().toLowerCase()] = att.id;
        }
        if (att.is_inline) return;
        if (!byMessage[att.message_id]) byMessage[att.message_id] = [];
        byMessage[att.message_id].push(att);
      });
      setMessageAttachments(byMessage);
      setMessageCids(cids);
    }
  }

  async function loadPresence() {
    const { data } = await supabase
      .from('thread_presence')
      .select(`*, user:inbox_users(id, name, email, avatar_url)`)
      .eq('thread_id', threadId)
      .neq('user_id', currentUser.id);
    setPresence(data || []);
  }

  async function updatePresence(status: 'viewing' | 'drafting') {
    await fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, status }),
    });
  }

  async function clearPresence() {
    await fetch(`/api/presence?threadId=${threadId}`, { method: 'DELETE' });
  }

  /* ---------- recipients ---------- */
  const inboxEmail = (inbox?.email_address || '').toLowerCase();
  const lastInbound = useMemo(() => [...messages].reverse().find((m) => !m.is_outbound), [messages]);
  const replyTarget = lastInbound?.from_address || messages[messages.length - 1]?.to_addresses?.[0] || '';

  const replyAllCc = useMemo(() => {
    const base = lastInbound || messages[messages.length - 1];
    if (!base) return [] as string[];
    const exclude = new Set([inboxEmail, extractEmail(replyTarget), currentUser.email?.toLowerCase()].filter(Boolean));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const a of [...toList(base.to_addresses), ...toList(base.cc_addresses), base.from_address]) {
      const e = extractEmail(a);
      if (!e || exclude.has(e) || seen.has(e)) continue;
      seen.add(e);
      out.push(a);
    }
    return out;
  }, [lastInbound, messages, inboxEmail, replyTarget, currentUser.email]);

  /* ---------- composer actions ---------- */
  function openReply(mode: ReplyMode) {
    setReplyMode(mode);
    if (mode === 'replyAll' && replyAllCc.length > 0) {
      const existing = toList(ccField);
      const merged = [...existing];
      for (const a of replyAllCc) if (!existing.some((e) => extractEmail(e) === extractEmail(a))) merged.push(a);
      setCcField(merged.join(', '));
      setShowCcBcc(true);
    }
    if (!showComposer) {
      if (!replyBody.trim() || replyBody === '<p></p>') {
        const initial = userSignature ? `<p><br></p><p>--</p>${userSignature}` : '';
        initialBodyRef.current = initial;
        setReplyBody(initial);
      }
      setShowComposer(true);
    }
    setTimeout(() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  async function discardReply() {
    if (draftId) {
      fetch(`/api/drafts?id=${draftId}`, { method: 'DELETE' }).catch(() => {});
      setDraftId(null);
    }
    setShowComposer(false);
    setReplyBody('');
    setAttachments([]);
    setCcField('');
    setBccField('');
    setShowCcBcc(false);
    inlineRegistryRef.current.clear();
    initialBodyRef.current = '';
  }

  function openForward(message?: EmailMessageWithUser) {
    const m = message || messages[messages.length - 1];
    if (!m || !thread) return;
    const subj = thread.subject || '';
    const header =
      `<p><br></p><div>---------- Forwarded message ---------<br>` +
      `From: ${escapeHtml(m.from_name ? `${m.from_name} <${m.from_address}>` : m.from_address)}<br>` +
      `Date: ${escapeHtml(new Date(m.sent_at).toLocaleString())}<br>` +
      `Subject: ${escapeHtml(subj)}<br>` +
      (toList(m.to_addresses).length ? `To: ${escapeHtml(toList(m.to_addresses).join(', '))}<br>` : '') +
      `</div><br>`;
    const body = header + (m.body_html || `<div style="white-space:pre-wrap">${escapeHtml(m.body_text || '')}</div>`);
    try {
      sessionStorage.setItem('resumeDraft', JSON.stringify({
        id: null,
        draft_type: 'new',
        inbox_id: thread.inbox_id,
        to_address: '',
        cc_address: '',
        subject: /^fwd?:/i.test(subj) ? subj : `Fwd: ${subj}`,
        body_html: body,
      }));
    } catch { /* ignore */ }
    setActiveActionMenu(null);
    setShowForward(true);
  }

  async function handleSend() {
    if (!replyBody.trim() || replyBody === '<p></p>') return;
    // Guard against a second Cmd+Enter while attachments are still being read
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);

    let payload: string;
    try {
      const uploadedAttachments: { filename: string; mimeType: string; data: string; inline?: boolean; cid?: string }[] = [];
      for (const attachment of attachments) {
        const base64 = await fileToBase64(attachment.file);
        uploadedAttachments.push({ filename: attachment.name, mimeType: attachment.type, data: base64 });
      }
      const { html: rewrittenBody, inlineImages } = extractInlineImages(replyBody, inlineRegistryRef.current);
      for (const img of inlineImages) uploadedAttachments.push({ ...img, inline: true });
      payload = JSON.stringify({
        threadId,
        body: rewrittenBody,
        attachments: uploadedAttachments,
        cc: ccField.trim() || undefined,
        bcc: bccField.trim() || undefined,
      });
    } catch (err) {
      console.error('Send prep error:', err);
      sendingRef.current = false;
      setSending(false);
      showToast({ message: 'Could not read an attachment. Nothing was sent.', tone: 'error' });
      return;
    }

    // Snapshot so Undo (or a failed send) can put everything back
    const snap = { body: replyBody, cc: ccField, bcc: bccField, showCcBcc, attachments, mode: replyMode, draftId };
    const sendThreadId = threadId;

    // Save the text as a draft first, so nothing is lost if the page closes during the undo window.
    // The send route deletes this draft once the reply is out.
    try {
      const dr = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: snap.draftId, draft_type: 'reply', thread_id: sendThreadId, cc_address: snap.cc, bcc_address: snap.bcc, body_html: snap.body }),
      });
      if (dr.ok) {
        const d = await dr.json();
        if (d.draft?.id) snap.draftId = d.draft.id;
      }
    } catch { /* still send; worst case there is no backup draft */ }

    setReplyBody('');
    setAttachments([]);
    setCcField('');
    setBccField('');
    setShowCcBcc(false);
    setShowComposer(false);
    initialBodyRef.current = '';
    sendingRef.current = false;
    setSending(false);

    const restore = async () => {
      if (activeThreadRef.current === sendThreadId) {
        setReplyMode(snap.mode);
        setReplyBody(snap.body);
        setCcField(snap.cc);
        setBccField(snap.bcc);
        setShowCcBcc(snap.showCcBcc);
        setAttachments(snap.attachments);
        setShowComposer(true);
      } else {
        // User moved on: keep the text as a saved draft on that thread
        await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: snap.draftId, draft_type: 'reply', thread_id: sendThreadId, cc_address: snap.cc, bcc_address: snap.bcc, body_html: snap.body }),
        }).catch(() => {});
      }
    };

    runWithUndo({
      message: 'Sending...',
      delayMs: 5000,
      // Page closing mid-window: send now if the request is small enough for keepalive (64KB limit);
      // otherwise the browser asks first, and the draft saved above keeps the text.
      onUnload: () => {
        if (payload.length > 60000) return false;
        try {
          fetch('/api/emails/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
          return true;
        } catch { return false; }
      },
      onUndo: () => {
        void restore();
        showToast({ message: 'Sending undone', duration: 3000 });
      },
      run: async () => {
        try {
          const response = await fetch('/api/emails/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            await restore();
            showToast({ message: `Send failed${err?.error ? `: ${err.error}` : ''}. Your reply was kept.`, tone: 'error', duration: 8000 });
            return;
          }
          if (snap.draftId) fetch(`/api/drafts?id=${snap.draftId}`, { method: 'DELETE' }).catch(() => {});
          showToast({ message: 'Message sent', duration: 3000 });
          if (activeThreadRef.current === sendThreadId) {
            setDraftId((cur) => (cur === snap.draftId ? null : cur));
            inlineRegistryRef.current.clear();
            await loadMessages();
            setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 100);
          }
        } catch (err) {
          console.error('Send error:', err);
          await restore();
          showToast({ message: 'Send failed. Your reply was kept.', tone: 'error', duration: 8000 });
        }
      },
    });
  }

  const { flush: flushDraft } = useAutoSave({
    data: { replyBody, ccField, bccField, showComposer, draftLoaded },
    shouldSave: () =>
      draftLoaded &&
      showComposer &&
      replyBody.trim() !== '' &&
      replyBody !== '<p></p>' &&
      replyBody !== initialBodyRef.current,
    save: async () => {
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draftId,
          draft_type: 'reply',
          thread_id: threadId,
          cc_address: ccField,
          bcc_address: bccField,
          body_html: replyBody,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.draft?.id && !draftId) setDraftId(data.draft.id);
      }
    },
  });
  void flushDraft;

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const added: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 10 * 1024 * 1024) {
        alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
        continue;
      }
      added.push({ file, name: file.name, size: file.size, type: file.type });
    }
    setAttachments((prev) => [...prev, ...added]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleAiAssist() {
    if (!thread || messages.length === 0) return;
    setAiLoading(true);
    if (!showComposer) openReply('reply');
    try {
      const inboundMessage = lastInbound || messages[0];
      const response = await fetch('/api/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadSubject: thread.subject,
          messages: messages.map((m) => ({
            is_outbound: m.is_outbound,
            body_text: m.body_text,
            body_html: m.body_html,
            from_name: m.from_name,
            from_address: m.from_address,
            sent_at: m.sent_at,
          })),
          senderEmail: inboundMessage.from_address,
          senderName: inboundMessage.from_name,
        }),
      });
      const data = await response.json();
      if (data.draft) {
        const htmlDraft = data.draft
          .split('\n\n')
          .map((p: string) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
          .join('');
        setReplyBody(htmlDraft + (userSignature ? `<p><br></p><p>--</p>${userSignature}` : ''));
      } else if (data.error) {
        alert('Failed to generate AI draft. Please try again.');
      }
    } catch {
      alert('Failed to generate AI draft. Please try again.');
    }
    setAiLoading(false);
  }

  function handleTemplateSelect(template: Template) {
    if (!showComposer) openReply('reply');
    setReplyBody(template.body + (userSignature ? `<p><br></p><p>--</p>${userSignature}` : ''));
  }

  /* ---------- per-message actions ---------- */
  async function handleMarkUnread() {
    setActiveActionMenu(null);
    const ok = await threadAction([threadId], 'unread');
    showToast(ok ? { message: 'Marked as unread', duration: 3000 } : { message: 'Could not mark unread', tone: 'error' });
  }

  async function headerAction(action: 'archive' | 'trash') {
    const ok = await threadAction([threadId], action);
    if (!ok) { showToast({ message: 'That did not work. Please try again.', tone: 'error' }); return; }
    doWithUndo({
      message: action === 'archive' ? 'Conversation archived' : 'Conversation moved to trash',
      undo: () => threadAction([threadId], action === 'archive' ? 'unarchive' : 'restore').then(() => {}),
    });
  }

  async function handleDeleteMessage(messageId: string) {
    if (!confirm('Delete this message?')) return;
    await supabase.from('email_messages').delete().eq('id', messageId);
    setActiveActionMenu(null);
    loadMessages();
  }

  function handlePrintMessage(message: EmailMessageWithUser) {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><body>${message.body_html || `<pre>${escapeHtml(message.body_text || '')}</pre>`}</body></html>`);
    w.document.close();
    w.print();
    setActiveActionMenu(null);
  }

  async function handleReportSpam(messageId: string) {
    if (!confirm('Report this email as spam? It will be removed from your inbox.')) return;
    setActiveActionMenu(null);
    const res = await fetch('/api/emails/spam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, action: 'spam' }),
    });
    if (res.ok) loadThread();
    else alert('Failed to report spam.');
  }

  async function handleUnsubscribe(messageId: string, bodyHtml: string) {
    setActiveActionMenu(null);
    const res = await fetch('/api/emails/spam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, action: 'unsubscribe' }),
    });
    const data = await res.json();
    if (data.success) {
      alert(`Unsubscribed successfully (${data.method === 'mailto' ? 'email sent' : 'link triggered'}).`);
    } else {
      const match = bodyHtml?.match(/href=["'](https?:\/\/[^"']*unsubscri[^"']*)/i);
      if (match) window.open(match[1], '_blank');
      else if (confirm('No unsubscribe option found. Report this email as spam instead?')) await handleReportSpam(messageId);
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allExpanded = messages.length > 0 && messages.every((m) => expanded.has(m.id));
  function toggleAll() {
    setExpanded(allExpanded ? new Set(messages.length ? [messages[messages.length - 1].id] : []) : new Set(messages.map((m) => m.id)));
  }

  /* ---------- keyboard shortcuts (Gmail style) ---------- */
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && showComposer) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || showForward) return;
    if (e.key === 'r') { e.preventDefault(); openReply('reply'); }
    else if (e.key === 'a') { e.preventDefault(); openReply('replyAll'); }
    else if (e.key === 'f') { e.preventDefault(); openForward(); }
    else if (e.key === ';') { e.preventDefault(); toggleAll(); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /* ---------- render ---------- */
  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-analog-text-muted bg-white">Loading...</div>;
  }
  if (!thread) {
    return <div className="flex-1 flex items-center justify-center text-analog-text-muted bg-white">Email not found</div>;
  }

  const drafting = presence.filter((p) => p.status === 'drafting');
  const viewing = presence.filter((p) => p.status === 'viewing');
  const senderEmail = lastInbound?.from_address || messages[0]?.from_address;

  // Collapse long runs of old messages into one "N older messages" row, like Gmail
  const COLLAPSE_RUN = 4;
  type Row = { kind: 'msg'; m: EmailMessageWithUser } | { kind: 'older'; count: number; ids: string[] };
  const rows: Row[] = [];
  {
    const lastIdx = messages.length - 1;
    let run: EmailMessageWithUser[] = [];
    const flush = () => {
      if (run.length >= COLLAPSE_RUN) {
        rows.push({ kind: 'msg', m: run[0] });
        rows.push({ kind: 'older', count: run.length - 2, ids: run.slice(1, -1).map((m) => m.id) });
        rows.push({ kind: 'msg', m: run[run.length - 1] });
      } else run.forEach((m) => rows.push({ kind: 'msg', m }));
      run = [];
    };
    messages.forEach((m, i) => {
      if (!expanded.has(m.id) && i !== lastIdx) run.push(m);
      else { flush(); rows.push({ kind: 'msg', m }); }
    });
    flush();
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-white">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div className="px-6 py-3 border-b border-[#e8eaed] flex items-center gap-3 flex-shrink-0 bg-white">
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] leading-7 font-normal text-[#202124] truncate" title={thread.subject || ''}>
              {thread.subject || '(No subject)'}
            </h1>
            {customerLinkedName && <p className="text-xs text-[#5f6368] truncate">{customerLinkedName}</p>}
          </div>

          {(drafting.length > 0 || viewing.length > 0) && (
            <div className="flex -space-x-1.5" title={[...drafting, ...viewing].map((p) => `${p.user?.name || p.user?.email} ${p.status}`).join('\n')}>
              {[...drafting, ...viewing.filter((v) => !drafting.find((d) => d.user_id === v.user_id))].slice(0, 4).map((p) => (
                <div
                  key={p.user_id}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold border-2 ${p.status === 'drafting' ? 'border-amber-400' : 'border-white'}`}
                  style={{ backgroundColor: colorFor(p.user_id) }}
                >
                  {getInitials(p.user?.name, p.user?.email || '')}
                </div>
              ))}
            </div>
          )}

          <IconButton onClick={() => headerAction('archive')} title="Archive">
            <Svg>{Icon.archive}</Svg>
          </IconButton>
          <IconButton onClick={() => headerAction('trash')} title="Move to trash">
            <Svg>{Icon.trash}</Svg>
          </IconButton>
          <IconButton onClick={handleMarkUnread} title="Mark as unread">
            <Svg>{Icon.unread}</Svg>
          </IconButton>
          <span className="w-px h-5 bg-[#e8eaed] mx-1" />
          {messages.length > 1 && (
            <IconButton onClick={toggleAll} title={allExpanded ? 'Collapse all (;)' : 'Expand all (;)'}>
              <Svg>{Icon.unfold}</Svg>
            </IconButton>
          )}
          <IconButton onClick={() => window.open(`/email/${threadId}`, '_blank', 'noopener,noreferrer')} title="Open in new window">
            <Svg>{Icon.external}</Svg>
          </IconButton>
          <IconButton onClick={toggleSidebar} title={sidebarOpen ? 'Hide customer & comments' : 'Show customer & comments'} active={sidebarOpen}>
            <Svg>{Icon.panel}</Svg>
          </IconButton>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-[920px] mx-auto px-6 pt-4 pb-10">
            <div className="border-t border-[#e8eaed]">
              {rows.map((row, idx) => {
                if (row.kind === 'older') {
                  return (
                    <button
                      key={`older-${idx}`}
                      onClick={() => setExpanded((prev) => { const n = new Set(prev); row.ids.forEach((id) => n.add(id)); return n; })}
                      className="relative w-full h-6 flex items-center justify-center border-b border-[#e8eaed] group"
                    >
                      <span className="absolute left-4 w-9 h-9 rounded-full bg-white border border-[#dadce0] flex items-center justify-center text-xs text-[#5f6368] group-hover:bg-[#f1f3f4]">
                        {row.count}
                      </span>
                      <span className="text-[11px] text-[#5f6368] opacity-0 group-hover:opacity-100">Show {row.count} older messages</span>
                    </button>
                  );
                }

                const message = row.m;
                const isOpen = expanded.has(message.id) || message.id === messages[messages.length - 1]?.id;
                const senderLabel = message.from_name || displayName(message.from_address);
                const msgAttachments = messageAttachments[message.id] || [];
                const to = toList(message.to_addresses);
                const cc = toList(message.cc_addresses);
                const isLast = message.id === messages[messages.length - 1]?.id;

                if (!isOpen) {
                  return (
                    <div
                      key={message.id}
                      onClick={() => toggleExpanded(message.id)}
                      className="flex items-center gap-3 px-4 py-2.5 border-b border-[#e8eaed] cursor-pointer hover:bg-[#f8f9fa]"
                    >
                      <div
                        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold"
                        style={{ backgroundColor: colorFor(extractEmail(message.from_address)) }}
                      >
                        {getInitials(message.from_name, message.from_address)}
                      </div>
                      <span className="w-44 flex-shrink-0 truncate text-sm font-semibold text-[#202124]">{senderLabel}</span>
                      <span className="flex-1 min-w-0 truncate text-sm text-[#5f6368]">{snippetOf(message)}</span>
                      {msgAttachments.length > 0 && <Svg className="w-3.5 h-3.5 text-[#5f6368] flex-shrink-0">{Icon.clip}</Svg>}
                      <span className="text-xs text-[#5f6368] flex-shrink-0">{formatShortDate(message.sent_at)}</span>
                    </div>
                  );
                }

                return (
                  <div key={message.id} className={`px-4 pt-4 pb-5 ${isLast ? '' : 'border-b border-[#e8eaed]'}`}>
                    {/* Message header */}
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-semibold"
                        style={{ backgroundColor: colorFor(extractEmail(message.from_address)) }}
                      >
                        {getInitials(message.from_name, message.from_address)}
                      </div>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => !isLast && toggleExpanded(message.id)}>
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <span className="text-sm font-semibold text-[#202124] truncate">{senderLabel}</span>
                          {message.from_name && (
                            <span className="text-xs text-[#5f6368] truncate">&lt;{extractEmail(message.from_address)}&gt;</span>
                          )}
                          {message.is_outbound && message.sent_by && (
                            <span
                              className="ml-1 flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
                              style={{ backgroundColor: colorFor(message.sent_by.id) }}
                              title={`Sent by ${message.sent_by.name || message.sent_by.email}`}
                            >
                              {message.sent_by.name?.split(' ')[0] || message.sent_by.email.split('@')[0]}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#5f6368] truncate" title={[to.length ? `To: ${to.join(', ')}` : '', cc.length ? `Cc: ${cc.join(', ')}` : ''].filter(Boolean).join('\n')}>
                          to {to.length ? to.map(displayName).join(', ') : 'undisclosed recipients'}
                          {cc.length > 0 && <>, cc {cc.map(displayName).join(', ')}</>}
                        </div>
                      </div>
                      <span className="text-xs text-[#5f6368] whitespace-nowrap pt-0.5" title={new Date(message.sent_at).toLocaleString()}>
                        {formatFullDate(message.sent_at)}
                      </span>
                      <div className="flex items-center -mt-1 -mr-2">
                        <IconButton onClick={(e) => { e.stopPropagation(); openReply('reply'); }} title="Reply (r)">
                          <Svg>{Icon.reply}</Svg>
                        </IconButton>
                        <div className="relative">
                          <IconButton
                            onClick={(e) => { e.stopPropagation(); setActiveActionMenu(activeActionMenu === message.id ? null : message.id); }}
                            title="More"
                          >
                            <Svg>{Icon.more}</Svg>
                          </IconButton>
                          {activeActionMenu === message.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-9 w-52 bg-white border border-[#dadce0] rounded-lg shadow-lg z-50 py-1.5"
                            >
                              {[
                                { label: 'Reply', fn: () => { setActiveActionMenu(null); openReply('reply'); } },
                                ...(replyAllCc.length > 0 ? [{ label: 'Reply all', fn: () => { setActiveActionMenu(null); openReply('replyAll'); } }] : []),
                                { label: 'Forward', fn: () => openForward(message) },
                                { label: 'Print', fn: () => handlePrintMessage(message) },
                                { label: 'Mark thread unread', fn: () => handleMarkUnread() },
                                ...(!message.is_outbound ? [
                                  { label: 'Unsubscribe', fn: () => handleUnsubscribe(message.id, message.body_html || '') },
                                  { label: 'Report spam', fn: () => handleReportSpam(message.id), danger: true },
                                ] : []),
                                { label: 'Delete this message', fn: () => handleDeleteMessage(message.id), danger: true },
                              ].map(({ label, fn, danger }: { label: string; fn: () => void; danger?: boolean }) => (
                                <button
                                  key={label}
                                  onClick={fn}
                                  className={`w-full text-left px-4 py-1.5 text-sm hover:bg-[#f1f3f4] ${danger ? 'text-[#d93025]' : 'text-[#202124]'}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Body */}
                    <div className="pl-[52px] pt-3">
                      <EmailBody html={message.body_html} text={message.body_text} cidMap={messageCids[message.id]} />

                      {msgAttachments.length > 0 && (
                        <div className="mt-5 pt-4 border-t border-[#e8eaed]">
                          <div className="flex items-center gap-3 mb-2.5">
                            <span className="text-xs font-medium text-[#5f6368]">
                              {msgAttachments.length} attachment{msgAttachments.length > 1 ? 's' : ''}
                            </span>
                            {msgAttachments.length > 1 && (
                              <button
                                onClick={() => msgAttachments.forEach((att, i) => setTimeout(() => window.open(`/api/gmail/attachment?id=${att.id}`, '_blank'), i * 600))}
                                className="text-xs text-[#1a73e8] hover:underline flex items-center gap-1"
                              >
                                <Svg className="w-3.5 h-3.5">{Icon.download}</Svg>
                                Download all
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {msgAttachments.map((att) => (
                              <a
                                key={att.id}
                                href={`/api/gmail/attachment?id=${att.id}`}
                                download={att.filename}
                                className="flex items-center gap-2 pl-2.5 pr-3 py-2 border border-[#dadce0] rounded-lg text-sm hover:bg-[#f8f9fa] hover:border-[#bdc1c6] max-w-[260px]"
                              >
                                <Svg className="w-4 h-4 text-[#5f6368] flex-shrink-0">{Icon.clip}</Svg>
                                <span className="text-[#202124] truncate">{att.filename}</span>
                                <span className="text-[#5f6368] text-xs flex-shrink-0">{formatFileSize(att.size)}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Someone else is drafting */}
            {drafting.length > 0 && (
              <div className="mt-4 ml-[52px] flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs font-medium text-amber-900">
                {drafting.length === 1
                  ? `${drafting[0].user?.name?.split(' ')[0] || drafting[0].user?.email?.split('@')[0]} is drafting a reply`
                  : `${drafting.length} people are drafting replies`}
                <span className="flex gap-0.5 ml-1">
                  <span className="w-1 h-1 bg-amber-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 bg-amber-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 bg-amber-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            )}

            {/* Reply area */}
            {!showComposer ? (
              <div className="mt-5 ml-[52px] flex flex-wrap items-center gap-2">
                <button onClick={() => openReply('reply')} className="flex items-center gap-2 h-9 px-5 rounded-full border border-[#747775] text-sm font-medium text-[#444746] hover:bg-[#f1f3f4]" title="Reply (r)">
                  <Svg>{Icon.reply}</Svg> Reply
                </button>
                {replyAllCc.length > 0 && (
                  <button onClick={() => openReply('replyAll')} className="flex items-center gap-2 h-9 px-5 rounded-full border border-[#747775] text-sm font-medium text-[#444746] hover:bg-[#f1f3f4]" title="Reply all (a)">
                    <Svg>{Icon.replyAll}</Svg> Reply all
                  </button>
                )}
                <button onClick={() => openForward()} className="flex items-center gap-2 h-9 px-5 rounded-full border border-[#747775] text-sm font-medium text-[#444746] hover:bg-[#f1f3f4]" title="Forward (f)">
                  <Svg>{Icon.forward}</Svg> Forward
                </button>
                <button
                  onClick={handleAiAssist}
                  disabled={aiLoading}
                  className="flex items-center gap-2 h-9 px-4 rounded-full text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe] disabled:opacity-50"
                >
                  <Svg>{Icon.sparkle}</Svg> {aiLoading ? 'Drafting...' : 'Draft with AI'}
                </button>
              </div>
            ) : (
              <div ref={composerRef} className="mt-5 ml-[52px] border border-[#dadce0] rounded-xl shadow-[0_1px_3px_rgba(60,64,67,0.15)] overflow-hidden">
                {/* Recipients */}
                <div className="px-4 pt-3 pb-2 space-y-1.5 text-sm">
                  <div className="flex items-center gap-2 text-[#5f6368]">
                    <Svg className="w-4 h-4 flex-shrink-0">{replyMode === 'replyAll' ? Icon.replyAll : Icon.reply}</Svg>
                    <span className="truncate text-[#202124]" title={replyTarget}>
                      {replyTarget ? displayName(replyTarget) : 'Sender'}
                    </span>
                    {!showCcBcc && (
                      <button onClick={() => setShowCcBcc(true)} className="ml-auto text-xs text-[#5f6368] hover:text-[#202124] hover:underline">
                        Cc / Bcc
                      </button>
                    )}
                  </div>
                  {showCcBcc && (
                    <>
                      <div className="flex items-center gap-2 border-b border-[#f1f3f4] pb-1">
                        <span className="w-8 text-xs text-[#5f6368]">Cc</span>
                        <input
                          type="text"
                          value={ccField}
                          onChange={(e) => setCcField(e.target.value)}
                          placeholder="Add recipients, comma separated"
                          className="flex-1 bg-transparent text-sm text-[#202124] placeholder-[#9aa0a6] focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2 border-b border-[#f1f3f4] pb-1">
                        <span className="w-8 text-xs text-[#5f6368]">Bcc</span>
                        <input
                          type="text"
                          value={bccField}
                          onChange={(e) => setBccField(e.target.value)}
                          placeholder="Add recipients, comma separated"
                          className="flex-1 bg-transparent text-sm text-[#202124] placeholder-[#9aa0a6] focus:outline-none"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="px-2 pb-1 ti-reply-editor">
                  <RichTextEditor content={replyBody} onChange={setReplyBody} placeholder="Write your reply..." />
                </div>

                {attachments.length > 0 && (
                  <div className="px-4 pb-2 flex flex-wrap gap-2">
                    {attachments.map((attachment, index) => (
                      <div key={index} className="flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 bg-[#f1f3f4] rounded-md text-sm">
                        <span className="text-[#1a73e8] truncate max-w-[180px]">{attachment.name}</span>
                        <span className="text-[#5f6368] text-xs">({formatFileSize(attachment.size)})</span>
                        <button onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))} className="p-0.5 text-[#5f6368] hover:text-[#202124]" title="Remove">
                          <Svg className="w-3.5 h-3.5">{Icon.close}</Svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Toolbar */}
                <div className="flex items-center gap-1 px-3 py-2.5">
                  <button
                    onClick={handleSend}
                    disabled={!replyBody.trim() || replyBody === '<p></p>' || sending}
                    className="h-9 px-6 rounded-full bg-[#0b57d0] text-white text-sm font-medium hover:bg-[#0a4ebb] hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Send (Ctrl/⌘ + Enter)"
                  >
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                  <input type="file" ref={fileInputRef} onChange={handleFileSelect} multiple className="hidden" />
                  <IconButton onClick={() => fileInputRef.current?.click()} title="Attach files">
                    <Svg className="w-5 h-5">{Icon.clip}</Svg>
                  </IconButton>
                  <IconButton onClick={handleAiAssist} title="Draft with AI">
                    <Svg className={`w-5 h-5 ${aiLoading ? 'animate-pulse text-[#1a73e8]' : ''}`}>{Icon.sparkle}</Svg>
                  </IconButton>
                  <TemplatePicker inboxId={thread.inbox_id} onSelect={handleTemplateSelect} variant="icon" />
                  <div className="flex-1" />
                  <IconButton onClick={discardReply} title="Discard draft">
                    <Svg className="w-5 h-5">{Icon.trash}</Svg>
                  </IconButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right sidebar: customer + internal comments */}
      {sidebarOpen && (
        <div className="w-72 flex-shrink-0 bg-analog-surface-alt border-l border-[#e8eaed] flex flex-col">
          <div className="overflow-y-auto px-4 py-5 border-b border-stone-200" style={{ maxHeight: '50%' }}>
            <CustomerCard email={senderEmail} onCustomerLinked={(name) => setCustomerLinkedName(name)} />
          </div>
          <div className="overflow-y-auto px-4 py-5 flex-1">
            <CommentSection threadId={threadId} currentUser={currentUser} />
          </div>
        </div>
      )}

      {showForward && inbox && (
        <ComposeModal
          inbox={inbox}
          currentUser={currentUser}
          onClose={() => setShowForward(false)}
          onSent={() => setShowForward(false)}
        />
      )}
    </div>
  );
}
