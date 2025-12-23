'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Template, Inbox, User } from '@/types';

interface TemplatesManagerProps {
  inbox: Inbox;
  currentUser: User;
  isAdmin: boolean;
}

export default function TemplatesManager({ inbox, currentUser, isAdmin }: TemplatesManagerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    body: '',
    category: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    loadTemplates();
  }, [inbox.id]);

  async function loadTemplates() {
    setLoading(true);
    
    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .eq('inbox_id', inbox.id)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('Error loading templates:', error);
    } else {
      setTemplates(data || []);
    }
    
    setLoading(false);
  }

  function handleEdit(template: Template) {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      subject: template.subject || '',
      body: template.body,
      category: template.category || '',
    });
    setShowForm(true);
  }

  function handleNew() {
    setEditingTemplate(null);
    setFormData({ name: '', subject: '', body: '', category: '' });
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setEditingTemplate(null);
    setFormData({ name: '', subject: '', body: '', category: '' });
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (editingTemplate) {
        const { error } = await supabase
          .from('templates')
          .update({
            name: formData.name,
            subject: formData.subject || null,
            body: formData.body,
            category: formData.category || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingTemplate.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('templates')
          .insert({
            inbox_id: inbox.id,
            name: formData.name,
            subject: formData.subject || null,
            body: formData.body,
            category: formData.category || null,
            created_by: currentUser.id,
          });

        if (error) throw error;
      }

      await loadTemplates();
      handleCancel();
    } catch (err: any) {
      setError(err.message || 'Failed to save template');
      console.error(err);
    }

    setSaving(false);
  }

  async function handleDelete(templateId: string) {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    const { error } = await supabase
      .from('templates')
      .delete()
      .eq('id', templateId);

    if (error) {
      setError('Failed to delete template');
      console.error(error);
    } else {
      loadTemplates();
    }
  }

  const groupedTemplates = templates.reduce((acc, template) => {
    const category = template.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(template);
    return acc;
  }, {} as Record<string, Template[]>);

  return (
    <div className="bg-analog-surface border-2 border-analog-border-strong rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-analog-border-strong flex items-center justify-between">
        <h2 className="font-display text-lg font-medium text-analog-text">Response Templates</h2>
        {isAdmin && !showForm && (
          <button onClick={handleNew} className="btn btn-secondary text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Template
          </button>
        )}
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-4 p-4 bg-analog-error/10 border border-analog-error/20 rounded-lg text-analog-error text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="mb-6 p-5 bg-analog-surface-alt border border-analog-border rounded-lg">
            <h3 className="font-medium text-analog-text mb-4">
              {editingTemplate ? 'Edit Template' : 'New Template'}
            </h3>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-analog-text-muted mb-1">Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Order Status"
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-analog-text-muted mb-1">Category</label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="e.g., Orders, Shipping"
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-analog-text-muted mb-1">Subject Line</label>
                <input
                  type="text"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="Optional"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-analog-text-muted mb-1">Body *</label>
                <textarea
                  value={formData.body}
                  onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                  placeholder="Write your template message..."
                  rows={5}
                  className="input resize-none"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <button type="button" onClick={handleCancel} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary disabled:opacity-50">
                {saving ? 'Saving...' : editingTemplate ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {/* Templates List */}
        {loading ? (
          <div className="text-analog-text-muted py-4">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-analog-surface-alt flex items-center justify-center border border-analog-border">
              <svg className="w-8 h-8 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-analog-text-muted mb-2">No templates yet</p>
            {isAdmin && (
              <button onClick={handleNew} className="text-analog-accent hover:underline text-sm font-medium">
                Create your first template
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
              <div key={category}>
                <h3 className="text-[11px] uppercase tracking-wider text-analog-text-faint font-semibold mb-3">
                  {category}
                </h3>
                <div className="space-y-2">
                  {categoryTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-start justify-between p-4 bg-analog-surface-alt border border-analog-border rounded-lg group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-analog-text">{template.name}</p>
                        <p className="text-sm text-analog-text-muted line-clamp-2 mt-1">
                          {template.body}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEdit(template)}
                            className="p-2 text-analog-text-muted hover:text-analog-text hover:bg-analog-hover rounded-lg transition-all duration-150"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(template.id)}
                            className="p-2 text-analog-text-muted hover:text-analog-error hover:bg-analog-error/10 rounded-lg transition-all duration-150"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
