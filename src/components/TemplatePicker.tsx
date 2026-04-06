'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Template } from '@/types';

interface TemplatePickerProps {
  inboxId: string;
  onSelect: (template: Template) => void;
}

export default function TemplatePicker({ inboxId, onSelect }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    loadTemplates();
  }, [inboxId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadTemplates() {
    const { data } = await supabase
      .from('templates')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    setTemplates(data || []);
    setLoading(false);
  }

  function handleSelect(template: Template) {
    onSelect(template);
    setIsOpen(false);
    setSearch('');
  }

  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.body.toLowerCase().includes(search.toLowerCase()) ||
      (t.category && t.category.toLowerCase().includes(search.toLowerCase()))
  );

  const groupedTemplates = filteredTemplates.reduce((acc, template) => {
    const category = template.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(template);
    return acc;
  }, {} as Record<string, Template[]>);

  if (loading || templates.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="btn btn-secondary text-sm"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        Templates
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-96 bg-analog-surface border-2 border-analog-border-strong rounded-xl shadow-analog-lg z-[999] overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b-2 border-analog-border-strong">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="input py-2 text-sm"
              autoFocus
            />
          </div>

          {/* Templates List */}
          <div className="max-h-96 overflow-y-auto p-2">
            {filteredTemplates.length === 0 ? (
              <div className="text-center py-6 text-analog-text-muted text-sm">
                No templates found
              </div>
            ) : (
              Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
                <div key={category} className="mb-2 last:mb-0">
                  <div className="px-3 py-2 text-[10px] font-semibold text-analog-text-faint uppercase tracking-wider">
                    {category}
                  </div>
                  {categoryTemplates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleSelect(template)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-analog-hover transition-all duration-150"
                    >
                      <p className="font-medium text-sm text-analog-text">{template.name}</p>
                      <p className="text-xs text-analog-text-faint line-clamp-2 mt-0.5">
                        {template.body}
                      </p>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
