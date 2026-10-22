export type ThreadAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'trash' | 'restore' | 'snooze' | 'unsnooze';

export async function threadAction(threadIds: string[], action: ThreadAction, until?: string): Promise<boolean> {
  if (threadIds.length === 0) return true;
  try {
    const res = await fetch('/api/emails/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadIds, action, until }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Snooze presets in local time, Gmail style. */
export function snoozeOptions(now = new Date()): { label: string; detail: string; until: Date }[] {
  const at = (d: Date, h: number) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
  const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const fmt = (d: Date) => d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

  const laterToday = new Date(now.getTime() + 3 * 3600 * 1000);
  laterToday.setMinutes(0, 0, 0);
  const tomorrow = at(addDays(now, 1), 8);
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  const nextWeek = at(addDays(now, daysToMonday), 8);
  const daysToSat = ((6 - now.getDay()) + 7) % 7 || 7;
  const weekend = at(addDays(now, daysToSat), 8);

  const opts = [
    { label: 'Later today', until: laterToday },
    { label: 'Tomorrow', until: tomorrow },
    { label: 'This weekend', until: weekend },
    { label: 'Next week', until: nextWeek },
  ];
  // Drop "later today" late in the evening, and "this weekend" on weekends
  return opts
    .filter((o) => !(o.label === 'Later today' && laterToday.getDate() !== now.getDate()))
    .filter((o) => !(o.label === 'This weekend' && (now.getDay() === 0 || now.getDay() === 6)))
    .map((o) => ({ ...o, detail: fmt(o.until) }));
}
