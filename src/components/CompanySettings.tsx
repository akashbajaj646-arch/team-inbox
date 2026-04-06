'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function CompanySettings() {
  const [companyName, setCompanyName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from('org_settings')
      .select('company_name')
      .single();
    if (data?.company_name) setCompanyName(data.company_name);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: membership } = await supabase
        .from('inbox_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .limit(1)
        .single();
      setIsAdmin(!!membership);
    }
  }

  async function handleSave() {
    setSaving(true);
    await supabase
      .from('org_settings')
      .update({ company_name: companyName, updated_at: new Date().toISOString() })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!isAdmin) return null;

  return (
    <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl overflow-hidden">
      <div className="px-6 py-5 border-b-2 border-analog-border-strong">
        <h2 className="font-display text-lg font-medium text-analog-text">Company</h2>
        <p className="text-sm text-analog-text-faint mt-0.5">Shown in the top left of the app</p>
      </div>
      <div className="p-6 flex items-center gap-3">
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="e.g. Advance Apparels"
          className="input flex-1"
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        />
        <button
          onClick={handleSave}
          disabled={saving || !companyName.trim()}
          className="btn btn-primary disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
