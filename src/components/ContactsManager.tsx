'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Contact, User } from '@/types';

interface ContactsManagerProps {
  currentUser: User;
}

export default function ContactsManager({ currentUser }: ContactsManagerProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalContacts, setTotalContacts] = useState(0);
  const [syncingHQ, setSyncingHQ] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [formData, setFormData] = useState({
    company_name: '',
    first_name: '',
    last_name: '',
    phone_number: '',
    email_1: '',
    email_2: '',
    email_3: '',
    notes: '',
  });

  useEffect(() => {
    loadContacts(1);
  }, []);

  async function loadContacts(page = 1, query = '') {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (query.trim()) params.set('search', query.trim());
    const response = await fetch(`/api/contacts?${params}`);
    const data = await response.json();
    if (data.contacts) {
      setContacts(data.contacts);
      setTotalPages(data.totalPages || 1);
      setTotalContacts(data.total || 0);
      setCurrentPage(page);
    }
    setLoading(false);
  }

  async function handleSyncAdvanceHQ() {
    setSyncingHQ(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await fetch('/api/contacts/sync-advance-hq', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(data.message || `Synced ${data.synced} contacts`);
        loadContacts();
      } else {
        setError(data.error || 'Sync failed');
      }
    } catch (err) {
      setError('Sync failed');
    }
    setSyncingHQ(false);
  }

  async function handleSearch(query: string) {
    setSearchQuery(query);
    setCurrentPage(1);
    loadContacts(1, query);
  }

  function resetForm() {
    setFormData({
      company_name: '',
      first_name: '',
      last_name: '',
      phone_number: '',
      email_1: '',
      email_2: '',
      email_3: '',
      notes: '',
    });
    setEditingContact(null);
    setShowForm(false);
  }

  function handleEdit(contact: Contact) {
    setFormData({
      company_name: contact.company_name || '',
      first_name: contact.first_name || '',
      last_name: contact.last_name || '',
      phone_number: contact.phone_number || '',
      email_1: contact.email_1 || '',
      email_2: contact.email_2 || '',
      email_3: contact.email_3 || '',
      notes: contact.notes || '',
    });
    setEditingContact(contact);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    
    if (!formData.first_name && !formData.last_name && !formData.company_name) {
      setError('Please provide at least a name or company');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const url = '/api/contacts';
      const method = editingContact ? 'PATCH' : 'POST';
      const body = editingContact 
        ? { contactId: editingContact.id, ...formData }
        : formData;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to save contact');
      } else {
        setSuccess(editingContact ? 'Contact updated!' : 'Contact created!');
        resetForm();
        loadContacts();
      }
    } catch (err) {
      setError('Failed to save contact');
    }

    setSaving(false);
  }

  async function handleDelete(contactId: string) {
    if (!confirm('Are you sure you want to delete this contact?')) return;

    try {
      const response = await fetch(`/api/contacts?contactId=${contactId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setSuccess('Contact deleted');
        loadContacts();
      } else {
        setError('Failed to delete contact');
      }
    } catch (err) {
      setError('Failed to delete contact');
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      await importCSV(text);
    };
    reader.readAsText(file);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function importCSV(csvText: string) {
    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const lines = csvText.split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        setError('CSV file is empty or has no data rows');
        setImporting(false);
        return;
      }

      // Parse header
      const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
      
      // Map headers to our fields
      const fieldMap: Record<string, string> = {
        'company': 'company_name',
        'company_name': 'company_name',
        'company name': 'company_name',
        'first_name': 'first_name',
        'first name': 'first_name',
        'firstname': 'first_name',
        'last_name': 'last_name',
        'last name': 'last_name',
        'lastname': 'last_name',
        'phone': 'phone_number',
        'phone_number': 'phone_number',
        'phone number': 'phone_number',
        'mobile': 'phone_number',
        'email': 'email_1',
        'email_1': 'email_1',
        'email 1': 'email_1',
        'email1': 'email_1',
        'email_2': 'email_2',
        'email 2': 'email_2',
        'email2': 'email_2',
        'email_3': 'email_3',
        'email 3': 'email_3',
        'email3': 'email_3',
        'notes': 'notes',
        'note': 'notes',
        'comments': 'notes',
      };

      // Find column indices
      const columnMap: Record<string, number> = {};
      header.forEach((h, i) => {
        const mapped = fieldMap[h];
        if (mapped) {
          columnMap[mapped] = i;
        }
      });

      // Parse data rows
      const contacts: any[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0) continue;

        const contact: any = {};
        for (const [field, index] of Object.entries(columnMap)) {
          if (values[index]) {
            contact[field] = values[index].trim();
          }
        }

        // Only add if has at least a name or company
        if (contact.first_name || contact.last_name || contact.company_name) {
          contacts.push(contact);
        }
      }

      if (contacts.length === 0) {
        setError('No valid contacts found in CSV. Make sure you have columns for name or company.');
        setImporting(false);
        return;
      }

      // Send to API
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(`Successfully imported ${data.imported} contacts!`);
        loadContacts();
      } else {
        setError(data.error || 'Failed to import contacts');
      }
    } catch (err) {
      console.error('CSV import error:', err);
      setError('Failed to parse CSV file');
    }

    setImporting(false);
  }

  // Parse a CSV line handling quoted values
  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);

    return result;
  }

  function formatContactName(contact: Contact): string {
    const parts = [];
    if (contact.first_name) parts.push(contact.first_name);
    if (contact.last_name) parts.push(contact.last_name);
    return parts.join(' ') || contact.company_name || 'Unnamed';
  }

  function downloadTemplate() {
    const template = 'company_name,first_name,last_name,phone_number,email_1,email_2,email_3,notes\nAcme Corp,John,Doe,+1234567890,john@acme.com,john.doe@gmail.com,,Great customer';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-medium text-analog-text">Contacts</h2>
          <p className="text-sm text-analog-text-muted mt-1">
            Manage your contacts to see names in emails and SMS
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={downloadTemplate}
            className="btn btn-secondary text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Template
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="btn btn-secondary text-sm disabled:opacity-50"
          >
            {importing ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Importing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import CSV
              </>
            )}
          </button>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="btn btn-primary text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Contact
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-analog-error/10 border border-analog-error/20 rounded-lg text-analog-error text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}
      {success && (
        <div className="p-4 bg-analog-success/10 border border-analog-success/20 rounded-lg text-analog-success text-sm">
          {success}
          <button onClick={() => setSuccess(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Contact Form */}
      {showForm && (
        <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-analog-text">
              {editingContact ? 'Edit Contact' : 'New Contact'}
            </h3>
            <button
              onClick={resetForm}
              className="text-analog-text-muted hover:text-analog-text"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-analog-text mb-1">Company Name</label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  className="input w-full"
                  placeholder="Acme Corp"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-analog-text mb-1">First Name</label>
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    className="input w-full"
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-analog-text mb-1">Last Name</label>
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    className="input w-full"
                    placeholder="Doe"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-analog-text mb-1">Phone Number</label>
              <input
                type="tel"
                value={formData.phone_number}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                className="input w-full"
                placeholder="+1 (555) 123-4567"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-analog-text mb-1">Email 1</label>
                <input
                  type="email"
                  value={formData.email_1}
                  onChange={(e) => setFormData({ ...formData, email_1: e.target.value })}
                  className="input w-full"
                  placeholder="john@acme.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-analog-text mb-1">Email 2</label>
                <input
                  type="email"
                  value={formData.email_2}
                  onChange={(e) => setFormData({ ...formData, email_2: e.target.value })}
                  className="input w-full"
                  placeholder="john@gmail.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-analog-text mb-1">Email 3</label>
                <input
                  type="email"
                  value={formData.email_3}
                  onChange={(e) => setFormData({ ...formData, email_3: e.target.value })}
                  className="input w-full"
                  placeholder="john.doe@yahoo.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-analog-text mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="input w-full h-24 resize-none"
                placeholder="Add any notes about this contact..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={resetForm}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingContact ? 'Update Contact' : 'Create Contact'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sync from Advance HQ */}
      <div className="flex items-center justify-between mb-4">
        <div>
          {syncResult && <p className="text-sm text-analog-success">{syncResult}</p>}
        </div>
        <button
          onClick={handleSyncAdvanceHQ}
          disabled={syncingHQ}
          className="btn btn-secondary text-sm flex items-center gap-2 disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${syncingHQ ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {syncingHQ ? 'Syncing...' : 'Sync from Advance HQ'}
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search contacts..."
          className="input w-full" style={{paddingLeft: "2.5rem"}}
        />
        <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Search + count */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-analog-text-faint">
          {totalContacts.toLocaleString()} contacts{searchQuery ? ` matching "${searchQuery}"` : ''}
        </p>
      </div>

      {/* Contacts List */}
      <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-analog-text-muted">Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-surface-alt flex items-center justify-center border-2 border-analog-border">
              <svg className="w-8 h-8 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <p className="text-analog-text-muted mb-2">No contacts yet</p>
            <p className="text-sm text-analog-text-faint">Add contacts manually or import from CSV</p>
          </div>
        ) : (
          <div className="divide-y divide-analog-border">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="p-4 hover:bg-analog-surface-alt transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-analog-accent/10 flex items-center justify-center text-analog-accent font-medium">
                      {(contact.first_name || contact.company_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-analog-text">
                          {formatContactName(contact)}
                        </p>
                        {contact.company_name && contact.first_name && (
                          <span className="text-sm text-analog-text-muted">
                            @ {contact.company_name}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-analog-text-muted">
                        {contact.phone_number && (
                          <span className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            {contact.phone_number}
                          </span>
                        )}
                        {contact.email_1 && (
                          <span className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            {contact.email_1}
                          </span>
                        )}
                        {(contact.email_2 || contact.email_3) && (
                          <span className="text-analog-text-faint">
                            +{[contact.email_2, contact.email_3].filter(Boolean).length} more
                          </span>
                        )}
                      </div>
                      {contact.notes && (
                        <p className="mt-2 text-sm text-analog-text-faint line-clamp-1">
                          {contact.notes}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(contact)}
                      className="p-2 text-analog-text-muted hover:text-analog-accent hover:bg-analog-hover rounded-lg transition-all duration-150"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(contact.id)}
                      className="p-2 text-analog-text-muted hover:text-analog-error hover:bg-analog-error/10 rounded-lg transition-all duration-150"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      {contacts.length > 0 && (
        <p className="text-sm text-analog-text-faint text-center">
          {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
        </p>
      )}
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => loadContacts(currentPage - 1, searchQuery)}
            disabled={currentPage === 1 || loading}
            className="btn btn-secondary text-sm disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-sm text-analog-text-faint">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => loadContacts(currentPage + 1, searchQuery)}
            disabled={currentPage === totalPages || loading}
            className="btn btn-secondary text-sm disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
