-- Fix SECURITY DEFINER on song_flag_counts view
-- This view was flagged by Supabase security advisor.
-- While the risk is low (just aggregate counts), we should use SECURITY INVOKER
-- to respect RLS policies of the querying user.

CREATE OR REPLACE VIEW public.song_flag_counts
WITH (security_invoker = true) AS
SELECT
    song_id,
    count(*) FILTER (WHERE status = 'open'::text) AS open_flags,
    count(*) AS total_flags
FROM song_flags
GROUP BY song_id;

-- Ensure proper access grants
GRANT SELECT ON song_flag_counts TO authenticated, anon;
