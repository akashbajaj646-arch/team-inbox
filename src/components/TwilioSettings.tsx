'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@/types';

interface TwilioSettingsProps {
  currentUser: User;
  onInboxCreated: () => void;
}

export default function TwilioSettings({ currentUser, onInboxCreated }: TwilioSettingsProps) {
  const [inboxName, setInboxName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const supabase = createClient();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    
    if (!inboxName.trim() || !phoneNumber.trim() || !accountSid.trim() || !authToken.trim()) {
      setError('All fields are required');
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      // Format phone number
      let formattedPhone = phoneNumber.trim();
      if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+' + formattedPhone.replace(/\D/g, '');
      }

      // Create the inbox
      const { data: inbox, error: inboxError } = await supabase
        .from('inboxes')
        .insert({
          name: inboxName.trim(),
          inbox_type: 'sms',
          twilio_phone_number: formattedPhone,
          twilio_account_sid: accountSid.trim(),
          twilio_auth_token: authToken.trim(),
        })
        .select()
        .single();

      if (inboxError) throw inboxError;

      // Add current user as admin
      const { error: memberError } = await supabase
        .from('inbox_members')
        .insert({
          inbox_id: inbox.id,
          user_id: currentUser.id,
          role: 'admin',
        });

      if (memberError) throw memberError;

      setSuccess('SMS inbox created successfully!');
      setInboxName('');
      setPhoneNumber('');
      setAccountSid('');
      setAuthToken('');
      onInboxCreated();
    } catch (err: any) {
      console.error('Create SMS inbox error:', err);
      setError(err.message || 'Failed to create SMS inbox');
    }

    setCreating(false);
  }

  // Generate webhook URL
  const webhookUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/sms/webhook`
    : '/api/sms/webhook';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-base font-medium text-analog-text mb-2">Connect Twilio SMS</h3>
        <p className="text-sm text-analog-text-muted mb-4">
          Add a Twilio phone number to receive and send SMS/MMS messages.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-analog-error/10 border border-analog-error/20 rounded-lg text-analog-error text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-analog-success/10 border border-analog-success/20 rounded-lg text-analog-success text-sm">
          {success}
        </div>
      )}

      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-analog-text mb-1">
            Inbox Name
          </label>
          <input
            type="text"
            value={inboxName}
            onChange={(e) => setInboxName(e.target.value)}
            placeholder="e.g., Customer Support SMS"
            className="input w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-analog-text mb-1">
            Twilio Phone Number
          </label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+1234567890"
            className="input w-full"
          />
          <p className="text-xs text-analog-text-faint mt-1">
            Include country code (e.g., +1 for US)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-analog-text mb-1">
            Account SID
          </label>
          <input
            type="text"
            value={accountSid}
            onChange={(e) => setAccountSid(e.target.value)}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="input w-full font-mono text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-analog-text mb-1">
            Auth Token
          </label>
          <input
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder="Your Twilio Auth Token"
            className="input w-full font-mono text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={creating}
          className="btn btn-primary w-full disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create SMS Inbox'}
        </button>
      </form>

      {/* Webhook Configuration Instructions */}
      <div className="border-t-2 border-analog-border-strong pt-6">
        <h4 className="font-medium text-analog-text mb-2">Webhook Configuration</h4>
        <p className="text-sm text-analog-text-muted mb-3">
          After creating your inbox, configure your Twilio phone number to send incoming messages to this webhook URL:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-analog-surface-alt px-3 py-2 rounded-lg text-sm font-mono text-analog-text border border-analog-border overflow-x-auto">
            {webhookUrl}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(webhookUrl)}
            className="btn btn-secondary px-3 py-2"
            title="Copy webhook URL"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-analog-text-faint mt-2">
          In Twilio Console: Phone Numbers → Manage → Active numbers → Select your number → Messaging → "A MESSAGE COMES IN" → Webhook → Paste URL
        </p>
      </div>
    </div>
  );
}
