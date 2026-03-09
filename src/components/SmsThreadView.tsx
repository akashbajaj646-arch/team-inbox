'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SmsThread, SmsMessage, User, Inbox, Contact } from '@/types';
import CommentSection from './CommentSection';
import SkuPicker from './SkuPicker';
import CustomerCard from './CustomerCard';

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
  const [showSkuPicker, setShowSkuPicker] = useState(false);
  const [skuSearchQuery, setSkuSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supabase = createClient();

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
    if (!newMessage.trim() || sending) return;
    setSending(true);

    const response = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, body: newMessage.trim() }),
    });

    if (response.ok) {
      setNewMessage('');
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
    setThread(prev => prev ? { ...prev, contact_name: contactName.trim() || null } : null);
    setEditingName(false);
  }

  function formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  }

  function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function groupMessagesByDate(msgs: SmsMessageWithUser[]): Record<string, SmsMessageWithUser[]> {
    const groups: Record<string, SmsMessageWithUser[]> = {};
    msgs.forEach(msg => {
      const dateKey = new Date(msg.sent_at).toDateString();
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(msg);
    });
    return groups;
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

  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center text-analog-text-muted">
        Loading...
      </div>
    );
  }

  const groupedMessages = groupMessagesByDate(messages);

  return (
    <div className="flex-1 flex flex-row h-screen bg-analog-surface overflow-hidden">

      {/* Main SMS column */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b-2 border-analog-border-strong bg-analog-surface flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-analog-accent/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-analog-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="input py-1 px-2 text-sm w-48"
                    placeholder="Contact name"
                    autoFocus
                  />
                  <button onClick={handleUpdateName} className="text-analog-accent text-sm font-medium">Save</button>
                  <button onClick={() => setEditingName(false)} className="text-analog-text-muted text-sm">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-medium text-analog-text">
                    {contactDisplayName || thread.contact_name || formatPhone(thread.contact_phone)}
                  </h2>
                  <button
                    onClick={() => setEditingName(true)}
                    className="text-analog-text-faint hover:text-analog-accent"
                    title="Edit contact name"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              )}
              <p className="text-sm text-analog-text-faint">
                {(contactDisplayName || thread.contact_name) ? formatPhone(thread.contact_phone) : 'SMS Conversation'}
              </p>
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

          {/* Team Discussion */}
          <div className="max-w-2xl mx-auto mt-8 pt-6 border-t-2 border-analog-border-strong">
            <CommentSection
              threadId={null}
              smsThreadId={threadId}
              currentUser={currentUser}
            />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t-2 border-analog-border-strong bg-analog-surface-alt px-6 py-4">
          <div className="max-w-2xl mx-auto relative">
            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
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
                  placeholder="Type a message... (use /sku: to search products)"
                  rows={1}
                  className="input w-full resize-none"
                  style={{ minHeight: '44px', maxHeight: '120px' }}
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
              <button
                onClick={handleSend}
                disabled={!newMessage.trim() || sending}
                className="btn btn-primary disabled:opacity-50"
              >
                {sending ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-xs text-analog-text-faint mt-2">
              Press Enter to send, Shift+Enter for new line • Type /sku: to insert product link
            </p>
          </div>
        </div>

      </div>{/* end main SMS column */}

      {/* Right sidebar */}
      <div className="w-72 flex-shrink-0 border-l border-stone-200 bg-white overflow-y-auto px-4 py-5">
        <CustomerCard phone={thread.contact_phone} />
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
