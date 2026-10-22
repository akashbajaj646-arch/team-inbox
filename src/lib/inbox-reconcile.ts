import { listThreads } from '@/lib/gmail';

const MAX_PAGES = 20; // 20 x 500 = 10,000 inbox threads

/**
 * Makes is_archived match Gmail: a thread is in the inbox if Gmail lists it under in:inbox.
 * Only archives local threads when the full Gmail inbox listing was read, so a truncated
 * listing can never hide mail.
 */
export async function reconcileArchived(
  svc: any,
  inbox: { id: string; google_refresh_token: string }
): Promise<{ unarchived: number; archived: number; complete: boolean }> {
  const inGmailInbox = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const res = await listThreads(inbox.google_refresh_token, { q: 'in:inbox', maxResults: 500, pageToken });
    for (const t of res.threads) if (t.id) inGmailInbox.add(t.id);
    pageToken = res.nextPageToken ?? undefined;
    pages++;
  } while (pageToken && pages < MAX_PAGES);
  const complete = !pageToken;

  // Read local threads in pages (PostgREST caps a response at 1000 rows)
  const local: { id: string; gmail_thread_id: string | null; is_archived: boolean | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from('email_threads')
      .select('id, gmail_thread_id, is_archived')
      .eq('inbox_id', inbox.id)
      .is('deleted_at', null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    local.push(...data);
    if (data.length < 1000) break;
  }

  const toInbox = local.filter((t) => t.gmail_thread_id && inGmailInbox.has(t.gmail_thread_id) && t.is_archived !== false).map((t) => t.id);
  const toArchive = complete
    ? local.filter((t) => t.gmail_thread_id && !inGmailInbox.has(t.gmail_thread_id) && t.is_archived !== true).map((t) => t.id)
    : [];

  const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
  for (const c of chunks(toInbox)) await svc.from('email_threads').update({ is_archived: false }).in('id', c);
  for (const c of chunks(toArchive)) await svc.from('email_threads').update({ is_archived: true }).in('id', c);

  return { unarchived: toInbox.length, archived: toArchive.length, complete };
}
