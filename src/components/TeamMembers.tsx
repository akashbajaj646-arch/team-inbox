'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Inbox } from '@/types';

interface InboxMembership {
  inbox_id: string;
  role: 'admin' | 'member';
  inbox: Inbox;
}

interface TeamMembersProps {
  currentUser: User;
  isAdmin: boolean;
}

export default function TeamMembers({ currentUser, isAdmin }: TeamMembersProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userMemberships, setUserMemberships] = useState<InboxMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetSending, setResetSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    const { data: usersData } = await supabase
      .from('inbox_users')
      .select('*')
      .order('name', { ascending: true });

    setUsers(usersData || []);

    const { data: adminMemberships } = await supabase
      .from('inbox_members')
      .select('inbox_id')
      .eq('user_id', currentUser.id)
      .eq('role', 'admin');

    if (adminMemberships?.length) {
      const adminInboxIds = adminMemberships.map(m => m.inbox_id);
      const { data: inboxesData } = await supabase
        .from('inboxes')
        .select('*')
        .in('id', adminInboxIds)
        .order('name', { ascending: true });

      setInboxes(inboxesData || []);
    }

    setLoading(false);
  }

  async function loadUserMemberships(userId: string) {
    const { data } = await supabase
      .from('inbox_members')
      .select(`
        inbox_id,
        role,
        inbox:inboxes(*)
      `)
      .eq('user_id', userId);

    const filtered = (data || [])
      .map(m => ({
        inbox_id: m.inbox_id,
        role: m.role as 'admin' | 'member',
        inbox: m.inbox as unknown as Inbox,
      }));

    setUserMemberships(filtered);
  }

  async function handleSelectUser(user: User) {
    setSelectedUser(user);
    setError(null);
    setSuccess(null);
    await loadUserMemberships(user.id);
  }

  async function handleToggleInbox(inboxId: string, currentlyMember: boolean) {
    if (!selectedUser) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (currentlyMember) {
        const membership = userMemberships.find(m => m.inbox_id === inboxId);
        if (membership?.role === 'admin') {
          const { data: otherAdmins } = await supabase
            .from('inbox_members')
            .select('user_id')
            .eq('inbox_id', inboxId)
            .eq('role', 'admin')
            .neq('user_id', selectedUser.id);

          if (!otherAdmins?.length) {
            setError('Cannot remove the last admin from an inbox.');
            setSaving(false);
            return;
          }
        }

        const { error } = await supabase
          .from('inbox_members')
          .delete()
          .eq('inbox_id', inboxId)
          .eq('user_id', selectedUser.id);

        if (error) throw error;
        setSuccess('Removed from inbox.');
      } else {
        const { error } = await supabase
          .from('inbox_members')
          .insert({
            inbox_id: inboxId,
            user_id: selectedUser.id,
            role: 'member',
          });

        if (error) throw error;
        setSuccess('Added to inbox.');
      }

      await loadUserMemberships(selectedUser.id);
    } catch (err: any) {
      setError(err.message || 'Failed to update membership.');
    }

    setSaving(false);
  }

  async function handleRoleChange(inboxId: string, newRole: 'admin' | 'member') {
    if (!selectedUser) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (newRole === 'member') {
        const { data: otherAdmins } = await supabase
          .from('inbox_members')
          .select('user_id')
          .eq('inbox_id', inboxId)
          .eq('role', 'admin')
          .neq('user_id', selectedUser.id);

        if (!otherAdmins?.length) {
          setError('Cannot remove the last admin. Promote another user first.');
          setSaving(false);
          return;
        }
      }

      const { error } = await supabase
        .from('inbox_members')
        .update({ role: newRole })
        .eq('inbox_id', inboxId)
        .eq('user_id', selectedUser.id);

      if (error) throw error;
      setSuccess('Role updated.');
      await loadUserMemberships(selectedUser.id);
    } catch (err: any) {
      setError(err.message || 'Failed to update role.');
    }

    setSaving(false);
  }

  async function handleSendPasswordReset(user: User) {
    if (!confirm(`Send a password reset email to ${user.email}?`)) return;
    setResetSending(user.id);
    setError(null);
    setSuccess(null);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const res = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    const data = await res.json();
    setResetSending(null);
    if (res.ok) setSuccess(`Password reset email sent to ${user.email}.`);
    else setError(data.error || 'Failed to send reset email.');
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl overflow-hidden">
      <div className="px-6 py-5 border-b-2 border-analog-border-strong">
        <h2 className="font-display text-lg font-medium text-analog-text">Team Members</h2>
        <p className="text-sm text-analog-text-muted mt-1">
          Select a team member to manage their inbox access.
        </p>
      </div>

      {loading ? (
        <div className="p-6 text-analog-text-muted">Loading...</div>
      ) : (
        <div className="flex">
          {/* Users List */}
          <div className="w-72 border-r-2 border-analog-border-strong p-4">
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleSelectUser(user)}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-150 text-left border ${
                    selectedUser?.id === user.id
                      ? 'bg-analog-accent/10 text-analog-accent border-analog-accent/30'
                      : 'text-analog-text-muted border-transparent hover:bg-analog-surface-alt hover:border-analog-border'
                  }`}
                >
                  <div
                    className={`avatar avatar-sm font-ui ${
                      selectedUser?.id === user.id ? 'avatar-red' : 'avatar-blue'
                    }`}
                  >
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-sm">
                      {user.name || user.email.split('@')[0]}
                    </p>
                    <p className="text-xs text-analog-text-faint truncate">
                      {user.email}
                    </p>
                  </div>
                  {user.id === currentUser.id && (
                    <span className="text-xs text-analog-accent">(You)</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Inbox Access */}
          <div className="flex-1 p-6">
            {selectedUser ? (
              <div>
                <div className="flex items-center gap-4 mb-6 pb-6 border-b-2 border-analog-border-strong">
                  <div className="avatar avatar-lg avatar-blue font-display">
                    {(selectedUser.name || selectedUser.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="font-display text-lg font-medium text-analog-text">
                      {selectedUser.name || selectedUser.email.split('@')[0]}
                    </p>
                    <p className="text-sm text-analog-text-muted">{selectedUser.email}</p>
                  </div>
                  {selectedUser.id !== currentUser.id && (
                    <button
                      onClick={() => handleSendPasswordReset(selectedUser)}
                      disabled={resetSending === selectedUser.id}
                      className="btn btn-secondary text-sm disabled:opacity-50"
                    >
                      {resetSending === selectedUser.id ? 'Sending...' : 'Send Password Reset'}
                    </button>
                  )}
                </div>

                {error && (
                  <div className="mb-4 p-4 bg-analog-error/10 border border-analog-error/20 rounded-lg text-analog-error text-sm">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="mb-4 p-4 bg-analog-success/10 border border-analog-success/20 rounded-lg text-analog-success text-sm">
                    {success}
                  </div>
                )}

                <h3 className="text-[11px] uppercase tracking-wider text-analog-text-faint font-semibold mb-3">
                  Inbox Access
                </h3>

                {inboxes.length === 0 ? (
                  <p className="text-analog-text-muted text-sm">
                    You don't have admin access to any inboxes.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {inboxes.map((inbox) => {
                      const membership = userMemberships.find(m => m.inbox_id === inbox.id);
                      const isMember = !!membership;

                      return (
                        <div
                          key={inbox.id}
                          className="flex items-center justify-between p-4 bg-analog-surface-alt border border-analog-border rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleToggleInbox(inbox.id, isMember)}
                              disabled={saving}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-150 ${
                                isMember
                                  ? 'bg-analog-accent border-analog-accent'
                                  : 'border-analog-border-strong hover:border-analog-accent'
                              }`}
                            >
                              {isMember && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                            <div>
                              <p className="font-medium text-analog-text">{inbox.name}</p>
                              <p className="text-xs text-analog-text-faint">{inbox.email_address}</p>
                            </div>
                          </div>

                          {isMember && (
                            <select
                              value={membership.role}
                              onChange={(e) => handleRoleChange(inbox.id, e.target.value as 'admin' | 'member')}
                              disabled={saving}
                              className="input py-1.5 px-3 text-sm w-auto"
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-analog-text-muted py-20">
                Select a team member to manage their access
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
