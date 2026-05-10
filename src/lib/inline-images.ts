export const MAX_INLINE_IMAGES = 5;
export const SIZES = {
  Small: '200',
  Medium: '400',
  Large: '600',
  Original: '',
} as const;

export type SizePreset = keyof typeof SIZES;

let cidCounter = 0;
export function generateCid(): string {
  cidCounter += 1;
  return `inline-${Date.now()}-${cidCounter}@team-inbox`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export interface InlineImage {
  cid: string;
  filename: string;
  mimeType: string;
  data: string; // base64
}

/**
 * Walks the HTML, finds all <img data-inline-cid="..."> tags,
 * and rewrites their src to "cid:<cid>" so Gmail renders them inline.
 * Returns the rewritten HTML and the list of inline images metadata.
 */
export function extractInlineImages(html: string, registry: Map<string, InlineImage>): {
  html: string;
  inlineImages: InlineImage[];
} {
  const used: InlineImage[] = [];
  const seenCids = new Set<string>();
  // Match <img ...> tags that have a data-inline-cid attribute
  const rewritten = html.replace(/<img\b[^>]*data-inline-cid="([^"]+)"[^>]*>/gi, (match, cid) => {
    const meta = registry.get(cid);
    if (!meta) return match;
    if (!seenCids.has(cid)) {
      used.push(meta);
      seenCids.add(cid);
    }
    // Replace src="..." with src="cid:..."
    return match.replace(/\s+src="[^"]*"/i, ` src="cid:${cid}"`);
  });
  return { html: rewritten, inlineImages: used };
}

/**
 * Attach a floating toolbar to the contentEditable element that appears
 * when inline images are clicked, with Small/Medium/Large/Original buttons.
 * Returns a cleanup function.
 */
export function attachImageResizer(editor: HTMLElement): () => void {
  let toolbar: HTMLDivElement | null = null;
  let activeImg: HTMLImageElement | null = null;

  function makeToolbar() {
    const div = document.createElement('div');
    div.contentEditable = 'false';
    div.style.cssText = 'position:fixed;z-index:99999;background:#fff;border:1px solid #e5e5e5;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:4px;display:flex;gap:2px;font-family:inherit;';
    (Object.keys(SIZES) as SizePreset[]).forEach(label => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.type = 'button';
      btn.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:500;background:none;border:0;border-radius:4px;cursor:pointer;color:#444;';
      btn.onmouseover = () => { btn.style.background = '#f3f4f6'; };
      btn.onmouseout = () => { btn.style.background = 'none'; };
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeImg) return;
        const w = SIZES[label];
        if (w) {
          activeImg.style.width = w + 'px';
          activeImg.style.maxWidth = '100%';
          activeImg.style.height = 'auto';
          activeImg.setAttribute('width', w);
        } else {
          activeImg.style.width = '';
          activeImg.style.maxWidth = '100%';
          activeImg.style.height = '';
          activeImg.removeAttribute('width');
        }
        positionToolbar();
      };
      div.appendChild(btn);
    });
    return div;
  }

  function positionToolbar() {
    if (!toolbar || !activeImg) return;
    const r = activeImg.getBoundingClientRect();
    // If toolbar would go above viewport, show it below the image instead
    const tbHeight = 36;
    let top = r.top - tbHeight - 4;
    if (top < 8) top = r.bottom + 4;
    toolbar.style.top = top + 'px';
    toolbar.style.left = Math.max(8, r.left) + 'px';
  }

  function showFor(img: HTMLImageElement) {
    activeImg = img;
    if (!toolbar) {
      toolbar = makeToolbar();
      document.body.appendChild(toolbar);
    }
    toolbar.style.display = 'flex';
    positionToolbar();
  }

  function hide() {
    if (toolbar) toolbar.style.display = 'none';
    activeImg = null;
  }

  function onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG' && (t as HTMLImageElement).dataset.inlineCid) {
      e.stopPropagation();
      showFor(t as HTMLImageElement);
    } else if (toolbar && !toolbar.contains(t)) {
      hide();
    }
  }

  editor.addEventListener('click', onClick);

  return () => {
    editor.removeEventListener('click', onClick);
    if (toolbar) toolbar.remove();
    toolbar = null;
    activeImg = null;
  };
}

/**
 * Wires paste and drop handlers to the editor for inline images.
 * onAdded is called with metadata after each image is inserted.
 * Returns a cleanup function.
 */
export function attachImagePasteHandler(
  editor: HTMLElement,
  options: {
    canAddMore: () => boolean;
    onTooMany: () => void;
    onAdded: (meta: InlineImage) => void;
    onWouldExceedSize: (additionalBytes: number) => boolean;
  }
): () => void {
  async function handleFiles(files: File[]) {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (images.length === 0) return;
    for (const file of images) {
      if (!options.canAddMore()) {
        options.onTooMany();
        return;
      }
      if (options.onWouldExceedSize(file.size)) {
        return;
      }
      const cid = generateCid();
      const dataUrl = await fileToDataUrl(file);
      const base64 = await fileToBase64(file);
      const meta: InlineImage = {
        cid,
        filename: file.name || `image-${Date.now()}.${file.type.split('/')[1] || 'png'}`,
        mimeType: file.type || 'image/png',
        data: base64,
      };
      // Insert at caret
      const img = document.createElement('img');
      img.src = dataUrl;
      img.setAttribute('data-inline-cid', cid);
      img.setAttribute('width', '400');
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.style.display = 'block';
      img.style.margin = '8px 0';

      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        // Move caret after the image
        range.setStartAfter(img);
        range.setEndAfter(img);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        editor.appendChild(img);
      }
      options.onAdded(meta);
    }
  }

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }

  function onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
    }
  }

  function onDrop(e: DragEvent) {
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.some(f => f.type.startsWith('image/'))) {
      e.preventDefault();
      handleFiles(files);
    }
  }

  editor.addEventListener('paste', onPaste);
  editor.addEventListener('dragover', onDragOver);
  editor.addEventListener('drop', onDrop);

  return () => {
    editor.removeEventListener('paste', onPaste);
    editor.removeEventListener('dragover', onDragOver);
    editor.removeEventListener('drop', onDrop);
  };
}
