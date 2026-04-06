'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@/types';
import RichTextEditor from './RichTextEditor';

interface SignatureEditorProps {
  currentUser: User;
}

export default function SignatureEditor({ currentUser }: SignatureEditorProps) {
  const [signature, setSignature] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    loadSignature();
  }, []);

  async function loadSignature() {
    const { data } = await supabase
      .from('inbox_users')
      .select('email_signature')
      .eq('id', currentUser.id)
      .single();
    if (data?.email_signature) setSignature(data.email_signature);
  }

  async function handleSave() {
    setSaving(true);
    await supabase
      .from('inbox_users')
      .update({ email_signature: signature || null })
      .eq('id', currentUser.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleClear() {
    if (!confirm('Remove your signature?')) return;
    setSignature('');
    await supabase
      .from('inbox_users')
      .update({ email_signature: null })
      .eq('id', currentUser.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl overflow-hidden">
      <div className="px-6 py-5 border-b-2 border-analog-border-strong flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-medium text-analog-text">Email Signature</h2>
          <p className="text-sm text-analog-text-faint mt-0.5">Automatically added to every email reply</p>
        </div>
        <div className="flex items-center gap-2">
          {signature && (
            <button onClick={handleClear} className="btn btn-secondary text-sm">
              Remove
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Signature'}
          </button>
        </div>
      </div>
      <div className="p-6">
        <div className="mb-3 pb-3 border-b border-analog-border-light">
          <p className="text-xs text-analog-text-faint">A separator line will be added above your signature when sending.</p>
        </div>
        <RichTextEditor
          content={signature}
          onChange={setSignature}
          placeholder="Write your signature... e.g. your name, title, phone number, website"
        />
        {signature && (
          <div className="mt-4 pt-4 border-t border-analog-border-light">
            <p className="text-xs text-analog-text-faint mb-2 uppercase tracking-wider font-semibold">Preview</p>
            <div className="text-sm text-analog-text-faint mb-2">— </div>
            <div
              className="text-sm text-analog-text"
              dangerouslySetInnerHTML={{ __html: signature }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
