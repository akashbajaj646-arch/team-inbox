// Parses a Gmail-style search string into structured filters.
// Supports: from:, to:, cc:, subject:, has:attachment, is:unread|read|starred,
// after:YYYY-MM-DD, before:YYYY-MM-DD, "quoted phrases", and free text.

export interface ParsedQuery {
  terms: string[];
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
  after?: string;
  before?: string;
}

function parseDate(v: string): string | undefined {
  const norm = v.replace(/\//g, '-');
  const d = new Date(/^\d{4}-\d{1,2}-\d{1,2}$/.test(norm) ? norm + 'T00:00:00' : norm);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], hasAttachment: false };
  const tokens = raw.match(/(\w+:"[^"]*"|\w+:\S+|"[^"]*"|\S+)/g) || [];
  for (const tok of tokens) {
    const m = tok.match(/^(\w+):(.*)$/);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/^"|"$/g, '').trim();
      if (!val) continue;
      if (key === 'from') { out.from = val; continue; }
      if (key === 'to' || key === 'cc') { out.to = val; continue; }
      if (key === 'subject') { out.subject = val; continue; }
      if (key === 'has' && /^attachments?$/i.test(val)) { out.hasAttachment = true; continue; }
      if (key === 'is') {
        const v = val.toLowerCase();
        if (v === 'unread') { out.isUnread = true; continue; }
        if (v === 'read') { out.isUnread = false; continue; }
        if (v === 'starred') { out.isStarred = true; continue; }
      }
      if (key === 'after' || key === 'since') { const d = parseDate(val); if (d) { out.after = d; continue; } }
      if (key === 'before') { const d = parseDate(val); if (d) { out.before = d; continue; } }
      // Unknown operator (e.g. a URL with a colon): treat as plain text
    }
    const term = tok.replace(/^"|"$/g, '').trim();
    if (term) out.terms.push(term);
  }
  return out;
}

export function isEmptyQuery(q: ParsedQuery): boolean {
  return (
    q.terms.length === 0 && !q.from && !q.to && !q.subject && !q.hasAttachment &&
    q.isUnread === undefined && q.isStarred === undefined && !q.after && !q.before
  );
}

/** Wrap as an ILIKE contains-pattern, escaping wildcards in user input. */
export function likePattern(s: string): string {
  return '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}
