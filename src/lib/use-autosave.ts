import { useEffect, useRef } from 'react';

interface UseAutoSaveOptions<T> {
  data: T;
  shouldSave: (data: T) => boolean;
  save: (data: T) => Promise<void>;
  delayMs?: number;
}

export function useAutoSave<T>({ data, shouldSave, save, delayMs = 2000 }: UseAutoSaveOptions<T>) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!shouldSave(data)) return;
    timerRef.current = setTimeout(() => {
      save(dataRef.current).catch(err => console.error('Auto-save failed:', err));
    }, delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [JSON.stringify(data)]);

  // Flush helper that callers can invoke (e.g. on close)
  async function flush() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (shouldSave(dataRef.current)) {
      try { await save(dataRef.current); } catch (err) { console.error('Flush save failed:', err); }
    }
  }

  return { flush };
}
