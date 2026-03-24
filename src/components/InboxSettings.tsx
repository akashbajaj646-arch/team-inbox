'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Inbox } from '@/types';

interface InboxMemberWithUser {
  inbox_id: string;
  user_id: string;
  role: 'admin' | 'member';
  user: User;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

interface InboxSettingsProps {
  inbox: Inbox;
  currentUser: User;
  isAdmin: boolean;
  onUpdate: () => void;
}

export default function InboxSettings({ inbox, currentUser, isAdmin, onUpdate }: InboxSettingsProps) {
  const [members, setMembers] = useState<InboxMemberWithUser[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [inboxName, setInboxName] = useState(inbox.name);
  const [savingName, setSavingName] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    loadMembers();
    loadPendingInvites();
  }, [inbox.id]);

  useEffect(() => {
    setInboxName(inbox.name);
    setIsEditingName(false);
  }, [inbox.name]);

  async function loadMembers() {
    setLoading(true);
    
    const { data, error } = await supabase
      .from('inbox_members')
      .select(`
        inbox_id,
        user_id,
        role,
        user:inbox_users(*)
      `)
      .eq('inbox_id', inbox.id);

    if (error) {
      console.error('Error loading members:', error);
    } else {
      setMembers(data as unknown as InboxMemberWithUser[]);
    }
    
    setLoading(false);
  }

  async function loadPendingInvites() {
    if (!isAdmin) return;
    
    try {
      const response = await fetch(`/api/invites?inboxId=${inbox.id}`);
      const data = await response.json();
      
      if (response.ok) {
        setPendingInvites(data.invites || []);
      }
    } catch (err) {
      console.error('Error loading invites:', err);
    }
  }

  async function handleSaveName() {
    if (!inboxName.trim() || inboxName === inbox.name) {
      setIsEditingName(false);
      setInboxName(inbox.name);
      return;
    }

    setSavingName(true);
    setError(null);

    const { error } = await supabase
      .from('inboxes')
      .update({ name: inboxName.trim() })
      .eq('id', inbox.id);

    if (error) {
      setError('Failed to update inbox name.');
      console.error(error);
    } else {
      setSuccess('Inbox name updated.');
      setIsEditingName(false);
      onUpdate();
    }

    setSavingName(false);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setInviteLink(null);
    setInviting(true);

    try {
      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.toLowerCase().trim(),
          inboxId: inbox.id,
          role: inviteRole,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to create invite');
      } else {
        setSuccess(`Invite sent to ${inviteEmail}`);
        setInviteLink(data.inviteUrl);
        setInviteEmail('');
        loadPendingInvites();
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
      console.error(err);
    }

    setInviting(false);
  }

  async function handleRoleChange(userId: string, newRole: 'admin' | 'member') {
    const adminCount = members.filter(m => m.role === 'admin').length;
    const member = members.find(m => m.user_id === userId);
    
    if (member?.role === 'admin' && newRole === 'member' && adminCount <= 1) {
      setError('Cannot remove the last admin. Promote another member first.');
      return;
    }

    const { error } = await supabase
      .from('inbox_members')
      .update({ role: newRole })
      .eq('inbox_id', inbox.id)
      .eq('user_id', userId);

    if (error) {
      setError('Failed to update role. Please try again.');
      console.error(error);
    } else {
      setSuccess('Role updated successfully.');
      loadMembers();
      onUpdate();
    }
  }

  async function handleCancelInvite(inviteId: string) {
    if (!confirm('Cancel this invite?')) return;

    try {
      const response = await fetch(`/api/invites?inviteId=${inviteId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setSuccess('Invite cancelled.');
        loadPendingInvites();
      } else {
        setError('Failed to cancel invite.');
      }
    } catch (err) {
      setError('Failed to cancel invite.');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setSuccess('Invite link copied to clipboard!');
  }

  async function handleRemoveMember(userId: string) {
    const adminCount = members.filter(m => m.role === 'admin').length;
    const member = members.find(m => m.user_id === userId);
    
    if (member?.role === 'admin' && adminCount <= 1) {
      setError('Cannot remove the last admin.');
      return;
    }

    if (userId === currentUser.id) {
      if (!confirm('Are you sure you want to remove yourself from this inbox?')) {
        return;
      }
    } else {
      if (!confirm('Are you sure you want to remove this member?')) {
        return;
      }
    }

    const { error } = await supabase
      .from('inbox_members')
      .delete()
      .eq('inbox_id', inbox.id)
      .eq('user_id', userId);

    if (error) {
      setError('Failed to remove member. Please try again.');
      console.error(error);
    } else {
      setSuccess('Member removed successfully.');
      loadMembers();
      onUpdate();
    }
  }

  return (
    <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-analog-border-strong">
        <h2 className="font-display text-lg font-medium text-analog-text">Inbox Details</h2>
      </div>

      <div className="p-6 space-y-6">
        {/* Inbox Info */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="text-sm font-medium text-analog-text-faint">Name</label>
            {isEditingName ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  value={inboxName}
                  onChange={(e) => setInboxName(e.target.value)}
                  className="input py-2 flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') {
                      setIsEditingName(false);
                      setInboxName(inbox.name);
                    }
                  }}
                />
                <button
                  onClick={handleSaveName}
                  disabled={savingName}
                  className="btn btn-primary py-2 px-3"
                >
                  {savingName ? '...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setIsEditingName(false);
                    setInboxName(inbox.name);
                  }}
                  className="btn btn-secondary py-2 px-3"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-analog-text">{inbox.name}</p>
                {isAdmin && (
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="p-1 text-analog-text-muted hover:text-analog-accent rounded transition-all duration-150"
                    title="Rename inbox"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
          
          {/* Show different info based on inbox type */}
          {inbox.inbox_type === 'sms' ? (
            <>
              <div>
                <label className="text-sm font-medium text-analog-text-faint">Phone Number</label>
                <p className="text-analog-text mt-1">{inbox.twilio_phone_number || 'Not set'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-analog-text-faint">Twilio Status</label>
                <p className="mt-1">
                  {inbox.twilio_account_sid ? (
                    <span className="inline-flex items-center gap-1.5 text-analog-success">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Connected
                    </span>
                  ) : (
                    <span className="text-analog-warning">Not connected</span>
                  )}
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium text-analog-text-faint">Email Address</label>
                <p className="text-analog-text mt-1">{inbox.email_address}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-analog-text-faint">Gmail Status</label>
                <p className="mt-1">
                  {inbox.google_refresh_token ? (
                    <span className="inline-flex items-center gap-1.5 text-analog-success">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Connected
                    </span>
                  ) : (
                    <span className="text-analog-warning">Not connected</span>
                  )}
                </p>
              </div>
              {isAdmin && inbox.inbox_type === 'email' && (
                <div>
                  <a
                    href={`/api/auth/google?inbox_id=${inbox.id}`}
                    className="btn btn-secondary text-sm py-2 px-4 inline-flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reconnect Gmail
                  </a>
                </div>
              )}
            </>
          )}
        </div>

        {/* Deep Sync - Admin Only */}
        {isAdmin && inbox.inbox_type === 'sms' && inbox.twilio_account_sid && (
          <SmsSyncSection inboxId={inbox.id} />
        )}
        {isAdmin && inbox.inbox_type !== 'sms' && inbox.google_refresh_token && (
          <DeepSyncSection inboxId={inbox.id} />
        )}

        {/* Divider */}
        <div className="border-t-2 border-analog-border-strong pt-6">
          <h3 className="font-display text-base font-medium text-analog-text mb-4">Team Members</h3>
          
          {/* Messages */}
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

          {/* Members List */}
          {loading ? (
            <div className="text-analog-text-muted py-4">Loading members...</div>
          ) : (
            <div className="space-y-2 mb-6">
              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between p-4 bg-analog-surface-alt border border-analog-border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="avatar avatar-md avatar-blue font-ui">
                      {(member.user?.name || member.user?.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-analog-text">
                        {member.user?.name || member.user?.email}
                        {member.user_id === currentUser.id && (
                          <span className="ml-2 text-xs text-analog-accent">(You)</span>
                        )}
                      </p>
                      <p className="text-sm text-analog-text-faint">{member.user?.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isAdmin ? (
                      <>
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.user_id, e.target.value as 'admin' | 'member')}
                          className="input py-1.5 px-3 text-sm w-auto"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                        <button
                          onClick={() => handleRemoveMember(member.user_id)}
                          className="p-2 text-analog-text-muted hover:text-analog-error hover:bg-analog-error/10 rounded-lg transition-all duration-150"
                          title="Remove member"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <span className={`badge ${member.role === 'admin' ? 'badge-primary' : 'badge-muted'}`}>
                        {member.role === 'admin' ? 'Admin' : 'Member'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Invite Form */}
          {isAdmin && (
            <div className="pt-4 border-t border-analog-border">
              <h4 className="text-sm font-medium text-analog-text mb-3">Invite Team Member</h4>
              <form onSubmit={handleInvite} className="space-y-3">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Enter email address"
                  className="input w-full"
                  required
                />
                <div className="flex gap-3">
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                    className="input w-32"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="btn btn-primary disabled:opacity-50 flex-1"
                  >
                    {inviting ? 'Sending...' : 'Send Invite'}
                  </button>
                </div>
              </form>
              <p className="mt-3 text-xs text-analog-text-faint">
                An invite link will be generated that you can share with the team member.
              </p>

              {/* Invite Link Display */}
              {inviteLink && (
                <div className="mt-4 p-4 bg-analog-success/10 border border-analog-success/20 rounded-lg">
                  <p className="text-sm text-analog-success mb-2">Invite created! Share this link:</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={inviteLink}
                      readOnly
                      className="input flex-1 text-sm bg-analog-surface"
                    />
                    <button
                      onClick={() => copyToClipboard(inviteLink)}
                      className="btn btn-secondary"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {/* Pending Invites */}
              {pendingInvites.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-analog-text mb-3">Pending Invites</h4>
                  <div className="space-y-2">
                    {pendingInvites.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex items-center justify-between p-3 bg-analog-surface-alt border border-analog-border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-analog-warning/20 flex items-center justify-center">
                            <svg className="w-4 h-4 text-analog-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-analog-text">{invite.email}</p>
                            <p className="text-xs text-analog-text-faint">
                              Invited as {invite.role} • Expires {new Date(invite.expires_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleCancelInvite(invite.id)}
                          className="p-1.5 text-analog-text-muted hover:text-analog-error hover:bg-analog-error/10 rounded transition-all duration-150"
                          title="Cancel invite"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Deep Sync Section Component
function DeepSyncSection({ inboxId }: { inboxId: string }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ synced: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDeepSync() {
    if (!confirm('This will sync all emails from the last 30 days. This may take a few minutes. Continue?')) {
      return;
    }

    setSyncing(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch('/api/emails/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inboxId, deepSync: true }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult({ synced: data.synced, total: data.total });
      } else {
        setError(data.error || 'Deep sync failed');
      }
    } catch (err) {
      setError('An error occurred during sync');
    }

    setSyncing(false);
  }

  return (
    <div className="border-t border-analog-border pt-4 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-analog-text">Deep Sync</h4>
          <p className="text-xs text-analog-text-faint mt-0.5">
            Import all emails from the last 30 days
          </p>
        </div>
        <button
          onClick={handleDeepSync}
          disabled={syncing}
          className="btn btn-secondary text-sm disabled:opacity-50"
        >
          {syncing ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Syncing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Deep Sync
            </>
          )}
        </button>
      </div>

      {result && (
        <div className="mt-3 p-3 bg-analog-success/10 border border-analog-success/20 rounded-lg">
          <p className="text-sm text-analog-success">
            Sync complete! Added {result.synced} new emails ({result.total} total processed)
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-analog-error/10 border border-analog-error/20 rounded-lg">
          <p className="text-sm text-analog-error">{error}</p>
        </div>
      )}
    </div>
  );
}

// SMS Sync Section Component
function SmsSyncSection({ inboxId }: { inboxId: string }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ synced: number; threadsCreated: number; totalFound: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSmsSync() {
    if (!confirm('This will sync all SMS messages from the last 30 days. This may take a few minutes. Continue?')) {
      return;
    }

    setSyncing(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch('/api/sms/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inboxId }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult({ 
          synced: data.synced, 
          threadsCreated: data.threadsCreated, 
          totalFound: data.totalFound 
        });
      } else {
        setError(data.error || 'SMS sync failed');
      }
    } catch (err) {
      setError('An error occurred during sync');
    }

    setSyncing(false);
  }

  return (
    <div className="border-t border-analog-border pt-4 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-analog-text">Sync Messages</h4>
          <p className="text-xs text-analog-text-faint mt-0.5">
            Import all SMS/MMS from the last 30 days
          </p>
        </div>
        <button
          onClick={handleSmsSync}
          disabled={syncing}
          className="btn btn-secondary text-sm disabled:opacity-50"
        >
          {syncing ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Syncing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync Messages
            </>
          )}
        </button>
      </div>

      {result && (
        <div className="mt-3 p-3 bg-analog-success/10 border border-analog-success/20 rounded-lg">
          <p className="text-sm text-analog-success">
            Sync complete! Added {result.synced} new messages, {result.threadsCreated} new conversations ({result.totalFound} total found)
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-analog-error/10 border border-analog-error/20 rounded-lg">
          <p className="text-sm text-analog-error">{error}</p>
        </div>
      )}
    </div>
  );
}
