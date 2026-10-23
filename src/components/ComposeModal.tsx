'use client';

import { useState, useRef, useEffect } from 'react';
import type { Inbox, User } from '@/types';
import TemplatePicker from './TemplatePicker';
import SkuPicker from './SkuPicker';
import { runWithUndo, showToast } from '@/lib/toast';
import { MAX_EMAIL_FILES, MAX_EMAIL_TOTAL_BYTES, validateEmailAttachments, formatFileSize, getTotalSize, MAX_SMS_FILES, MAX_WHATSAPP_FILES, validateSmsAttachments, isRiskyFile } from '@/lib/attachments';
import { useAutoSave } from '@/lib/use-autosave';
import { extractInlineImages, attachImageResizer, attachImagePasteHandler, MAX_INLINE_IMAGES, type InlineImage } from '@/lib/inline-images';

interface ComposeModalProps {
  inbox: Inbox;
  currentUser: User;
  onClose: () => void;
  onSent?: () => void;
}

export default function ComposeModal({ inbox, currentUser, onClose, onSent }: ComposeModalProps) {
  const isEmail = inbox.inbox_type === 'email';
  const isSms = inbox.inbox_type === 'sms';
  const isWhatsApp = inbox.inbox_type === 'whatsapp';

  const [winMode, setWinMode] = useState<'normal' | 'min' | 'max'>('normal');
  // /sku: product links in the email body
  const [skuQuery, setSkuQuery] = useState<string | null>(null);
  const [skuPos, setSkuPos] = useState({ top: 0, left: 0 });
  const skuAnchorRef = useRef<{ node: Text; start: number; end: number } | null>(null);
  const [pendingSend, setPendingSend] = useState(false);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const inlineRegistryRef = useRef<Map<string, InlineImage>>(new Map());
  const [inlineCount, setInlineCount] = useState(0);
  const [smsMedia, setSmsMedia] = useState<File[]>([]);
  const [smsMediaPreviews, setSmsMediaPreviews] = useState<string[]>([]);
  const [fontSize, setFontSize] = useState('3');

  const editorRef = useRef<HTMLDivElement>(null);

  // Resume draft from sessionStorage if present
  useEffect(() => {
    if (!isEmail) return;
    try {
      const stored = sessionStorage.getItem('resumeDraft');
      if (stored) {
        const draft = JSON.parse(stored);
        if (draft.draft_type === 'new' && draft.inbox_id === inbox.id) {
          setDraftId(draft.id);
          setTo(draft.to_address || '');
          setCc(draft.cc_address || '');
          if (draft.cc_address) setShowCc(true);
          setSubject(draft.subject || '');
          if (editorRef.current && draft.body_html) {
            editorRef.current.innerHTML = draft.body_html;
          }
          sessionStorage.removeItem('resumeDraft');
        }
      }
    } catch (err) { console.error('Failed to load resumed draft:', err); }
    setDraftLoaded(true);
  }, [isEmail, inbox.id]);

  // Auto-save draft. Refs avoid stale ids and stop saving once a send has started.
  const draftIdRef = useRef<string | null>(null);
  useEffect(() => { draftIdRef.current = draftId; }, [draftId]);
  const sendStartedRef = useRef(false);
  const { flush: flushDraft } = useAutoSave({
    data: { to, cc, subject, draftLoaded },
    shouldSave: () => isEmail && draftLoaded && !sendStartedRef.current && (to.trim() !== '' || subject.trim() !== '' || (editorRef.current?.innerText.trim() || '') !== ''),
    save: async () => {
      const body_html = editorRef.current?.innerHTML || '';
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draftIdRef.current,
          draft_type: 'new',
          inbox_id: inbox.id,
          to_address: to,
          cc_address: cc,
          subject,
          body_html,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.draft?.id && !draftIdRef.current) { draftIdRef.current = data.draft.id; setDraftId(data.draft.id); }
      }
    },
  });

  useEffect(() => {
    if (!isEmail) return;
    async function loadSignature() {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data } = await supabase
        .from('inbox_users')
        .select('email_signature')
        .eq('id', currentUser.id)
        .single();
      if (data?.email_signature && editorRef.current && !(editorRef.current.innerText || '').trim()) {
        editorRef.current.innerHTML = `<p><br></p><p>--</p>${data.email_signature}`;
        // Place cursor at top
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(editorRef.current, 0);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    loadSignature();
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const smsFileInputRef = useRef<HTMLInputElement>(null);

  const attachmentsRef = useRef<File[]>([]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  useEffect(() => {
    if (!isEmail) return;
    let cleanupResize: (() => void) | null = null;
    let cleanupPaste: (() => void) | null = null;
    let cancelled = false;
    const tryAttach = () => {
      if (cancelled) return;
      const editor = editorRef.current;
      if (!editor) { setTimeout(tryAttach, 100); return; }
      cleanupResize = attachImageResizer(editor);
      cleanupPaste = attachImagePasteHandler(editor, {
        canAddMore: () => inlineRegistryRef.current.size < MAX_INLINE_IMAGES,
        onTooMany: () => alert(`Maximum ${MAX_INLINE_IMAGES} inline images allowed.`),
        onWouldExceedSize: (bytes) => {
          const totalAttachBytes = attachmentsRef.current.reduce((s, f) => s + f.size, 0);
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
    };
    tryAttach();
    return () => {
      cancelled = true;
      if (cleanupResize) cleanupResize();
      if (cleanupPaste) cleanupPaste();
    };
  }, [isEmail]);

  function execCmd(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  }

  function handleTemplateSelect(template: any) {
    if (editorRef.current) {
      editorRef.current.innerHTML = template.body;
      editorRef.current.focus();
    }
    if (template.subject && !subject) {
      setSubject(template.subject);
    }
  }

  const sendGuardRef = useRef(false);
  function checkSkuTrigger() {
    const sel = window.getSelection();
    const editor = editorRef.current;
    if (!sel || sel.rangeCount === 0 || !editor) { setSkuQuery(null); return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (!range.collapsed || node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) { setSkuQuery(null); return; }
    const before = (node.textContent || '').slice(0, range.startOffset);
    const m = before.match(/\/sku:(\S*)$/);
    if (!m) { setSkuQuery(null); skuAnchorRef.current = null; return; }
    skuAnchorRef.current = { node: node as Text, start: range.startOffset - m[0].length, end: range.startOffset };
    const rect = range.getBoundingClientRect();
    setSkuPos({
      top: Math.min(rect.bottom + 6, window.innerHeight - 330),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 370)),
    });
    setSkuQuery(m[1]);
  }

  function insertSkuLink(product: { style_number: string; url?: string }) {
    const anchor = skuAnchorRef.current;
    if (!anchor || !product.url) return;
    const { node, start } = anchor;
    // The query may have grown since the anchor was recorded: remove up to the caret
    const sel = window.getSelection();
    const end = sel && sel.rangeCount && sel.getRangeAt(0).startContainer === node ? sel.getRangeAt(0).startOffset : anchor.end;
    const range = document.createRange();
    range.setStart(node, Math.min(start, node.length));
    range.setEnd(node, Math.min(Math.max(end, start), node.length));
    range.deleteContents();
    const a = document.createElement('a');
    a.href = product.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = product.style_number;
    const space = document.createTextNode('\u00a0');
    range.insertNode(space);
    range.insertNode(a);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
    editorRef.current?.focus();
    skuAnchorRef.current = null;
    setSkuQuery(null);
  }

  async function handleSend() {
    if (sendGuardRef.current) return;
    sendGuardRef.current = true;
    try { await handleSendInner(); } finally { sendGuardRef.current = false; }
  }

  async function handleSendInner() {
    setError(null);
    setSending(true);
    try {
      if (isEmail) {
        const rawHtml = editorRef.current?.innerHTML || '';
        const bodyText = editorRef.current?.innerText || '';
        // Extract inline images and rewrite img src to cid:
        const { html: bodyHtml, inlineImages } = extractInlineImages(rawHtml, inlineRegistryRef.current);
        if (!to.trim() || !subject.trim() || !bodyText.trim()) {
          setError('To, Subject, and Body are required.');
          setSending(false);
          return;
        }
        const v = validateEmailAttachments(attachments);
        if (!v.ok) { setError(v.error || 'Invalid attachments'); setSending(false); return; }
        if (v.warnings && v.warnings.length > 0) {
          if (!confirm(v.warnings[0] + '\n\nSend anyway?')) { setSending(false); return; }
        }
        // Convert regular attachments to base64
        const regularAttachments = await Promise.all(attachments.map(async (file) => ({
          filename: file.name,
          mimeType: file.type,
          data: await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res((r.result as string).split(',')[1]);
            r.onerror = rej;
            r.readAsDataURL(file);
          }),
        })));
        const allAttachments = [
          ...regularAttachments,
          ...inlineImages.map(img => ({ ...img, inline: true })),
        ];
        // Persist the latest content, then stop autosaving; the server deletes this draft after sending
        await flushDraft();
        sendStartedRef.current = true;
        const payload = JSON.stringify({
          draftId: draftIdRef.current || undefined,
          inboxId: inbox.id,
          to: to.trim(),
          cc: cc.trim() || undefined,
          subject: subject.trim(),
          body: bodyHtml,
          attachments: allAttachments,
          isNew: true,
        });
        const sentDraftId = draftIdRef.current;
        // Hide the window for 5s with an Undo; it stays mounted so Undo restores everything
        setPendingSend(true);
        setSending(false);
        runWithUndo({
          message: 'Sending...',
          delayMs: 5000,
          onUndo: () => { sendStartedRef.current = false; setPendingSend(false); showToast({ message: 'Sending undone', duration: 3000 }); },
          onUnload: () => {
            if (payload.length > 60000) return false;
            try {
              fetch('/api/emails/send-new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
              return true;
            } catch { return false; }
          },
          run: async () => {
            try {
              const res = await fetch('/api/emails/send-new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
              if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || 'Failed to send email');
              }
              if (sentDraftId) fetch(`/api/drafts?id=${sentDraftId}`, { method: 'DELETE' }).catch(() => {});
              showToast({ message: 'Message sent', duration: 3000 });
              onSent?.();
              onClose();
            } catch (err: any) {
              sendStartedRef.current = false;
              setPendingSend(false);
              setError(err.message || 'Failed to send');
              showToast({ message: `Send failed: ${err.message || 'unknown error'}`, tone: 'error', duration: 8000 });
            }
          },
        });
        return;
      } else {
        if (!phone.trim() || (!message.trim() && smsMedia.length === 0)) {
          setError('Phone number and message or media are required.');
          setSending(false);
          return;
        }
        // Validate
        if (isWhatsApp) {
          if (smsMedia.length > MAX_WHATSAPP_FILES) {
            setError(`WhatsApp supports up to ${MAX_WHATSAPP_FILES} files.`);
            setSending(false); return;
          }
        } else {
          const v = validateSmsAttachments(smsMedia);
          if (!v.ok) { setError(v.error || 'Invalid attachments'); setSending(false); return; }
        }

        // Upload all files first
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const mediaUrls: string[] = [];
        for (const file of smsMedia) {
          const ext = file.name.split('.').pop();
          const filename = `sms-media/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: upErr } = await supabase.storage.from('attachments').upload(filename, file);
          if (upErr) throw upErr;
          const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(filename);
          mediaUrls.push(publicUrl);
        }

        if (isWhatsApp && mediaUrls.length > 1) {
          // WhatsApp: send each media as its own message (mimics phone behavior)
          for (let i = 0; i < mediaUrls.length; i++) {
            const isFirst = i === 0;
            const res = await fetch('/api/sms/send-new', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inboxId: inbox.id,
                toPhone: phone.trim(),
                channel: isWhatsApp ? 'whatsapp' : 'sms',
                body: isFirst ? message.trim() : '',  // text only on first message
                mediaUrls: [mediaUrls[i]],
              }),
            });
            if (!res.ok) {
              const d = await res.json();
              throw new Error(d.error || `Failed to send message ${i + 1}`);
            }
          }
        } else {
          // SMS or single-media WhatsApp: one request
          const res = await fetch('/api/sms/send-new', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inboxId: inbox.id,
              toPhone: phone.trim(),
              channel: isWhatsApp ? 'whatsapp' : 'sms',
              body: message.trim(),
              mediaUrls,
            }),
          });
          if (!res.ok) {
            const d = await res.json();
            throw new Error(d.error || 'Failed to send message');
          }
        }
      }
      if (draftId) {
        await fetch(`/api/drafts?id=${draftId}`, { method: 'DELETE' });
      }
      onSent?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to send');
    }
    setSending(false);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return (
    <div
      className={`${pendingSend ? 'hidden' : ''} ${winMode === 'max' ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/30' : 'fixed bottom-0 right-6 z-50'}`}
      onClick={(e) => { if (winMode === 'max' && e.target === e.currentTarget) setWinMode('normal'); }}
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!sending) handleSend(); } }}
    >
      <div
        className={`bg-white shadow-[0_8px_30px_rgba(60,64,67,0.35)] border border-[#dadce0] overflow-hidden flex flex-col ${
          winMode === 'max'
            ? 'w-[min(1000px,94vw)] h-[88vh] rounded-xl'
            : winMode === 'min'
              ? 'w-[300px] rounded-t-xl'
              : 'w-[min(580px,96vw)] h-[min(620px,calc(100vh-24px))] rounded-t-xl'
        }`}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 pl-4 pr-1.5 h-10 bg-[#f2f6fc] cursor-pointer flex-shrink-0 select-none"
          onClick={() => setWinMode(winMode === 'min' ? 'normal' : 'min')}
        >
          <p className="flex-1 min-w-0 text-sm font-medium text-[#1f1f1f] truncate">
            {winMode === 'min' && isEmail && subject.trim()
              ? subject.trim()
              : isEmail ? 'New message' : isWhatsApp ? 'New WhatsApp message' : 'New text message'}
            <span className="ml-2 text-xs font-normal text-[#5f6368]">
              {isEmail ? inbox.email_address : (inbox as any).twilio_phone_number || inbox.name}
            </span>
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); setWinMode(winMode === 'min' ? 'normal' : 'min'); }}
            title={winMode === 'min' ? 'Restore' : 'Minimize'}
            className="p-1.5 rounded text-[#444746] hover:bg-[#e1e5ea]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5 12h14" /></svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setWinMode(winMode === 'max' ? 'normal' : 'max'); }}
            title={winMode === 'max' ? 'Exit full screen' : 'Full screen'}
            className="p-1.5 rounded text-[#444746] hover:bg-[#e1e5ea]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {winMode === 'max'
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>
          </button>
          <button
            onClick={async (e) => { e.stopPropagation(); await flushDraft(); onClose(); }}
            title="Save and close"
            className="p-1.5 rounded text-[#444746] hover:bg-[#e1e5ea]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className={`${winMode === 'min' ? 'hidden' : 'flex'} flex-col flex-1 min-h-0`}>

        {error && (
          <div className="px-5 py-3 bg-analog-error/10 border-b border-analog-error/20 text-analog-error text-sm">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isEmail ? (
            <div className="divide-y divide-analog-border">
              {/* To */}
              <div className="flex items-center gap-3 px-5 py-3">
                <span className="text-xs font-semibold text-analog-text-faint w-12 flex-shrink-0">To</span>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="flex-1 bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none"
                  autoFocus
                />
                {!showCc && (
                  <button onClick={() => setShowCc(true)} className="text-xs text-analog-text-faint hover:text-analog-accent transition-colors">Cc</button>
                )}
              </div>

              {/* Cc */}
              {showCc && (
                <div className="flex items-center gap-3 px-5 py-3">
                  <span className="text-xs font-semibold text-analog-text-faint w-12 flex-shrink-0">Cc</span>
                  <input
                    type="email"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="cc@example.com"
                    className="flex-1 bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none"
                    autoFocus
                  />
                </div>
              )}

              {/* Subject */}
              <div className="flex items-center gap-3 px-5 py-3">
                <span className="text-xs font-semibold text-analog-text-faint w-12 flex-shrink-0">Subject</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject"
                  className="flex-1 bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none"
                />
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-1 px-4 py-2 bg-analog-surface-alt border-b border-analog-border flex-wrap">
                <select
                  value={fontSize}
                  onChange={(e) => { setFontSize(e.target.value); execCmd('fontSize', e.target.value); }}
                  className="text-xs bg-transparent border border-analog-border rounded px-1.5 py-1 text-analog-text-muted focus:outline-none cursor-pointer mr-1"
                >
                  <option value="1">Small</option>
                  <option value="3">Normal</option>
                  <option value="4">Large</option>
                  <option value="5">X-Large</option>
                </select>

                <div className="w-px h-5 bg-analog-border mx-1" />

                <button
                  onClick={() => execCmd('bold')}
                  title="Bold"
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-analog-hover text-analog-text-muted hover:text-analog-text transition-colors font-bold text-sm"
                >B</button>

                <button
                  onClick={() => execCmd('italic')}
                  title="Italic"
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-analog-hover text-analog-text-muted hover:text-analog-text transition-colors italic text-sm"
                >I</button>

                <button
                  onClick={() => execCmd('underline')}
                  title="Underline"
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-analog-hover text-analog-text-muted hover:text-analog-text transition-colors underline text-sm"
                >U</button>

                <div className="w-px h-5 bg-analog-border mx-1" />

                <button
                  onClick={() => execCmd('insertUnorderedList')}
                  title="Bullet list"
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-analog-hover text-analog-text-muted hover:text-analog-text transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <line x1="8" y1="6" x2="21" y2="6"/>
                    <line x1="8" y1="12" x2="21" y2="12"/>
                    <line x1="8" y1="18" x2="21" y2="18"/>
                    <line x1="3" y1="6" x2="3.01" y2="6"/>
                    <line x1="3" y1="12" x2="3.01" y2="12"/>
                    <line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                </button>

                <button
                  onClick={() => execCmd('insertOrderedList')}
                  title="Numbered list"
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-analog-hover text-analog-text-muted hover:text-analog-text transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <line x1="10" y1="6" x2="21" y2="6"/>
                    <line x1="10" y1="12" x2="21" y2="12"/>
                    <line x1="10" y1="18" x2="21" y2="18"/>
                    <path d="M4 6h1v4"/>
                    <path d="M4 10h2"/>
                    <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>
                  </svg>
                </button>

                <div className="w-px h-5 bg-analog-border mx-1" />

                <button
                  onClick={() => execCmd('justifyLeft')}
                  title="Align left"
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-analog-hover text-analog-text-muted hover:text-analog-text transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <line x1="3" y1="12" x2="15" y2="12"/>
                    <line x1="3" y1="18" x2="18" y2="18"/>
                  </svg>
                </button>

                <button
                  onClick={() => execCmd('justifyCenter')}
                  title="Align center"
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-analog-hover text-analog-text-muted hover:text-analog-text transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <line x1="6" y1="12" x2="18" y2="12"/>
                    <line x1="4" y1="18" x2="20" y2="18"/>
                  </svg>
                </button>

                <div className="w-px h-5 bg-analog-border mx-1" />

                {/* Attach file */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file"
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-analog-hover text-analog-text-muted hover:text-analog-text transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const newFiles = Array.from(e.target.files || []);
                    const combined = [...attachments, ...newFiles];
                    const v = validateEmailAttachments(combined);
                    if (!v.ok) { alert(v.error); e.target.value = ''; return; }
                    setAttachments(combined);
                    e.target.value = '';
                  }}
                />

              </div>

              {/* Rich text editor */}
              <div className="px-4 py-3 min-h-[200px]">
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={checkSkuTrigger}
                  onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') checkSkuTrigger(); }}
                  className="w-full min-h-[220px] bg-transparent text-sm text-[#202124] focus:outline-none leading-relaxed"
                  style={{ wordBreak: 'break-word' }}
                  data-placeholder="Write your message...  (type /sku: to link a product)"
                />
                {skuQuery !== null && (
                  <SkuPicker
                    fixed
                    searchQuery={skuQuery}
                    position={skuPos}
                    onSelect={insertSkuLink}
                    onClose={() => { setSkuQuery(null); skuAnchorRef.current = null; }}
                  />
                )}
              </div>

              {/* Attachment list */}
              {attachments.length > 0 && (
                <div className="px-5 py-3 border-t border-analog-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-analog-text-faint">
                      {attachments.length} file{attachments.length !== 1 ? 's' : ''} ({formatFileSize(getTotalSize(attachments))} of 25 MB)
                    </span>
                    {getTotalSize(attachments) > MAX_EMAIL_TOTAL_BYTES * 0.9 && (
                      <span className="text-xs font-medium text-amber-600">Approaching size limit</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((f, i) => {
                      const risky = isRiskyFile(f.name);
                      return (
                        <div key={i} className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-xs ${risky ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-analog-surface-alt border-analog-border text-analog-text-muted'}`}>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          <span className="truncate max-w-[140px]" title={f.name}>{f.name}</span>
                          <span className="text-analog-text-faint">({formatFileSize(f.size)})</span>
                          {risky && <span title="Gmail may reject this file type">⚠</span>}
                          <button
                            onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                            className="ml-1 text-analog-text-faint hover:text-analog-error transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* SMS / WhatsApp compose */
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-analog-text-faint mb-1.5">
                  {isWhatsApp ? 'WhatsApp Number' : 'Phone Number'}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="input w-full"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-analog-text-faint mb-1.5">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type your message..."
                  rows={6}
                  className="input w-full resize-none"
                />
              </div>
              {(isSms || isWhatsApp) && (
                <div>
                  <label className="block text-xs font-semibold text-analog-text-faint mb-1.5">
                    Media (optional)
                    {isWhatsApp && smsMedia.length > 1 && <span className="text-analog-text-faint normal-case ml-2">— each will be sent as a separate message</span>}
                  </label>
                  {smsMedia.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {smsMedia.map((file, i) => (
                        <div key={i} className="relative">
                          {file.type.startsWith('image/') ? (
                            <img src={smsMediaPreviews[i]} alt={file.name} className="h-20 w-20 object-cover rounded-lg border border-analog-border" />
                          ) : (
                            <div className="h-20 w-20 flex flex-col items-center justify-center rounded-lg border border-analog-border bg-analog-surface-alt p-1">
                              <svg className="w-5 h-5 text-analog-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span className="text-[9px] text-analog-text-muted truncate w-full text-center mt-1">{file.name}</span>
                            </div>
                          )}
                          <button
                            onClick={() => {
                              setSmsMedia(prev => prev.filter((_, j) => j !== i));
                              setSmsMediaPreviews(prev => prev.filter((_, j) => j !== i));
                            }}
                            className="absolute -top-2 -right-2 w-5 h-5 bg-analog-error text-white rounded-full text-xs flex items-center justify-center"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => smsFileInputRef.current?.click()}
                    className="btn btn-secondary text-sm"
                    disabled={isSms ? smsMedia.length >= MAX_SMS_FILES : smsMedia.length >= MAX_WHATSAPP_FILES}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    Attach {isWhatsApp ? 'Files' : 'Images'}
                    {smsMedia.length > 0 && ` (${smsMedia.length}/${isSms ? MAX_SMS_FILES : MAX_WHATSAPP_FILES})`}
                  </button>
                  <input
                    ref={smsFileInputRef}
                    type="file"
                    accept={isSms ? "image/*" : undefined}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      const combined = [...smsMedia, ...files];
                      const max = isSms ? MAX_SMS_FILES : MAX_WHATSAPP_FILES;
                      if (combined.length > max) {
                        alert(`Maximum ${max} files allowed.`);
                        e.target.value = ''; return;
                      }
                      if (isSms) {
                        const v = validateSmsAttachments(combined);
                        if (!v.ok) { alert(v.error); e.target.value = ''; return; }
                      }
                      setSmsMedia(combined);
                      setSmsMediaPreviews([...smsMediaPreviews, ...files.map(f => URL.createObjectURL(f))]);
                      e.target.value = '';
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-1 px-4 py-3 border-t border-[#f1f3f4] flex-shrink-0">
          <button
            onClick={handleSend}
            disabled={sending}
            title="Send (Ctrl/⌘ + Enter)"
            className="h-9 px-6 rounded-full bg-[#0b57d0] text-white text-sm font-medium hover:bg-[#0a4ebb] hover:shadow disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
          {isEmail && (
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              className="p-2 rounded-full text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
          )}
          <TemplatePicker inboxId={inbox.id} onSelect={handleTemplateSelect} variant="icon" />
          <div className="flex-1" />
          <button
            onClick={async () => {
              if (draftId) {
                if (!confirm('Discard this draft?')) return;
                await fetch(`/api/drafts?id=${draftId}`, { method: 'DELETE' });
              }
              onClose();
            }}
            title="Discard draft"
            className="p-2 rounded-full text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
