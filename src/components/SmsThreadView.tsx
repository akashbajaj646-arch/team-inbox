'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SmsThread, SmsMessage, User, Inbox, Contact } from '@/types';
import CommentSection from './CommentSection';
import SkuPicker from './SkuPicker';
import CustomerCard from './CustomerCard';
import TemplatePicker from './TemplatePicker';
import WhatsAppTemplatePicker from './WhatsAppTemplatePicker';

interface Product {
  product_id: string;
  style_number: string;
  description: string | null;
  category: string | null;
  price: number | null;
  image_url: string | null;
}

interface SentByUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

interface SmsMessageWithUser extends SmsMessage {
  sent_by?: SentByUser | null;
}

interface SmsThreadViewProps {
  threadId: string;
  inbox: Inbox;
  currentUser: User;
}

export default function SmsThreadView({ threadId, inbox, currentUser }: SmsThreadViewProps) {
  const [thread, setThread] = useState<SmsThread | null>(null);
  const [messages, setMessages] = useState<SmsMessageWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactDisplayName, setContactDisplayName] = useState<string | null>(null);
  const [customerLinkedName, setCustomerLinkedName] = useState<string | null>(null);
  const [showSkuPicker, setShowSkuPicker] = useState(false);
  const [skuSearchQuery, setSkuSearchQuery] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [contentSid, setContentSid] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supabase = createClient();

  const isWhatsApp = inbox.inbox_type === 'whatsapp';

  useEffect(() => {
    loadThread();
    loadMessages();
    markAsRead();

    const channel = supabase
      .channel(`sms-messages:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sms_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          loadMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  async function loadThread() {
    const { data } = await supabase
      .from('sms_threads')
      .select('*')
      .eq('id', threadId)
      .single();

    if (data) {
      setThread(data);
      setContactName(data.contact_name || '');
      lookupContact(data.contact_phone);
      lookupCustomerLink(data.contact_phone);
    }
  }

  async function lookupCustomerLink(phone: string) {
    if (!phone) return;
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const { data: links } = await supabase
        .from('thread_customer_links')
        .select('customer:customers(customer_name)')
        .not('phone', 'is', null);

      if (links) {
        for (const link of links) {
          const linkPhone = (link as any).phone?.replace(/\D/g, '') || '';
          if (linkPhone === cleanPhone) {
            const customer = Array.isArray(link.customer) ? link.customer[0] : link.customer;
            if (customer?.customer_name) {
              setCustomerLinkedName(customer.customer_name);
              return;
            }
          }
        }
      }
    } catch (err) {
      // Ignore
    }
  }

  async function lookupContact(phone: string) {
    if (!phone) return;
    try {
      const response = await fetch(`/api/contacts?phone=${encodeURIComponent(phone)}`);
      const data = await response.json();
      if (data.contact) {
        const contact = data.contact;
        const parts = [];
        if (contact.first_name) parts.push(contact.first_name);
        if (contact.last_name) parts.push(contact.last_name);
        const name = parts.join(' ');
        if (name && contact.company_name) {
          setContactDisplayName(`${name} (${contact.company_name})`);
        } else {
          setContactDisplayName(name || contact.company_name || null);
        }
      }
    } catch (err) {
      // Ignore
    }
  }

  async function loadMessages() {
    setLoading(true);
    const response = await fetch(`/api/sms/messages?threadId=${threadId}`);
    const data = await response.json();
    if (data.messages) setMessages(data.messages);
    setLoading(false);
  }

  async function markAsRead() {
    await fetch('/api/sms/threads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, is_read: true }),
    });
  }

  async function handleSend() {
    if (!newMessage.trim() && !mediaFile && !contentSid || sending) return;
    setSending(true);

    let mediaUrls: string[] = [];

    if (mediaFile) {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const ext = mediaFile.name.split('.').pop();
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('sms-media')
        .upload(filename, mediaFile, { contentType: mediaFile.type, upsert: false });
      if (uploadError) {
        alert('Failed to upload image');
        setSending(false);
        return;
      }
      const { data: { publicUrl } } = supabase.storage.from('sms-media').getPublicUrl(filename);
      mediaUrls = [publicUrl];
    }

    const response = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        body: newMessage.trim() || undefined,
        mediaUrls: mediaUrls.length ? mediaUrls : undefined,
        contentSid: contentSid || undefined,
      }),
    });

    if (response.ok) {
      setNewMessage('');
      setMediaFile(null);
      setMediaPreview(null);
      setContentSid(null);
      loadMessages();
    } else {
      const data = await response.json();
      alert(data.error || 'Failed to send message');
    }

    setSending(false);
  }

  async function handleUpdateName() {
    await fetch('/api/sms/threads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, contact_name: contactName.trim() || null }),
    });
    setThread(prev => prev ? { ...prev, contact_name: contactName.trim() || null } : prev);
    setEditingName(false);
  }

  function handleTemplateSelect(template: any) {
    setNewMessage(template.body);
    textareaRef.current?.focus();
  }

  function formatTime(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'long' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function groupMessagesByDate(messages: SmsMessageWithUser[]) {
    const groups: Record<string, SmsMessageWithUser[]> = {};
    messages.forEach(message => {
      const date = new Date(message.sent_at).toDateString();
      if (!groups[date]) groups[date] = [];
      groups[date].push(message);
    });
    return groups;
  }

  function getBubbleColor(userId: string): string {
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
      'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-red-500',
    ];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  function getInitials(name: string | null | undefined, email: string): string {
    if (name) {
      const parts = name.split(' ');
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return name[0].toUpperCase();
    }
    return email[0].toUpperCase();
  }

  const groupedMessages = groupMessagesByDate(messages);
  const displayName = customerLinkedName || contactDisplayName || thread?.contact_name || thread?.contact_phone || 'Unknown';

  if (!thread && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-analog-text-muted">Thread not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-w-0 h-full overflow-hidden">
      {/* Main SMS column */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">

        {/* Header */}
        <div className="flex-shrink-0 border-b-2 border-analog-border-strong bg-analog-surface px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-analog-accent to-analog-accent-light flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdateName();
                        if (e.key === 'Escape') setEditingName(false);
                      }}
                      className="input text-sm py-1"
                      autoFocus
                    />
                    <button onClick={handleUpdateName} className="btn btn-primary text-xs px-2 py-1">Save</button>
                    <button onClick={() => setEditingName(false)} className="text-analog-text-muted text-xs hover:text-analog-text">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="font-display font-semibold text-analog-text truncate">{displayName}</h2>
                    <button
                      onClick={() => setEditingName(true)}
                      className="text-analog-text-faint hover:text-analog-text transition-colors flex-shrink-0"
                      title="Edit contact name"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
                )}
                <p className="text-sm text-analog-text-muted">{thread?.contact_phone}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isWhatsApp && (
                <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .057 5.335.057 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  WhatsApp
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center text-analog-text-muted py-8">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-analog-text-muted py-8">
              <p>No messages yet</p>
              <p className="text-sm mt-1">Send a message to start the conversation</p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-6">
              {Object.entries(groupedMessages).map(([dateKey, dayMessages]) => (
                <div key={dateKey}>
                  <div className="flex items-center justify-center my-4">
                    <div className="bg-analog-border px-3 py-1 rounded-full">
                      <span className="text-xs text-analog-text-faint font-medium">
                        {formatDate(dayMessages[0].sent_at)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {dayMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex flex-col ${message.direction === 'outbound' ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                            message.direction === 'outbound'
                              ? 'bg-analog-accent text-white rounded-br-md'
                              : 'bg-analog-surface-alt border border-analog-border rounded-bl-md'
                          }`}
                        >
                          {message.body && (
                            <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
                          )}

                          {message.attachments && message.attachments.length > 0 && (
                            <div className="mt-2 space-y-2">
                              {message.attachments.map((attachment) => (
                                <div key={attachment.id}>
                                  {attachment.content_type?.startsWith('image/') ? (
                                    <img src={`/api/sms/media?url=${encodeURIComponent(attachment.media_url)}&inboxId=${inbox.id}`} alt="MMS attachment" className="max-w-full rounded-lg" />
                                  ) : attachment.content_type?.startsWith('audio/') ? (
                                    <div className={`flex items-center gap-2 px-1 py-1 rounded-lg ${message.direction === 'outbound' ? 'bg-white/10' : 'bg-analog-border/30'}`}>
                                      <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 3a9 9 0 100 18A9 9 0 0012 3zm-1 13V8l6 4-6 4z" />
                                      </svg>
                                      <audio
                                        controls
                                        src={`/api/sms/media?url=${encodeURIComponent(attachment.media_url)}&inboxId=${inbox.id}`}
                                        className="h-8 w-48"
                                        style={{ filter: message.direction === 'outbound' ? 'invert(1)' : 'none' }}
                                      />
                                    </div>
                                  ) : (
                                    <a href={attachment.media_url} target="_blank" rel="noopener noreferrer" className="text-sm underline">
                                      View attachment
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          <p className={`text-xs mt-1 ${
                            message.direction === 'outbound' ? 'text-white/70' : 'text-analog-text-faint'
                          }`}>
                            {formatTime(message.sent_at)}
                            {message.direction === 'outbound' && message.status && (
                              <span className="ml-2">• {message.status}</span>
                            )}
                          </p>
                        </div>

                        {message.direction === 'outbound' && message.sent_by && (
                          <div className="flex items-center gap-1.5 mt-1 mr-1">
                            <div
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold ${getBubbleColor(message.sent_by.id)}`}
                              title={message.sent_by.name || message.sent_by.email}
                            >
                              {getInitials(message.sent_by.name, message.sent_by.email)}
                            </div>
                            <span className="text-[11px] text-analog-text-faint">
                              {message.sent_by.name?.split(' ')[0] || message.sent_by.email.split('@')[0]}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}


        </div>

        {/* Composer */}
        <div className="border-t border-analog-border-light bg-analog-surface px-6 py-4">
          <div className="max-w-2xl mx-auto">
            {mediaPreview && (
              <div className="mb-2 relative inline-block">
                <img src={mediaPreview} alt="Attachment preview" className="h-20 rounded-lg border border-analog-border" />
                <button
                  onClick={() => { setMediaFile(null); setMediaPreview(null); }}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                >×</button>
              </div>
            )}

            {/* Template selected indicator */}
            {contentSid && (
              <div className="mb-2 flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .057 5.335.057 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                Template selected — message will send as WhatsApp template
                <button onClick={() => setContentSid(null)} className="ml-auto text-green-600 hover:text-green-800">✕</button>
              </div>
            )}

            {/* Slack-style composer box */}
            <div className="border border-analog-border rounded-xl overflow-hidden bg-analog-surface focus-within:border-analog-accent focus-within:shadow-[0_0_0_3px_rgba(0,91,196,0.08)] transition-all">
              <div className="relative px-3 pt-3 pb-1">
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    checkForSkuTrigger(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !showSkuPicker) {
                      e.preventDefault();
                      handleSend();
                    }
                    if (e.key === 'Escape' && showSkuPicker) setShowSkuPicker(false);
                  }}
                  placeholder={isWhatsApp ? 'Reply (or use a template for new conversations)...' : 'Type a message...'}
                  rows={2}
                  className="w-full bg-transparent text-sm text-analog-text placeholder-analog-text-placeholder focus:outline-none resize-none leading-relaxed"
                  style={{ minHeight: '48px', maxHeight: '120px' }}
                />
                {showSkuPicker && (
                  <SkuPicker
                    searchQuery={skuSearchQuery}
                    onSelect={handleSkuSelect}
                    onClose={() => setShowSkuPicker(false)}
                    position={{ top: -330, left: 0 }}
                  />
                )}
              </div>
              <div className="flex items-center justify-between px-3 py-2 border-t border-analog-border-light">
                <div className="flex items-center gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setMediaFile(file);
                        setMediaPreview(URL.createObjectURL(file));
                      }
                      e.target.value = '';
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 rounded-lg text-analog-text-faint hover:text-analog-text hover:bg-analog-hover transition-colors"
                    title="Attach image"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                  {thread && (
                    <TemplatePicker
                      inboxId={thread.inbox_id}
                      onSelect={handleTemplateSelect}
                    />
                  )}
                  {isWhatsApp && (
                    <WhatsAppTemplatePicker
                      inboxId={inbox.id}
                      onSelect={(body, sid) => {
                        setNewMessage(body);
                        setContentSid(sid);
                      }}
                    />
                  )}
                </div>
                <button
                  onClick={handleSend}
                  disabled={(!newMessage.trim() && !mediaFile && !contentSid) || sending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-analog-accent hover:bg-analog-accent-hover text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                  Send
                </button>
              </div>
            </div>
            <p className="text-[10px] text-analog-text-placeholder mt-1.5 px-1">
              {isWhatsApp ? 'Enter to send • Use template button for new conversations outside 24hr window' : 'Enter to send • Shift+Enter for new line • /sku: to insert product link'}
            </p>
          </div>
        </div>

      </div>{/* end main SMS column */}

      {/* Right sidebar */}
      <div className="w-72 flex-shrink-0 bg-analog-surface-alt flex flex-col">
        <div className="overflow-y-auto px-4 py-5 border-b border-analog-border-light" style={{maxHeight: '50%'}}>
          <CustomerCard phone={thread?.contact_phone || ''} onCustomerLinked={(name) => setCustomerLinkedName(name)} />
        </div>
        <div className="overflow-y-auto px-4 py-5 flex-1">
          <CommentSection threadId={null} smsThreadId={threadId} currentUser={currentUser} />
        </div>
      </div>

    </div>
  );

  function checkForSkuTrigger(text: string) {
    const match = text.match(/\/sku:(\S*)$/);
    if (match) {
      setSkuSearchQuery(match[1]);
      setShowSkuPicker(true);
    } else {
      setShowSkuPicker(false);
      setSkuSearchQuery('');
    }
  }

  function handleSkuSelect(product: Product) {
    const productCatalogUrl = process.env.NEXT_PUBLIC_PRODUCT_CATALOG_URL || 'http://localhost:3002';
    const productLink = `${productCatalogUrl}/product/${product.style_number}`;
    const newText = newMessage.replace(/\/sku:\S*$/, productLink);
    setNewMessage(newText);
    setShowSkuPicker(false);
    setSkuSearchQuery('');
    textareaRef.current?.focus();
  }
}
