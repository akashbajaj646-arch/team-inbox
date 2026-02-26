'use client';

import { useState } from 'react';
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

  // Email fields
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // SMS / WhatsApp fields
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setError(null);
    setSending(true);

    try {
      if (isEmail) {
        if (!to.trim() || !subject.trim() || !body.trim()) {
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
            body,
            isNew: true,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to send email');
        }
      } else {
        // SMS or WhatsApp
        if (!phone.trim() || !message.trim()) {
          setError('Phone number and message are required.');
          setSending(false);
          return;
        }

        const res = await fetch('/api/sms/send-new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inboxId: inbox.id,
            toPhone: phone.trim(),
            body: message.trim(),
            channel: isWhatsApp ? 'whatsapp' : 'sms',
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to send message');
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative pointer-events-auto w-[560px] max-h-[80vh] bg-analog-surface border-2 border-analog-border-strong rounded-2xl shadow-2xl flex flex-col overflow-hidden">
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
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-analog-text-muted hover:text-analog-text hover:bg-analog-hover transition-all"
          >
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
                  <button
                    onClick={() => setShowCc(true)}
                    className="text-xs text-analog-text-faint hover:text-analog-accent transition-colors"
                  >
                    Cc
                  </button>
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

              {/* Body */}
              <div className="px-5 py-4 min-h-[200px]">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your message..."
                  className="w-full h-48 bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none resize-none leading-relaxed"
                />
              </div>
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
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={`Write your ${channelLabel} message...`}
                  className="w-full h-48 bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none resize-none leading-relaxed"
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
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-analog-text-muted hover:text-analog-text transition-colors"
            >
              Discard
            </button>
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
    </div>
  );
}
