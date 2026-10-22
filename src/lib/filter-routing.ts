/**
 * Routing of email threads into filtered (nested) inboxes.
 * A thread belongs to at most one filtered inbox: the first one (oldest first) whose rules match.
 * Used by every path that creates or updates threads, so mail lands in the right folder
 * no matter how it arrived (Gmail push, Sync button, search import).
 */

export interface FilterRule {
  field: 'from' | 'subject' | 'body' | string;
  operator: 'contains' | 'equals' | 'starts_with' | 'ends_with' | string;
  value: string;
}

export interface FilteredInboxRow {
  id: string;
  inbox_id: string;
  filters: FilterRule[];
  filter_logic: 'any' | 'all' | string;
}

interface Msg { from_address: string | null; from_name: string | null; body_text: string | null }

function check(str: string | null | undefined, rule: FilterRule): boolean {
  const s = (str || '').toLowerCase();
  const v = (rule.value || '').toLowerCase().trim();
  if (!v) return false;
  switch (rule.operator) {
    case 'contains': return s.includes(v);
    case 'equals': return s === v;
    case 'starts_with': return s.startsWith(v);
    case 'ends_with': return s.endsWith(v);
    default: return false;
  }
}

function ruleMatches(rule: FilterRule, subject: string, msgs: Msg[]): boolean {
  switch (rule.field) {
    case 'from': return msgs.some((m) => check(m.from_address, rule) || check(m.from_name, rule));
    case 'subject': return check(subject, rule);
    case 'body': return msgs.some((m) => check(m.body_text, rule));
    default: return false;
  }
}

export function matchesFilteredInbox(fi: FilteredInboxRow, subject: string, msgs: Msg[]): boolean {
  const rules = (fi.filters || []).filter((r) => (r.value || '').trim());
  if (rules.length === 0) return false;
  return fi.filter_logic === 'all'
    ? rules.every((r) => ruleMatches(r, subject, msgs))
    : rules.some((r) => ruleMatches(r, subject, msgs));
}

async function loadFilters(db: any, inboxId: string): Promise<FilteredInboxRow[]> {
  const { data } = await db
    .from('filtered_inboxes')
    .select('id, inbox_id, filters, filter_logic')
    .eq('inbox_id', inboxId)
    .order('created_at', { ascending: true });
  return data || [];
}

/**
 * Put one thread into the first matching filtered inbox. Leaves threads that are
 * already in a filtered inbox alone. Safe to call often; does nothing without filters.
 */
export async function routeThread(db: any, inboxId: string, threadId: string): Promise<string | null> {
  try {
    const filters = await loadFilters(db, inboxId);
    if (filters.length === 0) return null;

    const { data: thread } = await db
      .from('email_threads')
      .select('id, subject, filtered_inbox_id')
      .eq('id', threadId)
      .limit(1)
      .maybeSingle();
    if (!thread || thread.filtered_inbox_id) return thread?.filtered_inbox_id || null;

    const { data: msgs } = await db
      .from('email_messages')
      .select('from_address, from_name, body_text')
      .eq('thread_id', threadId);

    const match = filters.find((fi) => matchesFilteredInbox(fi, thread.subject || '', msgs || []));
    if (!match) return null;
    await db.from('email_threads').update({ filtered_inbox_id: match.id }).eq('id', threadId);
    return match.id;
  } catch (err) {
    console.error('routeThread failed:', err);
    return null;
  }
}

/**
 * Re-apply one filtered inbox to every thread in its parent inbox.
 * Takes unassigned threads that match; releases threads it holds that no longer match.
 * Never takes threads that another filtered inbox already holds.
 */
export async function backfillFilteredInbox(db: any, fi: FilteredInboxRow): Promise<{ applied: number; released: number }> {
  const threads: { id: string; subject: string | null; filtered_inbox_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from('email_threads')
      .select('id, subject, filtered_inbox_id')
      .eq('inbox_id', fi.inbox_id)
      .or(`filtered_inbox_id.is.null,filtered_inbox_id.eq.${fi.id}`)
      .order('last_message_at', { ascending: false })
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    threads.push(...data);
    if (data.length < 1000) break;
  }

  const toAssign: string[] = [];
  const toRelease: string[] = [];
  const BATCH = 50; // keeps each request URL short
  for (let i = 0; i < threads.length; i += BATCH) {
    const batch = threads.slice(i, i + BATCH);
    const { data: msgs } = await db
      .from('email_messages')
      .select('thread_id, from_address, from_name, body_text')
      .in('thread_id', batch.map((t) => t.id));
    const byThread: Record<string, Msg[]> = {};
    for (const m of msgs || []) (byThread[m.thread_id] ||= []).push(m);

    for (const t of batch) {
      const matches = matchesFilteredInbox(fi, t.subject || '', byThread[t.id] || []);
      if (matches && t.filtered_inbox_id !== fi.id) toAssign.push(t.id);
      if (!matches && t.filtered_inbox_id === fi.id) toRelease.push(t.id);
    }
  }

  for (let i = 0; i < toAssign.length; i += 200) {
    await db.from('email_threads').update({ filtered_inbox_id: fi.id }).in('id', toAssign.slice(i, i + 200));
  }
  for (let i = 0; i < toRelease.length; i += 200) {
    await db.from('email_threads').update({ filtered_inbox_id: null }).in('id', toRelease.slice(i, i + 200));
  }
  return { applied: toAssign.length, released: toRelease.length };
}
