-- Visitor statistics tracking
-- Tracks unique visitors and page views

-- Store daily aggregated stats
create table if not exists visitor_stats (
  date date primary key default current_date,
  unique_visitors int not null default 0,
  page_views int not null default 0
);

-- Store visitor IDs to dedupe (hashed localStorage IDs, not PII)
create table if not exists visitors (
  visitor_id text primary key,
  first_seen timestamp with time zone default now(),
  last_seen timestamp with time zone default now()
);

-- Index for cleanup queries
create index if not exists visitors_last_seen_idx on visitors(last_seen);

-- Function to log a visit and return current totals
create or replace function log_visit(p_visitor_id text)
returns json
language plpgsql
security definer
as $$
declare
  is_new_visitor boolean := false;
  is_new_today boolean := false;
  v_total_visitors int;
  v_total_views int;
begin
  -- Check if this is a new visitor ever
  if not exists (select 1 from visitors where visitor_id = p_visitor_id) then
    insert into visitors (visitor_id) values (p_visitor_id);
    is_new_visitor := true;
  else
    -- Update last seen
    update visitors set last_seen = now() where visitor_id = p_visitor_id;
  end if;

  -- Ensure today's row exists
  insert into visitor_stats (date) values (current_date)
  on conflict (date) do nothing;

  -- Always increment page views
  update visitor_stats
  set page_views = page_views + 1
  where date = current_date;

  -- Increment unique visitors only if new today
  -- (Simple approach: if new visitor ever, count as new today)
  if is_new_visitor then
    update visitor_stats
    set unique_visitors = unique_visitors + 1
    where date = current_date;
  end if;

  -- Get totals
  select
    (select count(*) from visitors),
    (select coalesce(sum(page_views), 0) from visitor_stats)
  into v_total_visitors, v_total_views;

  return json_build_object(
    'total_visitors', v_total_visitors,
    'total_views', v_total_views
  );
end;
$$;

-- Function to get stats without logging (for display refresh)
create or replace function get_visitor_stats()
returns json
language sql
security definer
as $$
  select json_build_object(
    'total_visitors', (select count(*) from visitors),
    'total_views', (select coalesce(sum(page_views), 0) from visitor_stats)
  );
$$;

-- RLS policies
alter table visitor_stats enable row level security;
alter table visitors enable row level security;

-- Allow the functions to work (they use security definer)
-- No direct table access needed for users

-- Grant execute on functions to anonymous users
grant execute on function log_visit(text) to anon;
grant execute on function get_visitor_stats() to anon;
