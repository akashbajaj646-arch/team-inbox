'use client';

import { useState, useEffect, useRef } from 'react';

interface Template {
  sid: string;
  friendlyName: string;
  body: string;
  variableCount: number;
  variables: Record<string, string>;
  language: string;
  status: string;
}

interface WhatsAppTemplatePickerProps {
  inboxId: string;
  onSelect: (body: string, contentSid: string) => void;
}

export default function WhatsAppTemplatePicker({ inboxId, onSelect }: WhatsAppTemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [variableValues, setVariableValues] = useState<Record<number, string>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSelectedTemplate(null);
        setVariableValues({});
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function fetchTemplates() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/templates?inboxId=${inboxId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch templates');
      setTemplates(data.templates);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  function handleOpen() {
    setOpen(true);
    if (templates.length === 0) fetchTemplates();
  }

  function handleSelectTemplate(template: Template) {
    setSelectedTemplate(template);
    setVariableValues({});
  }

  function getPreviewBody() {
    if (!selectedTemplate) return '';
    let body = selectedTemplate.body;
    for (let i = 1; i <= selectedTemplate.variableCount; i++) {
      const value = variableValues[i] || `{{${i}}}`;
      body = body.replace(`{{${i}}}`, value);
    }
    return body;
  }

  function handleUseTemplate() {
    if (!selectedTemplate) return;
    const body = getPreviewBody();
    onSelect(body, selectedTemplate.sid);
    setOpen(false);
    setSelectedTemplate(null);
    setVariableValues({});
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-analog-text-muted border border-analog-border rounded-lg hover:bg-analog-hover transition-colors"
        title="Use WhatsApp Template"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .057 5.335.057 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
        Use Template
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-96 bg-analog-surface border-2 border-analog-border-strong rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-analog-border flex items-center justify-between">
            <h4 className="font-medium text-sm text-analog-text">
              {selectedTemplate ? 'Fill in Variables' : 'WhatsApp Templates'}
            </h4>
            {selectedTemplate && (
              <button
                onClick={() => { setSelectedTemplate(null); setVariableValues({}); }}
                className="text-xs text-analog-accent hover:underline"
              >
                ← Back
              </button>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="p-6 text-center text-analog-text-muted text-sm">
              Loading templates...
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 text-sm text-red-500">
              {error}
              <button onClick={fetchTemplates} className="ml-2 underline">Retry</button>
            </div>
          )}

          {/* Template List */}
          {!loading && !error && !selectedTemplate && (
            <div className="max-h-72 overflow-y-auto">
              {templates.length === 0 ? (
                <div className="p-6 text-center text-analog-text-muted text-sm">
                  No approved templates found.
                  <p className="mt-1 text-xs">Create and submit templates in Twilio's Content Template Builder.</p>
                </div>
              ) : (
                templates.map((template) => (
                  <button
                    key={template.sid}
                    onClick={() => handleSelectTemplate(template)}
                    className="w-full text-left px-4 py-3 hover:bg-analog-hover border-b border-analog-border-light last:border-b-0 transition-colors"
                  >
                    <p className="font-medium text-sm text-analog-text truncate">{template.friendlyName}</p>
                    <p className="text-xs text-analog-text-muted mt-0.5 line-clamp-2">{template.body}</p>
                    {template.variableCount > 0 && (
                      <p className="text-xs text-analog-accent mt-1">{template.variableCount} variable{template.variableCount > 1 ? 's' : ''} to fill in</p>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Variable Fill-in */}
          {!loading && !error && selectedTemplate && (
            <div className="p-4 space-y-4">
              {/* Preview */}
              <div className="bg-analog-surface-alt rounded-lg px-3 py-2 text-sm text-analog-text border border-analog-border">
                <p className="text-xs text-analog-text-faint mb-1 font-medium uppercase tracking-wide">Preview</p>
                <p className="whitespace-pre-wrap">{getPreviewBody()}</p>
              </div>

              {/* Variable Inputs */}
              {selectedTemplate.variableCount > 0 && (
                <div className="space-y-2">
                  {Array.from({ length: selectedTemplate.variableCount }, (_, i) => i + 1).map((num) => (
                    <div key={num}>
                      <label className="block text-xs font-medium text-analog-text-muted mb-1">
                        Variable {`{{${num}}`}
                        {selectedTemplate.variables[num] && (
                          <span className="text-analog-text-faint ml-1">e.g. {selectedTemplate.variables[num]}</span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={variableValues[num] || ''}
                        onChange={(e) => setVariableValues(prev => ({ ...prev, [num]: e.target.value }))}
                        placeholder={selectedTemplate.variables[num] || `Enter value for {{${num}}}`}
                        className="input w-full text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleUseTemplate}
                className="btn btn-primary w-full"
              >
                Use This Template
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
