// Open + click tracking for outbound emails.
// prepareTracking() instruments the HTML before send, finalizeTracking() links it to the Gmail message.

export const TRACKING_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || 'https://team-inbox-khaki.vercel.app';

const INTERNAL_DOMAINS = ['advanceapparels.com'];

// Ignore opens/clicks this soon after sending (link scanners, sender's own Gmail view)
export const TRACKING_GRACE_MS = 15_000;

// Security scanners and preview bots that "click" links automatically
export const BOT_UA = /bot|crawler|spider|slurp|preview|scanner|safelinks|barracuda|mimecast|proofpoint|messagelabs|symantec|headless|python-requests|curl|wget/i;

const PIXEL_RE = /<img[^>]*\/api\/track\/open\/[^>]*>/gi;
const TRACKED_HREF_RE = /https?:\/\/[^"'\s>]*\/api\/track\/click\/([0-9a-f-]{36})\/(\d+)/gi;

function extractAddresses(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    for (const part of (raw || '').split(',')) {
      const m = part.match(/<([^>]+)>/);
      const addr = (m ? m[1] : part).trim().toLowerCase();
      if (addr && addr.includes('@')) out.push(addr);
    }
  }
  return Array.from(new Set(out));
}

function isInternal(addr: string) {
  const domain = addr.split('@')[1] || '';
  return INTERNAL_DOMAINS.includes(domain);
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&#38;/g, '&');
}

function encodeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Turn plain-text URLs into real links so their clicks can be tracked.
// Only touches text outside tags, and never text already inside a link, style or script.
export function linkifyBareUrls(html: string): string {
  const parts = html.split(/(<[^>]+>)/g);
  let inAnchor = 0;
  let inRaw = 0;
  return parts
    .map((part) => {
      if (part.startsWith('<')) {
        const tag = part.toLowerCase();
        if (/^<a[\s>]/.test(tag)) inAnchor++;
        else if (tag.startsWith('</a')) inAnchor = Math.max(0, inAnchor - 1);
        else if (/^<(style|script)[\s>]/.test(tag)) inRaw++;
        else if (/^<\/(style|script)/.test(tag)) inRaw = Math.max(0, inRaw - 1);
        return part;
      }
      if (inAnchor || inRaw || !part) return part;
      return part.replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, (raw) => {
        // Keep trailing punctuation outside the link
        const m = raw.match(/^(.*?)([.,;:!?)\]]*)$/);
        const url = m ? m[1] : raw;
        const trail = m ? m[2] : '';
        if (!url || /^(https?:\/\/|www\.)$/i.test(url)) return raw;
        const href = /^www\./i.test(url) ? `https://${url}` : url;
        return `<a href="${href.replace(/"/g, '&quot;')}">${url}</a>${trail}`;
      });
    })
    .join('');
}

// Remove pixels and restore original links from earlier tracked emails (quoted history, forwards)
async function cleanOldTracking(service: any, html: string): Promise<string> {
  let out = html.replace(PIXEL_RE, '');
  const pairs = Array.from(out.matchAll(TRACKED_HREF_RE)).map((m) => ({ id: m[1], idx: Number(m[2]) }));
  if (pairs.length === 0) return out;

  const ids = Array.from(new Set(pairs.map((p) => p.id)));
  const { data } = await service
    .from('email_tracking_links')
    .select('tracking_id, idx, url')
    .in('tracking_id', ids);
  const map = new Map<string, string>();
  for (const row of data || []) map.set(`${row.tracking_id}/${row.idx}`, row.url);

  out = out.replace(TRACKED_HREF_RE, (full, id, idx) => {
    const url = map.get(`${id}/${idx}`);
    return url ? encodeAttr(url) : full;
  });
  return out;
}

export async function prepareTracking(
  service: any,
  opts: { inboxId: string; recipients: string[]; html: string }
): Promise<{ html: string; trackingId: string | null }> {
  try {
    const cleaned = await cleanOldTracking(service, opts.html);
    const recipients = extractAddresses(opts.recipients);

    // Internal-only emails are not tracked
    if (recipients.length === 0 || recipients.every(isInternal)) {
      return { html: cleaned, trackingId: null };
    }

    const { data: row, error } = await service
      .from('email_tracking')
      .insert({ inbox_id: opts.inboxId, recipients })
      .select('id')
      .limit(1)
      .maybeSingle();
    if (error || !row) {
      console.error('tracking: insert failed', error);
      return { html: cleaned, trackingId: null };
    }
    const trackingId: string = row.id;

    // Rewrite http(s) links to go through the click tracker (plain-text URLs become links first)
    const links: { tracking_id: string; idx: number; url: string }[] = [];
    let html = linkifyBareUrls(cleaned).replace(
      /(<a\b[^>]*?\bhref\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi,
      (full, pre, quote, href) => {
        const url = decodeEntities(href);
        if (url.startsWith(TRACKING_BASE_URL + '/api/track/')) return full;
        const idx = links.length;
        links.push({ tracking_id: trackingId, idx, url });
        return `${pre}${quote}${TRACKING_BASE_URL}/api/track/click/${trackingId}/${idx}${quote}`;
      }
    );

    if (links.length > 0) {
      const { error: linkErr } = await service.from('email_tracking_links').insert(links);
      if (linkErr) {
        // Links would 404 without their rows: send the untracked-links version instead
        console.error('tracking: link insert failed', linkErr);
        html = cleaned;
      }
    }

    const pixel = `<img src="${TRACKING_BASE_URL}/api/track/open/${trackingId}" width="1" height="1" alt="" style="width:1px;height:1px;border:0;" />`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${pixel}</body>`) : html + pixel;

    return { html, trackingId };
  } catch (err) {
    console.error('tracking: prepare failed, sending untracked', err);
    return { html: opts.html, trackingId: null };
  }
}

export async function finalizeTracking(service: any, trackingId: string | null, gmailMessageId: string) {
  if (!trackingId) return;
  const { error } = await service
    .from('email_tracking')
    .update({ gmail_message_id: gmailMessageId, sent_at: new Date().toISOString() })
    .eq('id', trackingId);
  if (error) console.error('tracking: finalize failed', trackingId, error);
}

export async function discardTracking(service: any, trackingId: string | null) {
  if (!trackingId) return;
  await service.from('email_tracking').delete().eq('id', trackingId);
}
