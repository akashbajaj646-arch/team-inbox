'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { EmailThread, EmailMessage, ThreadPresence, User, Template } from '@/types';
import CommentSection from './CommentSection';
import TemplatePicker from './TemplatePicker';
import RichTextEditor from './RichTextEditor';
import CustomerCard from './CustomerCard';

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

export default function ThreadView({ threadId, currentUser }: ThreadViewProps) {
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [messages, setMessages] = useState<EmailMessageWithUser[]>([]);
  const [presence, setPresence] = useState<ThreadPresence[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showComposer, setShowComposer] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [ccField, setCcField] = useState('');
  const [bccField, setBccField] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [customerLinkedName, setCustomerLinkedName] = useState<string | null>(null);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const [messageAttachments, setMessageAttachments] = useState<Record<string, EmailAttachment[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  useEffect(() => {
    loadThread();
    updatePresence('viewing');

    const messageChannel = supabase
      .channel(`messages:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          loadMessages();
        }
      )
      .subscribe();

    const presenceChannel = supabase
      .channel(`presence:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'thread_presence',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          loadPresence();
        }
      )
      .subscribe();

    return () => {
      clearPresence();
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(presenceChannel);
    };
  }, [threadId]);

  useEffect(() => {
    if (showComposer && replyBody.length > 0) {
      updatePresence('drafting');
    } else if (showComposer) {
      updatePresence('viewing');
    }
  }, [showComposer, replyBody]);

  async function loadThread() {
    setLoading(true);

    const { data: threadData } = await supabase
      .from('email_threads')
      .select('*')
      .eq('id', threadId)
      .single();

    setThread(threadData);
    await loadMessages();
    await loadPresence();
    setLoading(false);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from('email_messages')
      .select(`
        *,
        sent_by:inbox_users(id, name, email, avatar_url)
      `)
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: true });

    setMessages(data || []);

    // Fetch non-inline attachments for all messages
    if (data && data.length > 0) {
      await loadAttachmentsForMessages(data.map((m: any) => m.id));
    }
  }

  async function loadAttachmentsForMessages(messageIds: string[]) {
    if (messageIds.length === 0) return;

    const { data } = await supabase
      .from('email_attachments')
      .select('id, message_id, filename, mime_type, size, is_inline')
      .in('message_id', messageIds)
      .eq('is_inline', false)
      .order('filename', { ascending: true });

    if (data) {
      const byMessage: Record<string, EmailAttachment[]> = {};
      data.forEach((att: EmailAttachment) => {
        if (!byMessage[att.message_id]) byMessage[att.message_id] = [];
        byMessage[att.message_id].push(att);
      });
      setMessageAttachments(byMessage);
    }
  }

  async function loadPresence() {
    const { data } = await supabase
      .from('thread_presence')
      .select(`
        *,
        user:inbox_users(id, name, email, avatar_url)
      `)
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
    await fetch(`/api/presence?threadId=${threadId}`, {
      method: 'DELETE',
    });
  }

  async function handleSend() {
    if (!replyBody.trim() || replyBody === '<p></p>') return;

    setSending(true);

    try {
      const uploadedAttachments: { filename: string; mimeType: string; data: string }[] = [];

      for (const attachment of attachments) {
        const base64 = await fileToBase64(attachment.file);
        uploadedAttachments.push({
          filename: attachment.name,
          mimeType: attachment.type,
          data: base64,
        });
      }

      const response = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          body: replyBody,
          attachments: uploadedAttachments,
          cc: ccField.trim() || undefined,
          bcc: bccField.trim() || undefined,
        }),
      });

      if (response.ok) {
        setReplyBody('');
        setAttachments([]);
        setCcField('');
        setBccField('');
        setShowCcBcc(false);
        setShowComposer(false);
        await loadMessages();
      }
    } catch (err) {
      console.error('Send error:', err);
    }

    setSending(false);
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 10 * 1024 * 1024) {
        alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
        continue;
      }
      newAttachments.push({ file, name: file.name, size: file.size, type: file.type });
    }

    setAttachments([...attachments, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachment(index: number) {
    setAttachments(attachments.filter((_, i) => i !== index));
  }

  async function handleDownloadAll(atts: EmailAttachment[]) {
    for (const att of atts) {
      const a = document.createElement('a');
      a.href = `/api/gmail/attachment?id=${att.id}`;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Stagger downloads so the browser doesn't block them
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  async function handleAiAssist() {
    if (!thread || messages.length === 0) return;

    setAiLoading(true);
    setShowComposer(true);

    try {
      const inboundMessage = messages.find(m => !m.is_outbound) || messages[0];

      const response = await fetch('/api/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadSubject: thread.subject,
          messages: messages.map(m => ({
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
        setReplyBody(htmlDraft);
      } else if (data.error) {
        alert('Failed to generate AI draft. Please try again.');
      }
    } catch (error) {
      alert('Failed to generate AI draft. Please try again.');
    }

    setAiLoading(false);
  }

  async function handleMarkUnread(messageId: string) {
    await fetch('/api/emails/mark-unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId }),
    });
    setActiveActionMenu(null);
    loadThread();
  }

  async function handleDeleteMessage(messageId: string) {
    if (!confirm('Delete this message?')) return;
    const supabase2 = createClient();
    await supabase2.from('email_messages').delete().eq('id', messageId);
    setActiveActionMenu(null);
    loadMessages();
  }

  function handleForwardMessage(message: EmailMessageWithUser) {
    const fwdBody = `<br/><br/>---------- Forwarded message ----------<br/>From: ${message.from_name || message.from_address}<br/><br/>${message.body_html || message.body_text || ''}` ;
    setReplyBody(fwdBody);
    setShowComposer(true);
    setActiveActionMenu(null);
  }

  async function handleResendMessage(message: EmailMessageWithUser) {
    if (!thread) return;
    await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: thread.id, body: message.body_html || message.body_text || '' }),
    });
    setActiveActionMenu(null);
  }

  function handlePrintMessage(message: EmailMessageWithUser) {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><body>${message.body_html || message.body_text || ''}</body></html>`);
    w.document.close();
    w.print();
    setActiveActionMenu(null);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function handleTemplateSelect(template: Template) {
    setReplyBody(template.body);
    if (!showComposer) setShowComposer(true);
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function getInitials(name: string | null | undefined, email: string): string {
    if (name) {
      const parts = name.trim().split(' ');
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return parts[0][0].toUpperCase();
    }
    return email.charAt(0).toUpperCase();
  }

  const BUBBLE_COLORS = [
    'bg-violet-500', 'bg-blue-500', 'bg-emerald-500',
    'bg-orange-500', 'bg-pink-500', 'bg-teal-500',
  ];

  function getBubbleColor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return BUBBLE_COLORS[Math.abs(hash) % BUBBLE_COLORS.length];
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-analog-text-muted bg-analog-surface">
        Loading...
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center text-analog-text-muted bg-analog-surface">
        Email not found
      </div>
    );
  }

  const drafting = presence.filter((p) => p.status === 'drafting');
  const viewing = presence.filter((p) => p.status === 'viewing');
  const senderEmail = messages.find(m => !m.is_outbound)?.from_address || messages[0]?.from_address;
  const senderName = messages.find(m => !m.is_outbound)?.from_name || messages[0]?.from_name;

  const headerName = customerLinkedName || senderName || senderEmail || '';
  const headerSubtitle = customerLinkedName
    ? (senderName ? senderName : senderEmail) || ''
    : senderEmail || '';

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main thread column */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Thread header */}
        <div className="px-8 py-4 border-b-2 border-analog-border-strong bg-analog-surface flex items-center gap-4 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-lg font-semibold text-analog-text truncate">
              {thread.subject || '(No subject)'}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm text-analog-text-muted truncate">{headerName}</p>
              {headerSubtitle && headerSubtitle !== headerName && (
                <span className="text-analog-text-faint text-sm">· {headerSubtitle}</span>
              )}
            </div>
          </div>

          {/* Presence indicators */}
          {(drafting.length > 0 || viewing.length > 0) && (
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: drafting.length > 0 ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}
              />
              <span className="text-xs font-medium" style={{ color: drafting.length > 0 ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}>
                {drafting.length > 0
                  ? `${drafting.map((p) => p.user?.name?.split(' ')[0] || 'Someone').join(', ')} is drafting`
                  : `${viewing.map((p) => p.user?.name?.split(' ')[0] || 'Someone').join(', ')} is viewing`}
              </span>
            </div>
          )}

          {/* Open in New Window */}
          <button
            onClick={() => window.open(`/email/${threadId}`, '_blank', 'noopener,noreferrer')}
            className="p-2 text-analog-text-muted hover:text-analog-accent hover:bg-analog-hover rounded-lg transition-all duration-150"
            title="Open in new window"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-4xl space-y-5">
            {messages.map((message) => {
              const msgAttachments = messageAttachments[message.id] || [];

              return (
                <div
                  key={message.id}
                  className={`group bg-analog-surface-alt border rounded-lg overflow-hidden ${
                    message.is_outbound
                      ? 'border-analog-accent border-l-4'
                      : 'border-analog-border'
                  }`}
                >
                  {/* Message Header */}
                  <div className={`px-5 py-4 border-b border-analog-border flex items-center gap-3 ${
                    message.is_outbound ? 'bg-[#FDF8F7]' : 'bg-analog-surface'
                  }`}>
                    <div className={`avatar avatar-md font-display ${
                      message.is_outbound ? 'avatar-red' : 'avatar-blue'
                    }`}>
                      {(message.from_name || message.from_address).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm text-analog-text">
                        {message.from_name || message.from_address}
                      </p>
                    </div>

                    {message.is_outbound && message.sent_by && (
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${getBubbleColor(message.sent_by.id)}`}
                          title={message.sent_by.name || message.sent_by.email}
                        >
                          {getInitials(message.sent_by.name, message.sent_by.email)}
                        </div>
                        <span className="text-xs text-analog-text-muted">
                          {message.sent_by.name?.split(' ')[0] || message.sent_by.email.split('@')[0]}
                        </span>
                      </div>
                    )}

                    <span className="text-xs text-analog-text-placeholder">
                      {formatDate(message.sent_at)}
                    </span>

                  {/* Action menu */}
                  <div className="relative">
                    <button
                      onClick={() => setActiveActionMenu(activeActionMenu === message.id ? null : message.id)}
                      className="p-1.5 rounded-md text-analog-text-faint hover:text-analog-text hover:bg-analog-hover transition-all"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
                      </svg>
                    </button>
                    {activeActionMenu === message.id && (
                      <div className="absolute right-0 top-8 w-48 bg-analog-surface border border-analog-border-strong rounded-xl shadow-analog-lg z-50 overflow-hidden">
                        {[
                          { label: "Forward", fn: () => handleForwardMessage(message) },
                          { label: "Resend", fn: () => handleResendMessage(message) },
                          { label: "Mark Unread", fn: () => handleMarkUnread(message.id) },
                          { label: "Print", fn: () => handlePrintMessage(message) },
                          { label: "Delete", fn: () => handleDeleteMessage(message.id), danger: true },
                        ].map(({ label, fn, danger }) => (
                          <button
                            key={label}
                            onClick={fn}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-analog-hover transition-colors ${danger ? "text-red-500" : "text-analog-text"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>

                  {/* Message Body */}
                  <div className="px-5 py-5 overflow-x-auto">
                    {message.body_html ? (
                      <div
                        className="email-prose"
                        dangerouslySetInnerHTML={{ __html: message.body_html }}
                      />
                    ) : (
                      <p className="font-body text-[15px] leading-relaxed text-analog-text-secondary whitespace-pre-wrap">
                        {message.body_text}
                      </p>
                    )}
                  </div>

                  {/* Attachments */}
                  {msgAttachments.length > 0 && (
                    <div className="px-5 pb-4 pt-3 border-t border-analog-border">
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-[11px] font-semibold text-analog-text-faint uppercase tracking-wider">
                          {msgAttachments.length} Attachment{msgAttachments.length > 1 ? 's' : ''}
                        </span>
                        {msgAttachments.length > 1 && (
                          <button
                            onClick={() => handleDownloadAll(msgAttachments)}
                            className="text-xs text-analog-accent hover:underline font-medium flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
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
                            className="flex items-center gap-2 px-3 py-2 bg-analog-surface border border-analog-border rounded-lg text-sm hover:bg-analog-hover hover:border-analog-accent transition-all duration-150 group"
                          >
                            <svg className="w-4 h-4 text-analog-text-muted group-hover:text-analog-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                            <span className="text-analog-text truncate max-w-[180px]">{att.filename}</span>
                            <span className="text-analog-text-faint text-xs flex-shrink-0">({formatFileSize(att.size)})</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>


        </div>

        {/* Composer */}
        <div className="border-t-2 border-analog-border-strong bg-analog-surface-alt px-8 py-5">
          {!showComposer ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowComposer(true)}
                className="flex-1 px-5 py-3.5 bg-analog-surface border border-analog-border rounded-lg text-analog-text-placeholder text-left hover:border-analog-accent transition-all duration-150"
              >
                Write a reply...
              </button>
              <button
                onClick={handleAiAssist}
                disabled={aiLoading}
                className="px-4 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg font-medium hover:from-purple-700 hover:to-indigo-700 transition-all duration-150 flex items-center gap-2 disabled:opacity-50"
              >
                {aiLoading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Drafting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                    </svg>
                    AI Assist
                  </>
                )}
              </button>
              {thread && (
                <TemplatePicker
                  inboxId={thread.inbox_id}
                  onSelect={handleTemplateSelect}
                />
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                {!showCcBcc ? (
                  <button
                    onClick={() => setShowCcBcc(true)}
                    className="text-xs text-analog-text-faint hover:text-analog-accent transition-colors"
                  >
                    + Add Cc / Bcc
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 px-3 py-2 bg-analog-surface border border-analog-border rounded-lg">
                      <span className="text-xs font-semibold text-analog-text-faint w-8 flex-shrink-0">Cc</span>
                      <input
                        type="text"
                        value={ccField}
                        onChange={(e) => setCcField(e.target.value)}
                        placeholder="cc@example.com"
                        className="flex-1 bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2 bg-analog-surface border border-analog-border rounded-lg">
                      <span className="text-xs font-semibold text-analog-text-faint w-8 flex-shrink-0">Bcc</span>
                      <input
                        type="text"
                        value={bccField}
                        onChange={(e) => setBccField(e.target.value)}
                        placeholder="bcc@example.com"
                        className="flex-1 bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              <RichTextEditor
                content={replyBody}
                onChange={setReplyBody}
                placeholder="Write your reply..."
              />

              {/* Reply attachments */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((attachment, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 px-3 py-2 bg-analog-surface border border-analog-border rounded-lg text-sm"
                    >
                      <svg className="w-4 h-4 text-analog-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <span className="text-analog-text truncate max-w-[150px]">{attachment.name}</span>
                      <span className="text-analog-text-faint">({formatFileSize(attachment.size)})</span>
                      <button
                        onClick={() => removeAttachment(index)}
                        className="p-0.5 text-analog-text-muted hover:text-analog-error transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setShowComposer(false);
                      setReplyBody('');
                      setAttachments([]);
                    }}
                    className="px-4 py-2 text-analog-text-muted hover:text-analog-text transition-colors"
                  >
                    Cancel
                  </button>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    multiple
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="btn btn-secondary"
                    title="Add attachment"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    Attach
                  </button>

                  {thread && (
                    <TemplatePicker
                      inboxId={thread.inbox_id}
                      onSelect={handleTemplateSelect}
                    />
                  )}
                </div>
                <button
                  onClick={handleSend}
                  disabled={!replyBody.trim() || replyBody === '<p></p>' || sending}
                  className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {sending ? 'Sending...' : 'Send Reply'}
                </button>
              </div>
            </div>
          )}
        </div>

      </div>{/* end main thread column */}

      {/* Right sidebar */}
      <div className="w-72 flex-shrink-0 bg-analog-surface-alt flex flex-col">
        <div className="overflow-y-auto px-4 py-5 border-b border-stone-200" style={{maxHeight: '50%'}}>
          <CustomerCard email={senderEmail} onCustomerLinked={(name) => setCustomerLinkedName(name)} />
        </div>
        <div className="overflow-y-auto px-4 py-5 flex-1">
          <CommentSection threadId={threadId} currentUser={currentUser} />
        </div>
      </div>

    </div>
  );
}
