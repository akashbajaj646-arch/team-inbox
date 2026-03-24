'use client';

import { useState, useRef } from 'react';
import type { Inbox, User } from '@/types';

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
        const res = await fetch('/api/emails/send-new', {
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
          const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from('sms-media')
            .upload(filename, smsMedia, { contentType: smsMedia.type, upsert: false });
          if (uploadError) throw new Error('Failed to upload image');
          const { data: { publicUrl } } = supabase.storage.from('sms-media').getPublicUrl(filename);
          mediaUrls = [publicUrl];
        }
        const res = await fetch('/api/sms/send-new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inboxId: inbox.id,
            toPhone: phone.trim(),
            body: message.trim() || undefined,
            mediaUrls: mediaUrls.length ? mediaUrls : undefined,
            channel: isWhatsApp ? 'whatsapp' : 'sms',
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
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const channelLabel = isEmail ? 'Email' : isWhatsApp ? 'WhatsApp' : 'SMS';

  const channelIcon = isEmail ? (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ) : isWhatsApp ? (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-6 pointer-events-none">
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto" onClick={onClose} />
      <div className="relative pointer-events-auto w-[620px] max-h-[85vh] bg-analog-surface border-2 border-analog-border-strong rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-analog-border bg-analog-surface-alt">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-analog-accent to-analog-accent-light flex items-center justify-center text-white">
              {channelIcon}
            </div>
            <div>
              <p className="font-semibold text-analog-text text-sm">New {channelLabel}</p>
              <p className="text-xs text-analog-text-faint">{inbox.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-analog-text-muted hover:text-analog-text hover:bg-analog-hover transition-all">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

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
                      <span className="max-w-[120px] truncate">{f.name}</span>
                      <button
                        onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                        className="text-analog-text-faint hover:text-red-500 ml-0.5"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-analog-border">
              {/* Phone */}
              <div className="flex items-center gap-3 px-5 py-3">
                <span className="text-xs font-semibold text-analog-text-faint w-12 flex-shrink-0">To</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="flex-1 bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none"
                  autoFocus
                />
              </div>

              {/* Message */}
              <div className="px-5 py-4 min-h-[200px]">
                {smsMediaPreview && (
                  <div className="mb-3 relative inline-block">
                    <img src={smsMediaPreview} alt="Preview" className="h-20 rounded-lg border border-analog-border" />
                    <button
                      onClick={() => { setSmsMedia(null); setSmsMediaPreview(null); }}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                    >×</button>
                  </div>
                )}
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={`Write your ${channelLabel} message...`}
                  className="w-full h-40 bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none resize-none leading-relaxed"
                />
                {isWhatsApp && (
                  <p className="text-xs text-analog-text-faint mt-2">
                    Note: WhatsApp requires an approved message template for new conversations (24hr window rule).
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-analog-border bg-analog-surface-alt flex items-center justify-between">
          <div className="flex items-center gap-2">
            {error ? (
              <p className="text-sm text-red-500">{error}</p>
            ) : isSms ? (
              <>
                <input
                  ref={smsFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setSmsMedia(f); setSmsMediaPreview(URL.createObjectURL(f)); }
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => smsFileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-analog-text-muted border border-analog-border rounded-lg hover:bg-analog-hover transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  Attach Image
                </button>
              </>
            ) : <div />}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-analog-text-muted hover:text-analog-text transition-colors">Discard</button>
            <button
              onClick={handleSend}
              disabled={sending}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-gradient-to-br from-analog-accent to-analog-accent-light rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-analog-accent"
            >
              {sending ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
      <style>{`[contenteditable]:empty:before{content:attr(data-placeholder);color:#aaa;pointer-events:none;}`}</style>
    </div>
  );
}
