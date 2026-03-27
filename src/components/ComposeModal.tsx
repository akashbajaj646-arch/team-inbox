'use client';

import { useState, useRef } from 'react';
import type { Inbox, User } from '@/types';
import TemplatePicker from './TemplatePicker';

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

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [smsMedia, setSmsMedia] = useState<File | null>(null);
  const [smsMediaPreview, setSmsMediaPreview] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState('3');

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const smsFileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleSend() {
    setError(null);
    setSending(true);
    try {
      if (isEmail) {
        const bodyHtml = editorRef.current?.innerHTML || '';
        const bodyText = editorRef.current?.innerText || '';
        if (!to.trim() || !subject.trim() || !bodyText.trim()) {
          setError('To, Subject, and Body are required.');
          setSending(false);
          return;
        }
        const res = await fetch('/api/emails/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inboxId: inbox.id,
            to: to.trim(),
            cc: cc.trim() || undefined,
            subject: subject.trim(),
            body: bodyHtml,
            isNew: true,
          }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to send email');
        }
      } else {
        if (!phone.trim() || (!message.trim() && !smsMedia)) {
          setError('Phone number and message or media are required.');
          setSending(false);
          return;
        }
        let mediaUrls: string[] = [];
        if (smsMedia) {
          const { createClient } = await import('@/lib/supabase/client');
          const supabase = createClient();
          const ext = smsMedia.name.split('.').pop();
          const filename = `sms-media/${Date.now()}.${ext}`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('attachments')
            .upload(filename, smsMedia);
          if (uploadError) throw uploadError;
          const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(filename);
          mediaUrls = [publicUrl];
        }
        const res = await fetch('/api/sms/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inboxId: inbox.id,
            to: phone.trim(),
            body: message.trim(),
            mediaUrls,
          }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to send message');
        }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-analog-surface rounded-2xl shadow-analog-lg border-2 border-analog-border-strong w-full max-w-2xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b-2 border-analog-border-strong bg-analog-surface-alt">
          <div className="w-9 h-9 rounded-lg bg-analog-accent flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-sm text-analog-text">New Email</p>
            <p className="text-xs text-analog-text-muted">{inbox.email_address}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-2 text-analog-text-muted hover:text-analog-text hover:bg-analog-hover rounded-lg transition-all duration-150"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

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
                    setAttachments(prev => [...prev, ...Array.from(e.target.files || [])]);
                    e.target.value = '';
                  }}
                />

                <div className="w-px h-5 bg-analog-border mx-1" />

                {/* Templates */}
                <TemplatePicker
                  inboxId={inbox.id}
                  onSelect={handleTemplateSelect}
                />
              </div>

              {/* Rich text editor */}
              <div className="px-5 py-4 min-h-[200px]">
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="w-full min-h-[180px] bg-transparent text-sm text-analog-text focus:outline-none leading-relaxed"
                  style={{ wordBreak: 'break-word' }}
                  data-placeholder="Write your message..."
                />
              </div>

              {/* Attachment list */}
              {attachments.length > 0 && (
                <div className="px-5 py-3 border-t border-analog-border flex flex-wrap gap-2">
                  {attachments.map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-analog-surface-alt border border-analog-border rounded-lg px-2.5 py-1.5 text-xs text-analog-text-muted">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <span className="truncate max-w-[120px]">{f.name}</span>
                      <span className="text-analog-text-faint">({formatFileSize(f.size)})</span>
                      <button
                        onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                        className="ml-1 text-analog-text-faint hover:text-analog-error transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
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
              {isSms && (
                <div>
                  <label className="block text-xs font-semibold text-analog-text-faint mb-1.5">Media (optional)</label>
                  {smsMediaPreview ? (
                    <div className="relative inline-block">
                      <img src={smsMediaPreview} alt="Preview" className="h-24 rounded-lg border border-analog-border" />
                      <button
                        onClick={() => { setSmsMedia(null); setSmsMediaPreview(null); }}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-analog-error text-white rounded-full text-xs flex items-center justify-center"
                      >×</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => smsFileInputRef.current?.click()}
                      className="btn btn-secondary text-sm"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      Attach Image
                    </button>
                  )}
                  <input
                    ref={smsFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setSmsMedia(file);
                        setSmsMediaPreview(URL.createObjectURL(file));
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t-2 border-analog-border-strong bg-analog-surface-alt">
          <button
            onClick={onClose}
            className="px-4 py-2 text-analog-text-muted hover:text-analog-text transition-colors text-sm font-medium"
          >
            Discard
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="btn btn-primary disabled:opacity-50"
          >
            {sending ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Sending...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Send
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
