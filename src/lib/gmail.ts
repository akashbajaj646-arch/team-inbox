import { google } from 'googleapis';
import type { GmailMessage, GmailThread } from '@/types';

// Create OAuth2 client
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Generate authorization URL
export function getAuthUrl(state?: string) {
  const oauth2Client = createOAuth2Client();
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    prompt: 'consent', // Force consent to get refresh token
    state,
  });
}

// Exchange code for tokens
export async function getTokensFromCode(code: string) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Create authenticated Gmail client
export function createGmailClient(refreshToken: string) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Get user's email address
export async function getUserEmail(refreshToken: string): Promise<string> {
  const gmail = createGmailClient(refreshToken);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress || '';
}

// List threads from inbox
export async function listThreads(
  refreshToken: string,
  options: {
    maxResults?: number;
    pageToken?: string;
    q?: string;
  } = {}
) {
  const gmail = createGmailClient(refreshToken);
  
  const response = await gmail.users.threads.list({
    userId: 'me',
    maxResults: options.maxResults || 20,
    pageToken: options.pageToken,
    q: options.q || 'in:inbox',
  });
  
  return {
    threads: response.data.threads || [],
    nextPageToken: response.data.nextPageToken,
  };
}

// Get full thread with messages
export async function getThread(
  refreshToken: string,
  threadId: string
): Promise<GmailThread> {
  const gmail = createGmailClient(refreshToken);
  
  const response = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });
  
  const thread = response.data as GmailThread;

  // Drop Gmail draft revisions — composing in Gmail autosaves many draft
  // snapshots into the thread, each with its own message id. They are not
  // real sent/received messages and must never appear in the thread view.
  if (thread.messages?.length) {
    thread.messages = thread.messages.filter(
      (m) => !m.labelIds?.includes('DRAFT')
    );
  }

  return thread;
}

// Parse email headers
export function parseHeaders(headers: Array<{ name: string; value: string }>) {
  const result: Record<string, string> = {};
  
  for (const header of headers) {
    result[header.name.toLowerCase()] = header.value;
  }
  
  return result;
}

// Parse email address from header value like "Name <email@example.com>"
export function parseEmailAddress(value: string): { name: string | null; address: string } {
  if (!value) return { name: null, address: '' };
  
  // Format: "Name <email@domain.com>" or "<email@domain.com>"
  const angleMatch = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].trim() || null,
      address: angleMatch[2].trim(),
    };
  }
  
  // Plain email address
  const emailMatch = value.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    return { name: null, address: emailMatch[0].trim() };
  }
  
  return { name: null, address: value.trim() };
}

// Decode base64url encoded content
export function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// Extract body from message
export function extractBody(message: GmailMessage): { html: string | null; text: string | null } {
  let html: string | null = null;
  let text: string | null = null;
  
  function processPayload(payload: GmailMessage['payload']) {
    if (payload.body?.data) {
      if (payload.mimeType === 'text/html') {
        html = decodeBase64Url(payload.body.data);
      } else if (payload.mimeType === 'text/plain') {
        text = decodeBase64Url(payload.body.data);
      }
    }
    
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.body?.data) {
          if (part.mimeType === 'text/html') {
            html = decodeBase64Url(part.body.data);
          } else if (part.mimeType === 'text/plain') {
            text = decodeBase64Url(part.body.data);
          }
        }
        
        // Handle nested parts (multipart/alternative inside multipart/mixed)
        if (part.parts) {
          for (const nestedPart of part.parts) {
            if (nestedPart.body?.data) {
              if (nestedPart.mimeType === 'text/html') {
                html = decodeBase64Url(nestedPart.body.data);
              } else if (nestedPart.mimeType === 'text/plain') {
                text = decodeBase64Url(nestedPart.body.data);
              }
            }
          }
        }
      }
    }
  }
  
  processPayload(message.payload);
  
  return { html, text };
}

// Send email reply
export async function sendReply(
  refreshToken: string,
  options: {
    threadId: string;
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    references?: string;
    attachments?: Array<{
      filename: string;
      mimeType: string;
      data: string; // base64 encoded
      inline?: boolean;
      cid?: string;
    }>;
  }
) {
  const gmail = createGmailClient(refreshToken);
  
  let email: string;
  
  if (options.attachments && options.attachments.length > 0) {
    // Separate inline (CID-referenced) from regular attachments
    const inlineAttachments = options.attachments.filter((a: any) => a.inline && a.cid);
    const regularAttachments = options.attachments.filter((a: any) => !a.inline);
    const hasInline = inlineAttachments.length > 0;
    const hasRegular = regularAttachments.length > 0;

    const mixedBoundary = `mixed_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    const relatedBoundary = `related_${Date.now()}_${Math.random().toString(36).substr(2)}`;

    const emailLines = [
      `To: ${options.to}`,
    ];

    if (options.cc) emailLines.push(`Cc: ${options.cc}`);
    if (options.bcc) emailLines.push(`Bcc: ${options.bcc}`);

    emailLines.push(`Subject: ${options.subject}`);
    emailLines.push('MIME-Version: 1.0');

    // Choose top-level Content-Type based on what we have
    if (hasRegular) {
      emailLines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    } else {
      // Only inline images: multipart/related at the top level
      emailLines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`);
    }

    if (options.inReplyTo) emailLines.push(`In-Reply-To: ${options.inReplyTo}`);
    if (options.references) emailLines.push(`References: ${options.references}`);

    emailLines.push('');

    if (hasRegular && hasInline) {
      // Outer mixed: related part + each regular attachment
      emailLines.push(`--${mixedBoundary}`);
      emailLines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`);
      emailLines.push('');
      // HTML body
      emailLines.push(`--${relatedBoundary}`);
      emailLines.push('Content-Type: text/html; charset=utf-8');
      emailLines.push('Content-Transfer-Encoding: 7bit');
      emailLines.push('');
      emailLines.push(options.body);
      // Inline images
      for (const a of inlineAttachments) {
        emailLines.push(`--${relatedBoundary}`);
        emailLines.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
        emailLines.push('Content-Transfer-Encoding: base64');
        emailLines.push(`Content-Disposition: inline; filename="${a.filename}"`);
        emailLines.push(`Content-ID: <${a.cid}>`);
        emailLines.push('');
        for (let i = 0; i < a.data.length; i += 76) emailLines.push(a.data.slice(i, i + 76));
      }
      emailLines.push(`--${relatedBoundary}--`);
      // Regular attachments
      for (const a of regularAttachments) {
        emailLines.push(`--${mixedBoundary}`);
        emailLines.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
        emailLines.push('Content-Transfer-Encoding: base64');
        emailLines.push(`Content-Disposition: attachment; filename="${a.filename}"`);
        emailLines.push('');
        for (let i = 0; i < a.data.length; i += 76) emailLines.push(a.data.slice(i, i + 76));
      }
      emailLines.push(`--${mixedBoundary}--`);
    } else if (hasInline) {
      // Only inline (we used multipart/related at top)
      emailLines.push(`--${relatedBoundary}`);
      emailLines.push('Content-Type: text/html; charset=utf-8');
      emailLines.push('Content-Transfer-Encoding: 7bit');
      emailLines.push('');
      emailLines.push(options.body);
      for (const a of inlineAttachments) {
        emailLines.push(`--${relatedBoundary}`);
        emailLines.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
        emailLines.push('Content-Transfer-Encoding: base64');
        emailLines.push(`Content-Disposition: inline; filename="${a.filename}"`);
        emailLines.push(`Content-ID: <${a.cid}>`);
        emailLines.push('');
        for (let i = 0; i < a.data.length; i += 76) emailLines.push(a.data.slice(i, i + 76));
      }
      emailLines.push(`--${relatedBoundary}--`);
    } else {
      // Only regular attachments — original flow
      emailLines.push(`--${mixedBoundary}`);
      emailLines.push('Content-Type: text/html; charset=utf-8');
      emailLines.push('Content-Transfer-Encoding: 7bit');
      emailLines.push('');
      emailLines.push(options.body);
      for (const a of regularAttachments) {
        emailLines.push(`--${mixedBoundary}`);
        emailLines.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
        emailLines.push('Content-Transfer-Encoding: base64');
        emailLines.push(`Content-Disposition: attachment; filename="${a.filename}"`);
        emailLines.push('');
        for (let i = 0; i < a.data.length; i += 76) emailLines.push(a.data.slice(i, i + 76));
      }
      emailLines.push(`--${mixedBoundary}--`);
    }

    email = emailLines.join('\r\n');
  } else {
    // Build simple email without attachments
    const emailLines = [
      `To: ${options.to}`,
    ];
    
    if (options.cc) {
      emailLines.push(`Cc: ${options.cc}`);
    }
    
    if (options.bcc) {
      emailLines.push(`Bcc: ${options.bcc}`);
    }
    
    emailLines.push(`Subject: ${options.subject}`);
    emailLines.push('Content-Type: text/html; charset=utf-8');
    emailLines.push('MIME-Version: 1.0');
    
    if (options.inReplyTo) {
      emailLines.push(`In-Reply-To: ${options.inReplyTo}`);
    }
    
    if (options.references) {
      emailLines.push(`References: ${options.references}`);
    }
    
    emailLines.push('', options.body);
    
    email = emailLines.join('\r\n');
  }
  
  const encodedEmail = Buffer.from(email).toString('base64url');
  
  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedEmail,
      threadId: options.threadId,
    },
  });
  
  return response.data;
}

// Mark thread as read
export async function markThreadAsRead(refreshToken: string, threadId: string) {
  const gmail = createGmailClient(refreshToken);
  
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
}

// Archive thread
export async function archiveThread(refreshToken: string, threadId: string) {
  const gmail = createGmailClient(refreshToken);
  
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      removeLabelIds: ['INBOX'],
    },
  });
}

// Extract attachments from message parts
export function extractAttachments(message: GmailMessage): Array<{
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  isInline?: boolean;
  contentId?: string;
}> {
  const attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
    isInline?: boolean;
    contentId?: string;
  }> = [];

  function processParts(parts: any[]) {
    for (const part of parts) {
      if (part.body?.attachmentId) {
        // Include both regular and inline attachments
        const contentDisposition = part.headers?.find((h: any) => h.name.toLowerCase() === 'content-disposition')?.value || '';
        const contentId = part.headers?.find((h: any) => h.name.toLowerCase() === 'content-id')?.value || '';
        const filename = part.filename || contentId.replace(/[<>]/g, '') || `attachment.${part.mimeType?.split('/')[1] || 'bin'}`;
        attachments.push({
          filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
          isInline: contentDisposition.includes('inline') || (!!contentId && !part.filename),
          contentId: contentId.replace(/[<>]/g, ''),
        });
      }
      if (part.parts) {
        processParts(part.parts);
      }
    }
  }

  if (message.payload?.parts) {
    processParts(message.payload.parts);
  } else if ((message.payload as any)?.filename && (message.payload as any)?.body?.attachmentId) {
    // Single-part message with attachment at top level
    const p = message.payload as any;
    attachments.push({
      filename: p.filename,
      mimeType: p.mimeType || 'application/octet-stream',
      size: p.body.size || 0,
      attachmentId: p.body.attachmentId,
    });
  }

  return attachments;
}

// Download attachment data from Gmail
export async function getAttachment(
  refreshToken: string,
  messageId: string,
  attachmentId: string
): Promise<string> {
  const gmail = createGmailClient(refreshToken);
  const response = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  return response.data.data || '';
}

// Report message as spam
export async function reportSpam(refreshToken: string, gmailMessageId: string) {
  const gmail = createGmailClient(refreshToken);
  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailMessageId,
    requestBody: {
      addLabelIds: ['SPAM'],
      removeLabelIds: ['INBOX'],
    },
  });
}

// Get List-Unsubscribe header from a message
export async function getUnsubscribeInfo(refreshToken: string, gmailMessageId: string): Promise<{ mailto: string | null; http: string | null }> {
  const gmail = createGmailClient(refreshToken);
  const msg = await gmail.users.messages.get({ userId: 'me', id: gmailMessageId, format: 'metadata', metadataHeaders: ['List-Unsubscribe'] });
  const header = msg.data.payload?.headers?.find((h: any) => h.name.toLowerCase() === 'list-unsubscribe')?.value || '';
  const mailtoMatch = header.match(/<mailto:([^>]+)>/i);
  const httpMatch = header.match(/<(https?:\/\/[^>]+)>/i);
  return {
    mailto: mailtoMatch?.[1] || null,
    http: httpMatch?.[1] || null,
  };
}

// Send unsubscribe via mailto
export async function sendUnsubscribeEmail(refreshToken: string, mailtoAddress: string, fromEmail: string) {
  const gmail = createGmailClient(refreshToken);
  const lines = [
    `To: ${mailtoAddress}`,
    `From: ${fromEmail}`,
    `Subject: Unsubscribe`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Unsubscribe',
  ];
  const email = lines.join('\r\n');
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: Buffer.from(email).toString('base64url') },
  });
}

// Send a new email (not a reply) - used for broadcasts
export async function sendNewEmail(
  refreshToken: string,
  options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    attachments?: Array<{ filename: string; mimeType: string; data: string; inline?: boolean; cid?: string }>;
  }
) {
  const gmail = createGmailClient(refreshToken);
  let email: string;

  if (options.attachments && options.attachments.length > 0) {
    const inlineAttachments = options.attachments.filter((a: any) => a.inline && a.cid);
    const regularAttachments = options.attachments.filter((a: any) => !a.inline);
    const hasInline = inlineAttachments.length > 0;
    const hasRegular = regularAttachments.length > 0;

    const mixedBoundary = `mixed_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    const relatedBoundary = `related_${Date.now()}_${Math.random().toString(36).substr(2)}`;

    const lines: string[] = [`To: ${options.to}`];
    if (options.cc) lines.push(`Cc: ${options.cc}`);
    if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
    lines.push(`Subject: ${options.subject}`);
    lines.push('MIME-Version: 1.0');

    if (hasRegular) {
      lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    } else {
      lines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`);
    }
    lines.push('');

    if (hasRegular && hasInline) {
      lines.push(`--${mixedBoundary}`);
      lines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`);
      lines.push('');
      lines.push(`--${relatedBoundary}`);
      lines.push('Content-Type: text/html; charset=utf-8');
      lines.push('Content-Transfer-Encoding: 7bit');
      lines.push('');
      lines.push(options.body);
      for (const a of inlineAttachments) {
        lines.push(`--${relatedBoundary}`);
        lines.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
        lines.push('Content-Transfer-Encoding: base64');
        lines.push(`Content-Disposition: inline; filename="${a.filename}"`);
        lines.push(`Content-ID: <${a.cid}>`);
        lines.push('');
        for (let i = 0; i < a.data.length; i += 76) lines.push(a.data.slice(i, i + 76));
      }
      lines.push(`--${relatedBoundary}--`);
      for (const a of regularAttachments) {
        lines.push(`--${mixedBoundary}`);
        lines.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
        lines.push('Content-Transfer-Encoding: base64');
        lines.push(`Content-Disposition: attachment; filename="${a.filename}"`);
        lines.push('');
        for (let i = 0; i < a.data.length; i += 76) lines.push(a.data.slice(i, i + 76));
      }
      lines.push(`--${mixedBoundary}--`);
    } else if (hasInline) {
      lines.push(`--${relatedBoundary}`);
      lines.push('Content-Type: text/html; charset=utf-8');
      lines.push('Content-Transfer-Encoding: 7bit');
      lines.push('');
      lines.push(options.body);
      for (const a of inlineAttachments) {
        lines.push(`--${relatedBoundary}`);
        lines.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
        lines.push('Content-Transfer-Encoding: base64');
        lines.push(`Content-Disposition: inline; filename="${a.filename}"`);
        lines.push(`Content-ID: <${a.cid}>`);
        lines.push('');
        for (let i = 0; i < a.data.length; i += 76) lines.push(a.data.slice(i, i + 76));
      }
      lines.push(`--${relatedBoundary}--`);
    } else {
      lines.push(`--${mixedBoundary}`);
      lines.push('Content-Type: text/html; charset=utf-8');
      lines.push('Content-Transfer-Encoding: 7bit');
      lines.push('');
      lines.push(options.body);
      for (const a of regularAttachments) {
        lines.push(`--${mixedBoundary}`);
        lines.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
        lines.push('Content-Transfer-Encoding: base64');
        lines.push(`Content-Disposition: attachment; filename="${a.filename}"`);
        lines.push('');
        for (let i = 0; i < a.data.length; i += 76) lines.push(a.data.slice(i, i + 76));
      }
      lines.push(`--${mixedBoundary}--`);
    }

    email = lines.join('\r\n');
  } else {
    const headers = [
      `To: ${options.to}`,
      options.cc ? `Cc: ${options.cc}` : '',
      options.bcc ? `Bcc: ${options.bcc}` : '',
      `Subject: ${options.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
    ].filter(Boolean);
    // CRITICAL: blank line separates headers from body per RFC 2822
    email = headers.join('\r\n') + '\r\n\r\n' + options.body;
  }

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: Buffer.from(email).toString('base64url') },
  });
  return response.data;
}

// List thread IDs changed since a given historyId (for efficient pubsub sync)
export async function listHistory(
  refreshToken: string,
  startHistoryId: string
): Promise<{ threadIds: string[]; expired: boolean }> {
  const gmail = createGmailClient(refreshToken);
  const threadIds = new Set<string>();

  try {
    let pageToken: string | undefined = undefined;
    do {
      const res: any = await gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        pageToken,
      });

      for (const h of res.data.history || []) {
        for (const added of h.messagesAdded || []) {
          if (added.message?.threadId) threadIds.add(added.message.threadId);
        }
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    return { threadIds: Array.from(threadIds), expired: false };
  } catch (err: any) {
    if (err?.code === 404 || err?.response?.status === 404) {
      return { threadIds: [], expired: true };
    }
    throw err;
  }
}
