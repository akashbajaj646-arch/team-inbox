'use client';

import { useRef, useCallback, useEffect } from 'react';

export function useResizable(
  initialWidth: number,
  minWidth: number,
  maxWidth: number,
  storageKey?: string
) {
  const widthRef = useRef<number>(
    storageKey
      ? parseInt(sessionStorage.getItem(storageKey) || String(initialWidth))
      : initialWidth
  );
  const elementRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = widthRef.current;

    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - startX;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
      widthRef.current = newWidth;
      if (elementRef.current) {
        elementRef.current.style.width = `${newWidth}px`;
      }
      if (storageKey) {
        sessionStorage.setItem(storageKey, String(newWidth));
      }
    }

    function onMouseUp() {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [minWidth, maxWidth, storageKey]);

  useEffect(() => {
    if (elementRef.current) {
      elementRef.current.style.width = `${widthRef.current}px`;
    }
  }, []);

  return { elementRef, startResize, initialWidth: widthRef.current };
}
