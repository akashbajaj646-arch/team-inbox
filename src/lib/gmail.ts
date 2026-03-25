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
  
  return response.data as GmailThread;
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
    }>;
  }
) {
  const gmail = createGmailClient(refreshToken);
  
  let email: string;
  
  if (options.attachments && options.attachments.length > 0) {
    // Build multipart email with attachments
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
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
    emailLines.push('MIME-Version: 1.0');
    emailLines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    
    if (options.inReplyTo) {
      emailLines.push(`In-Reply-To: ${options.inReplyTo}`);
    }
    
    if (options.references) {
      emailLines.push(`References: ${options.references}`);
    }
    
    emailLines.push('');
    emailLines.push(`--${boundary}`);
    emailLines.push('Content-Type: text/html; charset=utf-8');
    emailLines.push('Content-Transfer-Encoding: 7bit');
    emailLines.push('');
    emailLines.push(options.body);
    
    // Add attachments
    for (const attachment of options.attachments) {
      emailLines.push(`--${boundary}`);
      emailLines.push(`Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`);
      emailLines.push('Content-Transfer-Encoding: base64');
      emailLines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
      emailLines.push('');
      
      // Split base64 data into 76-character lines (RFC 2045)
      const base64Data = attachment.data;
      for (let i = 0; i < base64Data.length; i += 76) {
        emailLines.push(base64Data.slice(i, i + 76));
      }
    }
    
    emailLines.push(`--${boundary}--`);
    
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
