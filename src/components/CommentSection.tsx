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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'thread_comments',
          filter: `${filterColumn}=eq.${effectiveThreadId}`,
        },
        () => {
          loadComments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [effectiveThreadId, isSmsThread]);

  async function loadTeamMembers() {
    const { data } = await supabase
      .from('inbox_users')
      .select('id, name, email')
      .neq('id', currentUser.id);
    setTeamMembers(data || []);
  }

  async function loadComments() {
    if (!effectiveThreadId) return;

    let query = supabase
      .from('thread_comments')
      .select(`
        *,
        user:inbox_users(id, name, email, avatar_url)
      `)
      .order('created_at', { ascending: true });

    if (isSmsThread) {
      query = query.eq('sms_thread_id', effectiveThreadId);
    } else {
      query = query.eq('thread_id', effectiveThreadId);
    }

    const { data } = await query;
    setComments(data || []);
    setLoading(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setNewComment(value);

    const cursor = e.target.selectionStart || 0;
    const textUpToCursor = value.slice(0, cursor);
    const atIndex = textUpToCursor.lastIndexOf('@');

    if (atIndex !== -1) {
      const query = textUpToCursor.slice(atIndex + 1);
      if (!query.includes(' ')) {
        setMentionStart(atIndex);
        setMentionQuery(query);
        setShowMentions(true);
        return;
      }
    }

    setShowMentions(false);
    setMentionQuery('');
    setMentionStart(-1);
  }

  function handleSelectMention(member: TeamMember) {
    const displayName = member.name || member.email.split('@')[0];
    const before = newComment.slice(0, mentionStart);
    const after = newComment.slice(mentionStart + mentionQuery.length + 1);
    const inserted = `@${displayName} `;
    setNewComment(before + inserted + after);
    setShowMentions(false);
    setMentionQuery('');
    setMentionStart(-1);

    if (!mentionedUsers.find(u => u.id === member.id)) {
      setMentionedUsers(prev => [...prev, member]);
    }

    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const filteredMembers = teamMembers.filter(m => {
    const name = (m.name || m.email).toLowerCase();
    return name.includes(mentionQuery.toLowerCase());
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim() || !effectiveThreadId) return;

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

  function formatTime(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays === 1) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function getAvatarColor(userId: string): string {
    const colors = ['avatar-blue', 'avatar-green', 'avatar-brown', 'avatar-red'];
    const index = userId.charCodeAt(0) % colors.length;
    return colors[index];
  }

  function renderCommentContent(content: string) {
    const parts = content.split(/(@\w[\w\s]*?\b)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="text-analog-accent font-medium">
            {part}
          </span>
        );
      }
      return part;
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-[18px] h-[18px] text-analog-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <h3 className="font-display text-base font-medium text-analog-text">Team Discussion</h3>
      </div>

      {/* Comments List */}
      {loading ? (
        <p className="text-sm text-analog-text-muted py-4">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-analog-text-muted py-4">No comments yet. Start the discussion!</p>
      ) : (
        <div className="space-y-0">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-3 py-4 border-b border-analog-border-light last:border-b-0">
              <div className={`avatar avatar-sm font-ui flex-shrink-0 ${getAvatarColor(comment.user_id)}`}>
                {comment.user?.name?.charAt(0) || comment.user?.email?.charAt(0) || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-[13px] text-analog-text">
                    {comment.user?.name || comment.user?.email?.split('@')[0] || 'Unknown'}
                  </span>
                  <span className="text-[11px] text-analog-text-placeholder">
                    {formatTime(comment.created_at)}
                  </span>
                </div>
                <p className="text-[14px] text-analog-text-secondary mt-1 leading-relaxed">
                  {renderCommentContent(comment.content)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Comment Input */}
      <form onSubmit={handleSubmit} className="mt-4 flex gap-3">
        <div className={`avatar avatar-sm font-ui flex-shrink-0 ${getAvatarColor(currentUser.id)}`}>
          {currentUser.name?.charAt(0) || currentUser.email.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 flex gap-2 relative">
          {/* Mention dropdown */}
          {showMentions && filteredMembers.length > 0 && (
            <div className="absolute bottom-full mb-1 left-0 bg-white border border-analog-border rounded-lg shadow-lg z-50 min-w-[180px] overflow-hidden">
              {filteredMembers.map(member => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => handleSelectMention(member)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-analog-hover flex items-center gap-2"
                >
                  <div className={`avatar avatar-xs font-ui ${getAvatarColor(member.id)}`}>
                    {(member.name || member.email).charAt(0).toUpperCase()}
                  </div>
                  <span>{member.name || member.email.split('@')[0]}</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={newComment}
            onChange={handleInputChange}
            placeholder="Add a comment... type @ to mention"
            className="input flex-1 py-2.5 text-sm"
          />
          <button
            type="submit"
            disabled={!newComment.trim() || submitting}
            className="btn btn-secondary px-4 py-2 text-sm disabled:opacity-50"
          >
            {submitting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  );
}
