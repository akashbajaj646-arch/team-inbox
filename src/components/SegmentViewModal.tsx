'use client';

import { useState, useEffect } from 'react';

interface Props {
  segment: any;
  onClose: () => void;
}

export default function SegmentViewModal({ segment, onClose }: Props) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/segments/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: segment.filters }),
    });
    const data = await res.json();
    setContacts(data.contacts || []);
    setLoading(false);
  }

  function exportCSV() {
    const headers = ['Company', 'First Name', 'Last Name', 'Email', 'Phone', 'City', 'State', 'Total Spend', 'Total Orders', 'Last Order Date'];
    const rows = contacts.map(c => [
      c.company_name || '',
      c.first_name || '',
      c.last_name || '',
      c.email_1 || '',
      c.phone_number || '',
      c.city || '',
      c.state || '',
      c.total_spend || 0,
      c.total_invoices || 0,
      c.last_invoice_date || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${segment.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text(segment.name, 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`${contacts.length} contacts • ${new Date().toLocaleDateString()}`, 14, 22);
    if (segment.description) doc.text(segment.description, 14, 28);

    autoTable(doc, {
      startY: segment.description ? 34 : 28,
      head: [['Company', 'Name', 'Email', 'Total Spend', 'Orders', 'Last Order']],
      body: contacts.map(c => [
        c.company_name || '',
        `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        c.email_1 || '',
        `$${Number(c.total_spend || 0).toFixed(2)}`,
        c.total_invoices || 0,
        c.last_invoice_date || '',
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [0, 91, 196] },
    });

    doc.save(`${segment.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-analog-surface border-2 border-analog-border-strong rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-analog-border flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-medium">{segment.name}</h2>
            <p className="text-sm text-analog-text-faint mt-0.5">
              {loading ? 'Loading...' : `${contacts.length.toLocaleString()} contacts`}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCSV} disabled={loading || contacts.length === 0} className="btn btn-secondary text-sm disabled:opacity-50">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
            <button onClick={exportPDF} disabled={loading || contacts.length === 0} className="btn btn-secondary text-sm disabled:opacity-50">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export PDF
            </button>
            <button onClick={onClose} className="p-1.5 text-analog-text-muted hover:text-analog-text">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-10 text-center text-analog-text-muted">Loading contacts...</div>
          ) : contacts.length === 0 ? (
            <div className="p-10 text-center text-analog-text-muted">No contacts match this segment</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-analog-surface-alt sticky top-0 border-b border-analog-border">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Company</th>
                  <th className="text-left px-4 py-2 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-2 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Email</th>
                  <th className="text-left px-4 py-2 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Location</th>
                  <th className="text-right px-4 py-2 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Spend</th>
                  <th className="text-right px-4 py-2 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Orders</th>
                  <th className="text-left px-4 py-2 font-semibold text-xs text-analog-text-faint uppercase tracking-wider">Last Order</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-analog-border-light hover:bg-analog-hover">
                    <td className="px-4 py-2 font-medium text-analog-text">{c.company_name || '—'}</td>
                    <td className="px-4 py-2 text-analog-text-muted">{`${c.first_name || ''} ${c.last_name || ''}`.trim() || '—'}</td>
                    <td className="px-4 py-2 text-analog-text-muted">{c.email_1 || '—'}</td>
                    <td className="px-4 py-2 text-analog-text-muted">{[c.city, c.state].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-2 text-right font-medium text-analog-text">${Number(c.total_spend || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-2 text-right text-analog-text-muted">{c.total_invoices || 0}</td>
                    <td className="px-4 py-2 text-analog-text-muted">{c.last_invoice_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
