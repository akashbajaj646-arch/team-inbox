'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { useState, useCallback, useEffect, useRef } from 'react';
import SkuPicker from './SkuPicker';

interface Product {
  product_id: string;
  style_number: string;
  description: string | null;
  category: string | null;
  price: number | null;
  image_url: string | null;
}

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  productCatalogUrl?: string;
}

export default function RichTextEditor({ 
  content, 
  onChange, 
  placeholder = 'Write your reply...',
  productCatalogUrl = 'http://localhost:3002'
}: RichTextEditorProps) {
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [showSkuPicker, setShowSkuPicker] = useState(false);
  const [skuSearchQuery, setSkuSearchQuery] = useState('');
  const [skuPickerPosition, setSkuPickerPosition] = useState({ top: 0, left: 0 });
  const [skuTriggerStart, setSkuTriggerStart] = useState<number | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-analog-accent underline',
        },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
      checkForSkuTrigger(editor);
    },
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[100px]',
      },
    },
  });

  function checkForSkuTrigger(editorInstance: any) {
    const { state } = editorInstance;
    const { selection } = state;
    const { $from } = selection;
    
    // Get text before cursor
    const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
    
    // Check for /sku: pattern
    const skuMatch = textBefore.match(/\/sku:(\S*)$/);
    
    if (skuMatch) {
      const query = skuMatch[1];
      setSkuSearchQuery(query);
      setSkuTriggerStart($from.pos - skuMatch[0].length);
      
      // Position the picker
      if (editorContainerRef.current) {
        const rect = editorContainerRef.current.getBoundingClientRect();
        setSkuPickerPosition({
          top: 60, // Below the toolbar
          left: 10,
        });
      }
      
      setShowSkuPicker(true);
    } else {
      if (showSkuPicker) {
        setShowSkuPicker(false);
        setSkuSearchQuery('');
        setSkuTriggerStart(null);
      }
    }
  }

  function handleSkuSelect(product: Product) {
    if (!editor || skuTriggerStart === null) return;
    
    const { state } = editor;
    const { selection } = state;
    const currentPos = selection.$from.pos;
    
    // Delete the /sku:query text
    editor
      .chain()
      .focus()
      .deleteRange({ from: skuTriggerStart, to: currentPos })
      .insertContent([
        {
          type: 'text',
          marks: [
            {
              type: 'link',
              attrs: {
                href: `${productCatalogUrl}/product/${product.style_number}`,
                target: '_blank',
              },
            },
          ],
          text: product.style_number,
        },
        {
          type: 'text',
          text: ' ',
        },
      ])
      .run();
    
    setShowSkuPicker(false);
    setSkuSearchQuery('');
    setSkuTriggerStart(null);
  }

  function handleSkuPickerClose() {
    setShowSkuPicker(false);
    setSkuSearchQuery('');
    setSkuTriggerStart(null);
  }

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const setLink = useCallback(() => {
    if (!editor) return;

    if (linkUrl === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    setLinkUrl('');
    setShowLinkInput(false);
  }, [editor, linkUrl]);

  if (!editor) {
    return null;
  }

  const ToolbarButton = ({ 
    onClick, 
    isActive = false, 
    disabled = false,
    title,
    children 
  }: { 
    onClick: () => void; 
    isActive?: boolean; 
    disabled?: boolean;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-all duration-150 ${
        isActive 
          ? 'bg-analog-accent text-white' 
          : 'text-analog-text-faint hover:text-analog-text hover:bg-analog-hover'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );

  const Divider = () => (
    <div className="w-px h-5 bg-analog-border mx-2" />
  );

  return (
    <div ref={editorContainerRef} className="border border-analog-border rounded-lg overflow-hidden bg-analog-surface relative">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-3 py-2.5 border-b border-analog-border bg-analog-surface">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold (Ctrl+B)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic (Ctrl+I)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <line x1="19" y1="4" x2="10" y2="4" />
            <line x1="14" y1="20" x2="5" y2="20" />
            <line x1="15" y1="4" x2="9" y2="20" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          title="Underline (Ctrl+U)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3" />
            <line x1="4" y1="21" x2="20" y2="21" />
          </svg>
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          isActive={editor.isActive({ textAlign: 'left' })}
          title="Align Left"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="15" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          isActive={editor.isActive({ textAlign: 'center' })}
          title="Align Center"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="6" y1="12" x2="18" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          isActive={editor.isActive({ textAlign: 'right' })}
          title="Align Right"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="9" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <line x1="9" y1="6" x2="20" y2="6" />
            <line x1="9" y1="12" x2="20" y2="12" />
            <line x1="9" y1="18" x2="20" y2="18" />
            <circle cx="4" cy="6" r="1.5" fill="currentColor" />
            <circle cx="4" cy="12" r="1.5" fill="currentColor" />
            <circle cx="4" cy="18" r="1.5" fill="currentColor" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Numbered List"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <line x1="10" y1="6" x2="21" y2="6" />
            <line x1="10" y1="12" x2="21" y2="12" />
            <line x1="10" y1="18" x2="21" y2="18" />
            <text x="3" y="8" fontSize="8" fill="currentColor" fontFamily="sans-serif">1</text>
            <text x="3" y="14" fontSize="8" fill="currentColor" fontFamily="sans-serif">2</text>
            <text x="3" y="20" fontSize="8" fill="currentColor" fontFamily="sans-serif">3</text>
          </svg>
        </ToolbarButton>

        <Divider />

        <div className="relative">
          <ToolbarButton
            onClick={() => {
              if (editor.isActive('link')) {
                editor.chain().focus().unsetLink().run();
              } else {
                setShowLinkInput(!showLinkInput);
              }
            }}
            isActive={editor.isActive('link')}
            title="Add Link"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </ToolbarButton>

          {showLinkInput && (
            <div className="absolute top-full left-0 mt-2 p-3 bg-analog-surface border border-analog-border rounded-lg shadow-analog-lg z-10 flex gap-2">
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                className="input px-3 py-1.5 text-sm w-48"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setLink();
                  }
                  if (e.key === 'Escape') {
                    setShowLinkInput(false);
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                onClick={setLink}
                className="btn btn-primary px-3 py-1.5 text-sm"
              >
                Add
              </button>
            </div>
          )}
        </div>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          title="Quote"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4z" />
          </svg>
        </ToolbarButton>

        <Divider />

        {/* SKU Button */}
        <ToolbarButton
          onClick={() => {
            editor.chain().focus().insertContent('/sku:').run();
          }}
          title="Insert Product Link (/sku:)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        </ToolbarButton>
      </div>

      {/* Editor Content */}
      <EditorContent editor={editor} />

      {/* SKU Picker */}
      {showSkuPicker && (
        <SkuPicker
          searchQuery={skuSearchQuery}
          onSelect={handleSkuSelect}
          onClose={handleSkuPickerClose}
          position={skuPickerPosition}
        />
      )}
    </div>
  );
}
