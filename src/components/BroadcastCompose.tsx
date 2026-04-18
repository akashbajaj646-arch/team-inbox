'use client';

import { useState, useEffect, useRef } from 'react';

interface Props {
  onClose: () => void;
  onSent: () => void;
}

export default function BroadcastCompose({ onClose, onSent }: Props) {
  const [step, setStep] = useState<'compose' | 'review' | 'sending'>('compose');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [segments, setSegments] = useState<any[]>([]);
  const [inboxes, setInboxes] = useState<any[]>([]);
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
      const [segRes, inbRes] = await Promise.all([
        fetch('/api/segments').then(r => r.json()),
        fetch('/api/inboxes').then(r => r.json()).catch(() => ({ inboxes: [] })),
      ]);
      setSegments(segRes.segments || []);

      // Load email inboxes
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data } = await supabase.from('inboxes').select('*').eq('inbox_type', 'email');
      setInboxes(data || []);
      // Auto-select sales@advanceapparels.com if present
      const sales = (data || []).find((i: any) => i.email_address === 'sales@advanceapparels.com');
      if (sales) setSelectedInboxId(sales.id);
      else if (data?.[0]) setSelectedInboxId(data[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!selectedSegmentId) { setRecipientCount(0); setRecipients([]); return; }
    (async () => {
      setLoadingRecipients(true);
      const seg = segments.find(s => s.id === selectedSegmentId);
      if (!seg) return;
      const res = await fetch('/api/segments/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: seg.filters }),
      });
      const data = await res.json();
      setRecipients((data.contacts || []).map((c: any) => ({ contact_id: c.id, email: c.email_1 })));
      setRecipientCount(data.total || 0);
      setLoadingRecipients(false);
    })();
  }, [selectedSegmentId, segments]);

  function execCmd(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  }

  async function handleSend() {
    if (!name || !subject || !selectedInboxId || recipients.length === 0) {
      alert('Please fill all fields');
      return;
    }

    if (recipientCount > 2000) {
      if (!confirm(`Warning: Sending to ${recipientCount.toLocaleString()} recipients. Gmail Workspace has a ~2000/day limit. Some may fail. Continue?`)) return;
    } else {
      if (!confirm(`Send broadcast "${name}" to ${recipientCount.toLocaleString()} recipients?`)) return;
    }

    setSending(true);
    setStep('sending');
    setProgress({ sent: 0, failed: 0, total: recipientCount });

    const body_html = editorRef.current?.innerHTML || '';

    // Create broadcast
    const createRes = await fetch('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        subject,
        body_html,
        from_inbox_id: selectedInboxId,
        segment_id: selectedSegmentId,
      }),
    });
    const { broadcast, error } = await createRes.json();
    if (error || !broadcast) { alert('Failed to create broadcast: ' + error); setSending(false); return; }

    // Send it
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
              <div>
                <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block">Broadcast name (internal)</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. April Spring Collection Launch" className="input w-full" autoFocus />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-analog-text-faint uppercase tracking-wider mb-1 block">Send from</label>
                  <select value={selectedInboxId} onChange={e => setSelectedInboxId(e.target.value)} className="input w-full">
                    <option value="">Select inbox...</option>
                    {inboxes.map(i => <option key={i.id} value={i.id}>{i.email_address}</option>)}
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
                    {loadingRecipients ? 'Loading recipients...' : `${recipientCount.toLocaleString()} recipients`}
                  </span>
                  {recipientCount > 2000 && (
                    <span className="text-xs text-red-600 font-medium">⚠ Exceeds Gmail 2000/day limit</span>
                  )}
                </div>
              )}

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
                    <button onClick={() => {
                      const url = prompt('Enter URL');
                      if (url) execCmd('createLink', url);
                    }} className="w-7 h-7 rounded hover:bg-analog-hover text-xs">🔗</button>
                  </div>
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="px-4 py-3 min-h-[200px] text-sm text-analog-text focus:outline-none"
                    style={{ wordBreak: 'break-word' }}
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-analog-border flex justify-end gap-3">
              <button onClick={onClose} className="btn btn-secondary">Cancel</button>
              <button
                onClick={handleSend}
                disabled={!name || !subject || !selectedInboxId || !selectedSegmentId || recipientCount === 0 || sending}
                className="btn btn-primary disabled:opacity-50"
              >
                Send to {recipientCount.toLocaleString()} {recipientCount === 1 ? 'recipient' : 'recipients'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
