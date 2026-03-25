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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
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
            sent_at: m.sent_at
          })),
          senderEmail: inboundMessage.from_address,
          senderName: inboundMessage.from_name
        })
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

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function handleTemplateSelect(template: Template) {
    setReplyBody(template.body);
    if (!showComposer) setShowComposer(true);
  }

  async function handleMarkUnread() {
    await supabase.from('email_threads').update({ is_read: false }).eq('id', threadId);
    setOpenMenuId(null);
  }

  async function handleDelete() {
    if (!confirm('Delete this thread? This cannot be undone.')) return;
    await supabase.from('email_threads').update({ deleted_at: new Date().toISOString() }).eq('id', threadId);
    setOpenMenuId(null);
  }

  function handlePrint() {
    window.print();
    setOpenMenuId(null);
  }

  function handleForward(message: EmailMessageWithUser) {
    const fwdBody = `<br/><br/>---------- Forwarded message ----------<br/>${message.body_html || message.body_text || ''}`;
    setReplyBody(fwdBody);
    setOpenMenuId(null);
  }

  async function handleResend(message: EmailMessageWithUser) {
    const response = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, body: message.body_html || message.body_text || '' }),
    });
    if (response.ok) {
      await loadMessages();
    }
    setOpenMenuId(null);
  }

  async function handleResendAsNew(message: EmailMessageWithUser) {
    const response = await fetch('/api/emails/send-new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inboxId: thread?.inbox_id,
        to: message.to_addresses?.[0] || '',
        subject: thread?.subject || '',
        body: message.body_html || message.body_text || '',
      }),
    });
    if (response.ok) {
      alert('Sent as new conversation.');
    }
    setOpenMenuId(null);
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

  // Priority: customer linked name > sender name > sender email
  const headerName = customerLinkedName || senderName || senderEmail || '';
  const headerSubtitle = customerLinkedName
    ? (senderName ? `${senderName} • ${senderEmail}` : senderEmail)
    : senderEmail;

  return (
    <div className="flex-1 flex flex-row h-screen bg-analog-surface overflow-hidden">

      {/* Main thread column */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">

        {/* Header */}
        <div className="px-8 py-5 border-b-2 border-analog-border-strong bg-analog-surface">
          <h2 className="font-display text-2xl font-medium text-analog-text mb-4">
            {thread.subject || '(No subject)'}
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="avatar avatar-lg avatar-blue font-display">
                {headerName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-[15px] text-analog-text">
                  {headerName}
                </p>
                {headerSubtitle && headerSubtitle !== headerName && (
                  <p className="text-[13px] text-analog-text-faint">
                    {headerSubtitle}
                  </p>
                )}
              </div>
            </div>

            {/* Presence Badge */}
            {(drafting.length > 0 || viewing.length > 0) && (
              <div className="flex items-center gap-2 px-3.5 py-2 bg-analog-hover border border-analog-border rounded-lg">
                <div 
                  className="presence-dot"
                  style={{ background: drafting.length > 0 ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}
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
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-4xl space-y-5">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`bg-analog-surface-alt border rounded-lg overflow-hidden ${
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

                  {/* Actions Menu */}
                  <div className="relative">
                    <button
                      onClick={() => setOpenMenuId(openMenuId === message.id ? null : message.id)}
                      className="p-1.5 rounded-lg text-analog-text-muted hover:text-analog-text hover:bg-analog-hover transition-all"
                      title="More actions"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                      </svg>
                    </button>
                    {openMenuId === message.id && (
                      <div className="absolute right-0 top-8 z-50 w-64 bg-white border border-analog-border rounded-xl shadow-lg overflow-hidden">
                        <button onClick={() => handleForward(message)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-analog-text hover:bg-analog-hover transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                          Forward
                        </button>
                        <button onClick={() => handleResend(message)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-analog-text hover:bg-analog-hover transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                          Resend
                        </button>
                        <button onClick={() => handleResendAsNew(message)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-analog-text hover:bg-analog-hover transition-colors">
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                          <span className="whitespace-nowrap">Resend as New Conversation</span>
                        </button>
                        <div className="border-t border-analog-border my-1"/>
                        <button onClick={handleMarkUnread} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-analog-text hover:bg-analog-hover transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                          Mark as Unread
                        </button>
                        <button onClick={handleDelete} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          Delete
                        </button>
                        <button onClick={handlePrint} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-analog-text hover:bg-analog-hover transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                          Print
                        </button>
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
              </div>
            ))}
          </div>

        </div>

        {/* Composer */}
        <div className="border-t-2 border-analog-border-strong bg-analog-surface-alt px-8 py-5">
          {(
            <div className="space-y-4">
              <div className="space-y-2">
                {!showCcBcc ? (
                  <button
                    onClick={() => setShowCcBcc(true)}
                    className="text-sm text-analog-accent hover:underline"
                  >
                    Add Cc/Bcc
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-analog-text-muted w-10">Cc:</label>
                      <input
                        type="text"
                        value={ccField}
                        onChange={(e) => setCcField(e.target.value)}
                        placeholder="email@example.com, another@example.com"
                        className="input flex-1 py-2 text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-analog-text-muted w-10">Bcc:</label>
                      <input
                        type="text"
                        value={bccField}
                        onChange={(e) => setBccField(e.target.value)}
                        placeholder="email@example.com, another@example.com"
                        className="input flex-1 py-2 text-sm"
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
      <div className="w-72 flex-shrink-0 border-l border-stone-200 bg-white flex flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-5 border-b border-stone-200" style={{maxHeight: '50%'}}>
          <CustomerCard email={senderEmail} onCustomerLinked={(name) => setCustomerLinkedName(name)} />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5" style={{maxHeight: '50%'}}>
          <CommentSection threadId={threadId} currentUser={currentUser} />
        </div>
      </div>

    </div>
  );
}
