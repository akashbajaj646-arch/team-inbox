'use client';

import { useState, useEffect, useRef } from 'react';

interface Props {
  onClose: () => void;
  onSent: () => void;
}

const SMS_OPTOUT_FOOTER = '\n\nReply STOP to unsubscribe';

export default function BroadcastCompose({ onClose, onSent }: Props) {
  const [step, setStep] = useState<'compose' | 'sending'>('compose');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [smsBody, setSmsBody] = useState('');
  const [segments, setSegments] = useState<any[]>([]);
  const [emailInboxes, setEmailInboxes] = useState<any[]>([]);
  const [smsInboxes, setSmsInboxes] = useState<any[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState('');
  const [selectedInboxId, setSelectedInboxId] = useState('');
  const [recipientCount, setRecipientCount] = useState(0);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, total: 0 });
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const segRes = await fetch('/api/segments').then(r => r.json());
      setSegments(segRes.segments || []);

      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: emailData } = await supabase.from('inboxes').select('*').eq('inbox_type', 'email');
      const { data: smsData } = await supabase.from('inboxes').select('*').eq('inbox_type', 'sms');
      setEmailInboxes(emailData || []);
      setSmsInboxes(smsData || []);
    })();
  }, []);

  // Auto-select appropriate inbox when channel changes
  useEffect(() => {
    if (channel === 'email') {
      const sales = emailInboxes.find(i => i.email_address === 'sales@advanceapparels.com');
      if (sales) setSelectedInboxId(sales.id);
      else if (emailInboxes[0]) setSelectedInboxId(emailInboxes[0].id);
    } else {
      if (smsInboxes[0]) setSelectedInboxId(smsInboxes[0].id);
    }
  }, [channel, emailInboxes, smsInboxes]);

  // Load recipients when segment or channel changes
  useEffect(() => {
    if (!selectedSegmentId) { setRecipientCount(0); setRecipients([]); return; }
    (async () => {
      setLoadingRecipients(true);
      const seg = segments.find(s => s.id === selectedSegmentId);
      if (!seg) return;
      const res = await fetch('/api/segments/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: seg.filters, channel }),
      });
      const data = await res.json();
      if (channel === 'email') {
        setRecipients((data.contacts || []).map((c: any) => ({ contact_id: c.id, email: c.email_1 })));
      } else {
        setRecipients((data.contacts || []).map((c: any) => ({ contact_id: c.id, phone_number: c.phone_number })));
      }
      setRecipientCount(data.total || 0);
      setLoadingRecipients(false);
    })();
  }, [selectedSegmentId, segments, channel]);

  function execCmd(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  }

  async function handleSend() {
    if (!name || !selectedInboxId || recipients.length === 0) { alert('Please fill all fields'); return; }
    if (channel === 'email' && !subject) { alert('Subject is required for email'); return; }
    if (channel === 'sms' && !smsBody.trim()) { alert('Message body is required'); return; }

    const body_html = channel === 'email' ? editorRef.current?.innerHTML || '' : smsBody + SMS_OPTOUT_FOOTER;

    const limit = channel === 'email' ? 2000 : 2000;
    const limitLabel = channel === 'email' ? 'Gmail Workspace' : 'Twilio Low Volume';
    if (recipientCount > limit) {
      if (!confirm(`Warning: Sending to ${recipientCount.toLocaleString()} recipients exceeds ${limitLabel} ~${limit}/day limit. Continue?`)) return;
    } else {
      const channelLabel = channel === 'email' ? 'email' : 'SMS';
      if (!confirm(`Send ${channelLabel} broadcast "${name}" to ${recipientCount.toLocaleString()} recipients?`)) return;
    }

    setSending(true);
    setStep('sending');
    setProgress({ sent: 0, failed: 0, total: recipientCount });

    const createRes = await fetch('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        subject: channel === 'email' ? subject : '',
        body_html,
        from_inbox_id: selectedInboxId,
        segment_id: selectedSegmentId,
        channel,
      }),
    });
    const { broadcast, error } = await createRes.json();
    if (error || !broadcast) { alert('Failed to create broadcast: ' + error); setSending(false); return; }

    const sendRes = await fetch('/api/broadcasts/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcastId: broadcast.id, recipients }),
    });
    const sendData = await sendRes.json();

    setProgress({ sent: sendData.sent || 0, failed: sendData.failed || 0, total: recipientCount });
    setSending(false);
    setTimeout(() => onSent(), 1500);
  }

  const previewSmsLength = (smsBody + SMS_OPTOUT_FOOTER).length;
  const smsSegments = Math.ceil(previewSmsLength / 160);
  const inboxList = channel === 'email' ? emailInboxes : smsInboxes;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-analog-surface border-2 border-analog-border-strong rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-analog-border flex items-center justify-between">
          <h2 className="font-display text-lg font-medium">New Broadcast</h2>
          <button onClick={onClose} disabled={sending} className="p-1.5 text-analog-text-muted hover:text-analog-text disabled:opacity-50">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {step === 'sending' ? (
          <div className="flex-1 flex items-center justify-center p-10">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-accent/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-analog-accent animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <p className="font-medium text-analog-text">Sending broadcast...</p>
              <p className="text-sm text-analog-text-muted mt-1">
                {progress.sent} of {progress.total} sent{progress.failed > 0 && `, ${progress.failed} failed`}
              </p>
              <p className="text-xs text-analog-text-faint mt-3">This may take a few minutes. Please don't close this window.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Channel toggle */}
              <div>
                <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-2 block">Channel</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setChannel('email')}
                    className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${channel === 'email' ? 'border-analog-accent bg-analog-accent/5 text-analog-accent' : 'border-analog-border text-analog-text-muted hover:border-analog-border-strong'}`}
                  >
                    <svg className="w-4 h-4 inline mr-2 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Email
                  </button>
                  <button
                    onClick={() => setChannel('sms')}
                    className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${channel === 'sms' ? 'border-analog-accent bg-analog-accent/5 text-analog-accent' : 'border-analog-border text-analog-text-muted hover:border-analog-border-strong'}`}
                  >
                    <svg className="w-4 h-4 inline mr-2 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    SMS
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block">Broadcast name (internal)</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. April Spring Collection Launch" className="input w-full" autoFocus />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block">Send from</label>
                  <select value={selectedInboxId} onChange={e => setSelectedInboxId(e.target.value)} className="input w-full">
                    <option value="">Select inbox...</option>
                    {inboxList.map(i => <option key={i.id} value={i.id}>{channel === 'email' ? i.email_address : (i.twilio_phone_number || i.name)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block">Recipients (segment)</label>
                  <select value={selectedSegmentId} onChange={e => setSelectedSegmentId(e.target.value)} className="input w-full">
                    <option value="">Select segment...</option>
                    {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {selectedSegmentId && (
                <div className="rounded-lg bg-analog-accent/5 border border-analog-accent/20 px-4 py-2.5 flex items-center justify-between">
                  <span className="text-sm text-analog-text">
                    {loadingRecipients ? 'Loading recipients...' : `${recipientCount.toLocaleString()} recipients${channel === 'sms' ? ' with phone numbers (opted-out excluded)' : ''}`}
                  </span>
                </div>
              )}

              {channel === 'email' ? (
                <>
                  <div>
                    <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block">Subject</label>
                    <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Your subject line" className="input w-full" />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block">Message</label>
                    <div className="border border-analog-border rounded-lg overflow-hidden">
                      <div className="flex items-center gap-1 px-3 py-2 bg-analog-surface-alt border-b border-analog-border">
                        <button onClick={() => execCmd('bold')} className="w-7 h-7 rounded hover:bg-analog-hover font-bold">B</button>
                        <button onClick={() => execCmd('italic')} className="w-7 h-7 rounded hover:bg-analog-hover italic">I</button>
                        <button onClick={() => execCmd('underline')} className="w-7 h-7 rounded hover:bg-analog-hover underline">U</button>
                        <div className="w-px h-5 bg-analog-border mx-1" />
                        <button onClick={() => execCmd('insertUnorderedList')} className="w-7 h-7 rounded hover:bg-analog-hover text-sm">•</button>
                        <button onClick={() => { const url = prompt('Enter URL'); if (url) execCmd('createLink', url); }} className="w-7 h-7 rounded hover:bg-analog-hover text-xs">🔗</button>
                      </div>
                      <div ref={editorRef} contentEditable suppressContentEditableWarning className="px-4 py-3 min-h-[200px] text-sm text-analog-text focus:outline-none" style={{ wordBreak: 'break-word' }} />
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block flex items-center justify-between">
                    <span>Message</span>
                    <span className="text-analog-text-faint normal-case tracking-normal">
                      {previewSmsLength} chars • {smsSegments} segment{smsSegments !== 1 ? 's' : ''}
                    </span>
                  </label>
                  <textarea
                    value={smsBody}
                    onChange={e => setSmsBody(e.target.value)}
                    placeholder="Your SMS message..."
                    className="input w-full h-32 resize-none"
                  />
                  <p className="text-xs text-analog-text-faint mt-2">
                    "Reply STOP to unsubscribe" is automatically appended to comply with A2P 10DLC rules.
                    {smsSegments > 1 && ` Each recipient will receive ${smsSegments} SMS segments (charged separately).`}
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-analog-border flex justify-end gap-3">
              <button onClick={onClose} className="btn btn-secondary">Cancel</button>
              <button
                onClick={handleSend}
                disabled={!name || !selectedInboxId || !selectedSegmentId || recipientCount === 0 || sending || (channel === 'email' && !subject) || (channel === 'sms' && !smsBody.trim())}
                className="btn btn-primary disabled:opacity-50"
              >
                Send {channel === 'email' ? 'email' : 'SMS'} to {recipientCount.toLocaleString()}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
