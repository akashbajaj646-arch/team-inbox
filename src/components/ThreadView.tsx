'use client';

import { useState, useEffect, useRef } from 'react';
import { useResizable } from '@/hooks/useResizable';
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

interface EmailAttachment {
  id: string;
  filename: string;
  mime_type: string | null;
  size: number | null;
}

interface EmailMessageWithUser extends EmailMessage {
  sent_by?: SentByUser | null;
  attachments?: EmailAttachment[];
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
  const [showComposer, setShowComposer] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [ccField, setCcField] = useState('');
  const [bccField, setBccField] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [customerSidebarCollapsed, setCustomerSidebarCollapsed] = useState(false);
  const { elementRef: customerSidebarRef, startResize: startCustomerResize } = useResizable(288, 200, 480, 'customer-sidebar-width');
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

    // Mark as read when opened
    if (threadData && !threadData.is_read) {
      await supabase
        .from('email_threads')
        .update({ is_read: true })
        .eq('id', threadId);
    }

    setLoading(false);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from('email_messages')
      .select(`
        *,
        sent_by:inbox_users(id, name, email, avatar_url),
        attachments:email_attachments(id, filename, mime_type, size)
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
                {messages[messages.length - 1]?.from_name?.charAt(0) || 
                 messages[messages.length - 1]?.from_address?.charAt(0) || '?'}
              </div>
              <div>
                <p className="font-semibold text-[15px] text-analog-text">
                  {messages[messages.length - 1]?.from_name || messages[messages.length - 1]?.from_address}
                </p>
                <p className="text-[13px] text-analog-text-faint">
                  {messages[messages.length - 1]?.from_address}
                </p>
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
                {message.attachments && message.attachments.length > 0 && (
                  <div className="px-5 pb-4 border-t border-analog-border-light pt-3">
                    <p className="text-xs font-semibold text-analog-text-muted uppercase tracking-wider mb-2">
                      {message.attachments.length} Attachment{message.attachments.length !== 1 ? 's' : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {message.attachments.map((att: any) => (
                        <a
                          key={att.id}
                          href={`/api/gmail/attachment?id=${att.id}`}
                          download={att.filename}
                          className="flex items-center gap-2 px-3 py-2 bg-analog-surface border border-analog-border rounded-lg text-sm hover:border-analog-accent transition-colors group"
                        >
                          <svg className="w-4 h-4 text-analog-text-muted group-hover:text-analog-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          <span className="text-analog-text truncate max-w-[180px]">{att.filename}</span>
                          {att.size > 0 && (
                            <span className="text-analog-text-faint text-xs">
                              ({att.size < 1024 ? att.size + 'B' : att.size < 1048576 ? (att.size/1024).toFixed(0) + 'KB' : (att.size/1048576).toFixed(1) + 'MB'})
                            </span>
                          )}
                          <svg className="w-3.5 h-3.5 text-analog-text-faint group-hover:text-analog-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div ref={messagesEndRef} />
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

        {/* Team Discussion - fixed at bottom */}
        <div className="border-t-2 border-analog-border-strong bg-analog-surface px-8 py-4 flex-shrink-0 h-56 overflow-y-auto">
          <CommentSection threadId={threadId} currentUser={currentUser} />
        </div>

      </div>{/* end main thread column */}

      {/* Right sidebar - collapsible + resizable */}
      <div className="relative flex flex-shrink-0">
        {/* Collapse toggle button */}
        <button
          onClick={() => setCustomerSidebarCollapsed(!customerSidebarCollapsed)}
          className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 w-6 h-10 bg-analog-surface border border-analog-border rounded-full flex items-center justify-center text-analog-text-muted hover:text-analog-accent hover:border-analog-accent transition-all shadow-sm"
          title={customerSidebarCollapsed ? 'Show customer panel' : 'Hide customer panel'}
        >
          <svg className={`w-3 h-3 transition-transform ${customerSidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {!customerSidebarCollapsed && (
          <div ref={customerSidebarRef} className="border-l border-stone-200 bg-white overflow-y-auto px-4 py-5 relative" style={{width: 288}}>
            {/* Resize handle on left edge */}
            <div
              onMouseDown={startCustomerResize}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-analog-accent/30 transition-colors z-10"
            />
            <CustomerCard email={senderEmail} />
          </div>
        )}
      </div>

    </div>
  );
}
