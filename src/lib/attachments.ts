export const MAX_EMAIL_FILES = 30;
export const MAX_EMAIL_TOTAL_BYTES = 25 * 1024 * 1024; // 25MB
export const MAX_SMS_FILES = 5;
export const MAX_SMS_TOTAL_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_WHATSAPP_FILES = 30; // Sent as separate messages

export const RISKY_EXTENSIONS = ['.exe', '.bat', '.scr', '.com', '.cmd', '.msi', '.vbs', '.js', '.jar', '.app'];

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function getTotalSize(files: File[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

export function isRiskyFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return RISKY_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function validateEmailAttachments(files: File[]): { ok: boolean; error?: string; warnings?: string[] } {
  if (files.length > MAX_EMAIL_FILES) {
    return { ok: false, error: `Maximum ${MAX_EMAIL_FILES} files allowed. You have ${files.length}.` };
  }
  const total = getTotalSize(files);
  if (total > MAX_EMAIL_TOTAL_BYTES) {
    return { ok: false, error: `Total size (${formatFileSize(total)}) exceeds 25MB limit. Please remove some files or use Google Drive for large files.` };
  }
  const risky = files.filter(f => isRiskyFile(f.name));
  if (risky.length > 0) {
    return {
      ok: true,
      warnings: [`${risky.length} file(s) may be rejected by Gmail: ${risky.map(f => f.name).join(', ')}`]
    };
  }
  return { ok: true };
}

export function validateSmsAttachments(files: File[]): { ok: boolean; error?: string } {
  if (files.length > MAX_SMS_FILES) {
    return { ok: false, error: `SMS supports up to ${MAX_SMS_FILES} attachments per message.` };
  }
  const total = getTotalSize(files);
  if (total > MAX_SMS_TOTAL_BYTES) {
    return { ok: false, error: `Total size (${formatFileSize(total)}) exceeds 5MB SMS limit.` };
  }
  return { ok: true };
}
