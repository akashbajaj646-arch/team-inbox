-- Migration: Tracking reports (saved report definitions + report function)
-- Run this in your Supabase SQL Editor

create table if not exists email_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  inbox_ids uuid[] not null default '{}',
  filters jsonb not null default '[]'::jsonb,
  filter_logic text not null default 'all' check (filter_logic in ('any','all')),
  min_opens integer,
  min_clicks integer,
  threshold_logic text not null default 'any' check (threshold_logic in ('any','all')),
  days_back integer,
  hide_replied boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Accessed only through API routes with the service role
alter table email_reports enable row level security;

create index if not exists idx_email_tracking_gmail_msg on email_tracking(gmail_message_id);
create index if not exists idx_email_tracking_inbox_sent on email_tracking(inbox_id, sent_at desc);

-- Rule matcher: contains / equals / starts_with / ends_with, case-insensitive
create or replace function tracking_rule_match(p_val text, p_op text, p_needle text)
returns boolean language sql immutable as $$
  select case coalesce(p_op, 'contains')
    when 'equals' then lower(coalesce(p_val,'')) = lower(coalesce(p_needle,''))
    when 'starts_with' then left(lower(coalesce(p_val,'')), length(coalesce(p_needle,''))) = lower(coalesce(p_needle,''))
    when 'ends_with' then right(lower(coalesce(p_val,'')), length(coalesce(p_needle,''))) = lower(coalesce(p_needle,''))
    else position(lower(coalesce(p_needle,'')) in lower(coalesce(p_val,''))) > 0
  end
$$;

-- One row per external recipient, totals across all matching tracked emails
create or replace function run_tracking_report(
  p_inbox_ids uuid[],
  p_filters jsonb default '[]'::jsonb,
  p_filter_logic text default 'all',
  p_min_opens integer default null,
  p_min_clicks integer default null,
  p_threshold_logic text default 'any',
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_hide_replied boolean default false
)
returns table (
  recipient text,
  recipient_domain text,
  emails_sent bigint,
  views bigint,
  clicks bigint,
  first_sent_at timestamptz,
  last_sent_at timestamptz,
  last_viewed_at timestamptz,
  last_clicked_at timestamptz,
  latest_subject text,
  latest_thread_id uuid,
  top_link text,
  top_link_clicks integer,
  has_replied boolean
)
language sql stable
as $$
with sent as (
  select
    t.id as tid,
    t.recipients as rcpts,
    t.sent_at as t_sent,
    coalesce(t.open_count, 0) as t_opens,
    coalesce(t.click_count, 0) as t_clicks,
    t.last_opened_at as t_last_open,
    t.last_clicked_at as t_last_click,
    m.thread_id as th_id,
    m.from_address as t_from,
    coalesce(nullif(m.body_text, ''), regexp_replace(coalesce(m.body_html, ''), '<[^>]+>', ' ', 'g')) as t_body,
    th.subject as t_subject
  from email_tracking t
  join email_messages m on m.gmail_message_id = t.gmail_message_id
  join email_threads th on th.id = m.thread_id
  where t.inbox_id = any(p_inbox_ids)
    and t.sent_at is not null
    and (p_date_from is null or t.sent_at >= p_date_from)
    and (p_date_to is null or t.sent_at < p_date_to)
),
matched as (
  select s.* from sent s
  where coalesce(jsonb_array_length(p_filters), 0) = 0
     or (p_filter_logic = 'any' and exists (
          select 1 from jsonb_array_elements(p_filters) f
          where tracking_rule_match(
            case f->>'field' when 'subject' then s.t_subject when 'body' then s.t_body when 'from' then s.t_from end,
            f->>'operator', f->>'value')))
     or (p_filter_logic <> 'any' and not exists (
          select 1 from jsonb_array_elements(p_filters) f
          where not tracking_rule_match(
            case f->>'field' when 'subject' then s.t_subject when 'body' then s.t_body when 'from' then s.t_from end,
            f->>'operator', f->>'value')))
),
per_rcpt as (
  select
    lower(trim(r)) as rcpt,
    count(*) as n_sent,
    sum(s.t_opens) as n_views,
    sum(s.t_clicks) as n_clicks,
    min(s.t_sent) as first_sent,
    max(s.t_sent) as last_sent,
    max(s.t_last_open) as last_open,
    max(s.t_last_click) as last_click,
    (array_agg(s.t_subject order by s.t_sent desc))[1] as subj,
    (array_agg(s.th_id order by s.t_sent desc))[1] as latest_th,
    array_agg(distinct s.th_id) as th_ids,
    array_agg(s.tid) as tids
  from matched s
  cross join lateral unnest(s.rcpts) as r
  where split_part(lower(trim(r)), '@', 2) <> 'advanceapparels.com'
  group by lower(trim(r))
)
select
  p.rcpt,
  split_part(p.rcpt, '@', 2),
  p.n_sent, p.n_views, p.n_clicks,
  p.first_sent, p.last_sent, p.last_open, p.last_click,
  p.subj, p.latest_th,
  tl.url, tl.click_count,
  coalesce(rep.replied, false)
from per_rcpt p
left join lateral (
  select l.url, l.click_count from email_tracking_links l
  where l.tracking_id = any(p.tids) and l.click_count > 0
  order by l.click_count desc
  limit 1
) tl on true
left join lateral (
  select true as replied from email_messages im
  where im.thread_id = any(p.th_ids)
    and im.is_outbound = false
    and position(p.rcpt in lower(coalesce(im.from_address, ''))) > 0
    and im.sent_at > p.first_sent
  limit 1
) rep on true
where (not p_hide_replied or rep.replied is null)
  and (
    case when p_threshold_logic = 'all' then
      (p_min_opens is null or p.n_views >= p_min_opens)
      and (p_min_clicks is null or p.n_clicks >= p_min_clicks)
    else
      (p_min_opens is null and p_min_clicks is null)
      or (p_min_opens is not null and p.n_views >= p_min_opens)
      or (p_min_clicks is not null and p.n_clicks >= p_min_clicks)
    end)
order by p.n_clicks desc, p.n_views desc, p.last_sent desc;
$$;

revoke all on function run_tracking_report(uuid[], jsonb, text, integer, integer, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function run_tracking_report(uuid[], jsonb, text, integer, integer, text, timestamptz, timestamptz, boolean) to service_role;
