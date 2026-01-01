-- Fix SECURITY DEFINER warnings on views
-- Views should use SECURITY INVOKER (default) to respect RLS policies of the querying user

-- Recreate song_vote_counts with explicit SECURITY INVOKER
CREATE OR REPLACE VIEW song_vote_counts
WITH (security_invoker = true) AS
SELECT
    song_id,
    group_id,
    COUNT(*) as vote_count,
    SUM(vote_value) as vote_sum
FROM song_votes
GROUP BY song_id, group_id;

-- Recreate tag_vote_counts with explicit SECURITY INVOKER
CREATE OR REPLACE VIEW tag_vote_counts
WITH (security_invoker = true) AS
SELECT
  song_id,
  tag_name,
  SUM(vote_value) as net_score,
  COUNT(*) FILTER (WHERE vote_value = 1) as upvotes,
  COUNT(*) FILTER (WHERE vote_value = -1) as downvotes
FROM tag_votes
GROUP BY song_id, tag_name;

-- Recreate daily_event_counts with explicit SECURITY INVOKER
CREATE OR REPLACE VIEW daily_event_counts
WITH (security_invoker = true) AS
SELECT
  date_trunc('day', created_at) AS date,
  event_name,
  COUNT(*) AS event_count,
  COUNT(DISTINCT visitor_id) AS unique_visitors
FROM analytics_events
GROUP BY date_trunc('day', created_at), event_name;

-- Re-grant access to the views
GRANT SELECT ON song_vote_counts TO authenticated, anon;
GRANT SELECT ON tag_vote_counts TO authenticated, anon;
-- daily_event_counts intentionally not granted to anon (admin only via service role)
