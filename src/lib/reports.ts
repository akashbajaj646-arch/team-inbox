// Shared helpers for tracking reports

export type ReportField = 'subject' | 'body' | 'from';
export type ReportOperator = 'contains' | 'equals' | 'starts_with' | 'ends_with';

export interface ReportRule {
  field: ReportField;
  operator: ReportOperator;
  value: string;
}

export interface ReportDefinition {
  inbox_ids: string[];
  filters: ReportRule[];
  filter_logic: 'any' | 'all';
  min_opens: number | null;
  min_clicks: number | null;
  threshold_logic: 'any' | 'all';
  days_back: number | null;
  hide_replied: boolean;
}

const FIELDS: ReportField[] = ['subject', 'body', 'from'];
const OPERATORS: ReportOperator[] = ['contains', 'equals', 'starts_with', 'ends_with'];
const UUID_RE = /^[0-9a-f-]{36}$/i;

function toIntOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function sanitizeDefinition(input: any): ReportDefinition {
  const filters: ReportRule[] = Array.isArray(input?.filters)
    ? input.filters
        .filter((r: any) => r && FIELDS.includes(r.field) && typeof r.value === 'string' && r.value.trim() !== '')
        .map((r: any) => ({
          field: r.field,
          operator: OPERATORS.includes(r.operator) ? r.operator : 'contains',
          value: r.value.trim().slice(0, 500),
        }))
    : [];

  const days = toIntOrNull(input?.days_back);

  return {
    inbox_ids: Array.isArray(input?.inbox_ids) ? input.inbox_ids.filter((id: any) => typeof id === 'string' && UUID_RE.test(id)) : [],
    filters,
    filter_logic: input?.filter_logic === 'any' ? 'any' : 'all',
    min_opens: toIntOrNull(input?.min_opens),
    min_clicks: toIntOrNull(input?.min_clicks),
    threshold_logic: input?.threshold_logic === 'all' ? 'all' : 'any',
    days_back: days && days > 0 ? days : null,
    hide_replied: input?.hide_replied === true,
  };
}

// Email inboxes the user is a member of
export async function getUserEmailInboxes(service: any, userId: string) {
  const { data: memberships } = await service
    .from('inbox_members')
    .select('inbox_id')
    .eq('user_id', userId);
  const ids = (memberships || []).map((m: any) => m.inbox_id);
  if (ids.length === 0) return [];

  const { data: inboxes } = await service
    .from('inboxes')
    .select('id, name, email_address, inbox_type')
    .in('id', ids);
  return (inboxes || [])
    .filter((i: any) => !i.inbox_type || i.inbox_type === 'email')
    .map((i: any) => ({ id: i.id, name: i.name, email_address: i.email_address }));
}
