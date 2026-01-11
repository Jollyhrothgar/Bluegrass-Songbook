-- Repair: Create missing visitors table
-- The visitor_stats migration partially failed, leaving functions but missing the visitors table

-- Create the visitors table if it doesn't exist
create table if not exists visitors (
  visitor_id text primary key,
  first_seen timestamp with time zone default now(),
  last_seen timestamp with time zone default now()
);

-- Index for cleanup queries
create index if not exists visitors_last_seen_idx on visitors(last_seen);

-- Enable RLS
alter table visitors enable row level security;

-- Recreate the functions to ensure they have correct search_path
create or replace function log_visit(p_visitor_id text)
returns json
language plpgsql
security definer
set search_path = public
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

create or replace function get_visitor_stats()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'total_visitors', (select count(*) from visitors),
    'total_views', (select coalesce(sum(page_views), 0) from visitor_stats)
  );
$$;

-- Grant execute on functions to anonymous users
grant execute on function log_visit(text) to anon;
grant execute on function get_visitor_stats() to anon;
