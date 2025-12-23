'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface InviteDetails {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  inbox: {
    id: string;
    name: string;
  };
  inviter: {
    name: string;
    email: string;
  };
}

export default function InviteAcceptPage() {
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [needsAccount, setNeedsAccount] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;
  const supabase = createClient();

  useEffect(() => {
    loadInvite();
  }, [token]);

  async function loadInvite() {
    try {
      // Check if user is logged in
      const { data: { user } } = await supabase.auth.getUser();
      setIsLoggedIn(!!user);

      // Fetch invite details
      const response = await fetch(`/api/invites/accept?token=${token}`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Invalid or expired invite');
        setLoading(false);
        return;
      }

      setInvite(data.invite);
      setNeedsAccount(data.needsAccount);
      
      // If user is logged in with the right email, they can accept directly
      if (user && user.email?.toLowerCase() === data.invite.email.toLowerCase()) {
        setNeedsAccount(false);
      }
    } catch (err) {
      setError('Failed to load invite');
    }

    setLoading(false);
  }

  async function handleAccept() {
    setAccepting(true);
    setError(null);

    try {
      if (needsAccount) {
        // Create account first
        const { error: signUpError } = await supabase.auth.signUp({
          email: invite!.email,
          password,
          options: {
            data: { full_name: name },
          },
        });

        if (signUpError) {
          setError(signUpError.message);
          setAccepting(false);
          return;
        }
      }

      // Accept the invite
      const response = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to accept invite');
        setAccepting(false);
        return;
      }

      // Redirect to inbox
      router.push('/');
    } catch (err) {
      setError('Something went wrong');
    }

    setAccepting(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-texture">
        <div className="text-analog-text-muted">Loading invite...</div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-texture p-4">
        <div className="max-w-md w-full bg-analog-surface border-2 border-analog-border-strong rounded-xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-error/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-analog-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="font-display text-xl font-medium text-analog-text mb-2">Invalid Invite</h1>
          <p className="text-analog-text-muted mb-6">{error}</p>
          <button
            onClick={() => router.push('/login')}
            className="btn btn-primary"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-texture p-4">
      <div className="max-w-md w-full bg-analog-surface border-2 border-analog-border-strong rounded-xl p-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br from-analog-accent to-analog-accent-light flex items-center justify-center shadow-analog-accent">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-medium text-analog-text">You're Invited!</h1>
        </div>

        {/* Invite Details */}
        <div className="bg-analog-surface-alt border border-analog-border rounded-lg p-4 mb-6">
          <p className="text-analog-text mb-2">
            <strong>{invite?.inviter.name || invite?.inviter.email}</strong> has invited you to join:
          </p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-analog-accent/20 flex items-center justify-center text-analog-accent font-semibold">
              {invite?.inbox.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-medium text-analog-text">{invite?.inbox.name}</p>
              <p className="text-sm text-analog-text-faint">as {invite?.role}</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-analog-error/10 border border-analog-error/20 rounded-lg text-analog-error text-sm">
            {error}
          </div>
        )}

        {needsAccount && !isLoggedIn ? (
          <div className="space-y-4">
            <p className="text-sm text-analog-text-muted">
              Create your account to accept this invite:
            </p>
            
            <div>
              <label className="block text-sm font-medium text-analog-text-muted mb-2">
                Your Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className="input"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-analog-text-muted mb-2">
                Email
              </label>
              <input
                type="email"
                value={invite?.email || ''}
                disabled
                className="input bg-analog-surface-alt"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-analog-text-muted mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                className="input"
                required
                minLength={6}
              />
            </div>

            <button
              onClick={handleAccept}
              disabled={accepting || !name || !password}
              className="btn btn-primary w-full disabled:opacity-50"
            >
              {accepting ? 'Creating account...' : 'Create Account & Join'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {isLoggedIn ? (
              <p className="text-sm text-analog-text-muted text-center">
                You're signed in. Click below to join this inbox.
              </p>
            ) : (
              <p className="text-sm text-analog-text-muted text-center">
                An account already exists for this email. Please sign in first.
              </p>
            )}

            <button
              onClick={handleAccept}
              disabled={accepting}
              className="btn btn-primary w-full disabled:opacity-50"
            >
              {accepting ? 'Joining...' : 'Accept Invite'}
            </button>

            {!isLoggedIn && (
              <button
                onClick={() => router.push('/login')}
                className="btn btn-secondary w-full"
              >
                Sign In First
              </button>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-analog-text-placeholder">
          This invite expires on {new Date(invite?.expires_at || '').toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}
