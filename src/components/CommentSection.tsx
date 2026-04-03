'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ThreadComment, User } from '@/types';

interface CommentSectionProps {
  threadId: string | null;
  smsThreadId?: string | null;
  currentUser: User;
}

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
}

export default function CommentSection({ threadId, smsThreadId, currentUser }: CommentSectionProps) {
  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionedUsers, setMentionedUsers] = useState<TeamMember[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const effectiveThreadId = threadId || smsThreadId;
  const isSmsThread = !!smsThreadId && !threadId;

  useEffect(() => {
    if (!effectiveThreadId) return;
    loadComments();
    loadTeamMembers();

    const filterColumn = isSmsThread ? 'sms_thread_id' : 'thread_id';
    const channel = supabase
      .channel(`comments:${effectiveThreadId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'thread_comments',
        filter: `${filterColumn}=eq.${effectiveThreadId}`,
      }, () => { loadComments(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [effectiveThreadId]);

  async function loadComments() {
    const param = isSmsThread
      ? `smsThreadId=${effectiveThreadId}`
      : `threadId=${effectiveThreadId}`;
    const res = await fetch(`/api/comments?${param}`);
    const data = await res.json();
    setComments(data.comments || []);
    setLoading(false);
  }

  async function loadTeamMembers() {
    const { data } = await supabase
      .from('inbox_users')
      .select('id, name, email')
      .neq('id', currentUser.id);
    setTeamMembers((data as TeamMember[]) || []);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setNewComment(val);
    const atIdx = val.lastIndexOf('@');
    if (atIdx !== -1 && atIdx >= mentionStart) {
      const query = val.slice(atIdx + 1);
      if (!query.includes(' ')) {
        setMentionQuery(query);
        setMentionStart(atIdx);
        setShowMentions(true);
        return;
      }
    }
    setShowMentions(false);
  }

  function handleSelectMention(member: TeamMember) {
    const before = newComment.slice(0, mentionStart);
    const displayName = member.name || member.email.split('@')[0];
    setNewComment(`${before}@${displayName} `);
    setMentionedUsers(prev => [...prev, member]);
    setShowMentions(false);
    inputRef.current?.focus();
  }

  const filteredMembers = teamMembers.filter(m => {
    const name = (m.name || m.email).toLowerCase();
    return name.includes(mentionQuery.toLowerCase());
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: isSmsThread ? null : effectiveThreadId,
          smsThreadId: isSmsThread ? effectiveThreadId : null,
          content: newComment,
          mentionedUserIds: mentionedUsers.map(u => u.id),
        }),
      });
      if (res.ok) {
        setNewComment('');
        setMentionedUsers([]);
        await loadComments();
      }
    } catch (err) {
      console.error('Comment error:', err);
    }
    setSubmitting(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  }

  function formatTime(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function getAvatarColor(userId: string): string {
    const colors = [
      'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
      'bg-orange-500', 'bg-pink-500', 'bg-teal-500',
    ];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  function getInitials(user: { name: string | null; email: string }) {
    if (user.name) {
      const parts = user.name.trim().split(' ');
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return parts[0][0].toUpperCase();
    }
    return user.email[0].toUpperCase();
  }

  function renderContent(content: string) {
    const parts = content.split(/(@\w[\w\s]*?\b)/g);
    return parts.map((part, i) =>
      part.startsWith('@')
        ? <span key={i} className="text-[#005bc4] font-medium">{part}</span>
        : part
    );
  }

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <svg className="w-3.5 h-3.5 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-analog-text-faint">
          Team Discussion
        </span>
      </div>

      {/* Comments */}
      <div className="flex-1 overflow-y-auto space-y-1 mb-3">
        {loading ? (
          <p className="text-xs text-analog-text-faint px-1 py-2">Loading...</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-analog-text-faint px-1 py-2">No comments yet. Start the discussion!</p>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="group flex gap-2.5 px-2 py-2 rounded-lg hover:bg-white transition-colors"
            >
              {/* Avatar */}
              <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold mt-0.5 ${getAvatarColor(comment.user_id)}`}>
                {comment.user ? getInitials(comment.user as any) : '?'}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] font-semibold text-analog-text leading-none">
                    {comment.user?.name || comment.user?.email?.split('@')[0] || 'Unknown'}
                  </span>
                  <span className="text-[10px] text-analog-text-placeholder tracking-wide">
                    {formatTime(comment.created_at)}
                  </span>
                </div>
                <p className="text-[13px] text-analog-text-secondary mt-0.5 leading-relaxed break-words">
                  {renderContent(comment.content)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="relative mt-auto">
        {/* Mention dropdown */}
        {showMentions && filteredMembers.length > 0 && (
          <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-analog-border rounded-xl shadow-[0_4px_16px_rgba(42,52,57,0.1)] z-50 overflow-hidden">
            {filteredMembers.map(member => (
              <button
                key={member.id}
                type="button"
                onClick={() => handleSelectMention(member)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#f0f4f7] flex items-center gap-2 transition-colors"
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold ${getAvatarColor(member.id)}`}>
                  {(member.name || member.email)[0].toUpperCase()}
                </div>
                <span className="text-[13px] text-analog-text">{member.name || member.email.split('@')[0]}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 bg-white rounded-xl border border-[rgba(169,180,185,0.25)] px-3 py-2 focus-within:border-[#005bc4] focus-within:shadow-[0_0_0_3px_rgba(0,91,196,0.08)] transition-all">
          {/* Current user avatar */}
          <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-bold ${getAvatarColor(currentUser.id)}`}>
            {getInitials(currentUser)}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={newComment}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Comment... @ to mention"
            className="flex-1 bg-transparent text-[13px] text-analog-text placeholder-analog-text-placeholder focus:outline-none"
          />
          {newComment.trim() && (
            <button
              type="submit"
              disabled={submitting}
              className="text-[#005bc4] hover:text-[#004eab] transition-colors disabled:opacity-50 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-[10px] text-analog-text-placeholder mt-1 px-1">Enter to post</p>
      </form>
    </div>
  );
}
