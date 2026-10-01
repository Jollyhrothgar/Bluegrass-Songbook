-- A2: log_events() has been failing since 2026-01-07.
--
-- 20260107010000_fix_function_search_path.sql ran
--   ALTER FUNCTION public.log_events SET search_path = '';
-- but the body of log_events (20251231000000_analytics_events.sql) names its
-- table unqualified, so with an empty search_path every call died with
--   42P01 relation "analytics_events" does not exist
-- and PostgREST returned 404. log_visit hit the same thing and was repaired by
-- 20260111000000; log_events never was.
--
-- Same signature, same grants, same result; only the table name is qualified.
-- The empty search_path is kept on purpose: it is what stops a caller from
-- planting a look-alike table or function ahead of the real ones.
--
-- The other functions 20260107010000 touched were checked for the same bug:
--   get_public_list      replaced by 20260109224000 with search_path = public
--   log_visit            replaced by 20260111000000 with search_path = public
--   get_visitor_stats    replaced by 20260111000000 with search_path = public
--   update_updated_at    trigger body is NEW / NOW() only, which resolve from
--                        pg_catalog even with an empty search_path: fine
--   submit_flag, get_visitor_flag_count
--                        defined only in production (no CREATE in this repo) and
--                        nothing in docs/ calls them. supabase/tests/
--                        post_deploy_check.sql prints their bodies and
--                        search_path so they can be read against production.

CREATE OR REPLACE FUNCTION public.log_events(
  p_visitor_id TEXT,
  p_events JSONB  -- Array of {event_name, properties, timestamp}
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  event_record JSONB;
  inserted_count INTEGER := 0;
BEGIN
  FOR event_record IN SELECT * FROM pg_catalog.jsonb_array_elements(p_events)
  LOOP
    INSERT INTO public.analytics_events (visitor_id, event_name, properties, created_at)
    VALUES (
      p_visitor_id,
      event_record->>'event_name',
      COALESCE(event_record->'properties', '{}'),
      COALESCE((event_record->>'timestamp')::timestamptz, NOW())
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$;

-- CREATE OR REPLACE keeps the existing grants; restate them so this file is
-- the whole truth about who may call it.
REVOKE ALL ON FUNCTION public.log_events(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_events(TEXT, JSONB) TO anon, authenticated;

-- Postcondition: actually call it. The row is written and removed inside this
-- migration's transaction, so a failure rolls the whole file back and the
-- ledger never says "applied" for a log_events that still 404s.
DO $$
DECLARE
  v_inserted integer;
  v_seen integer;
BEGIN
  v_inserted := public.log_events(
    '__migration_selftest__',
    '[{"event_name": "migration_selftest", "properties": {"ok": true}}]'::jsonb);

  SELECT count(*) INTO v_seen
    FROM public.analytics_events
   WHERE visitor_id = '__migration_selftest__';

  DELETE FROM public.analytics_events WHERE visitor_id = '__migration_selftest__';

  IF v_inserted <> 1 OR v_seen <> 1 THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: log_events() did not insert (returned %, found % rows).',
      v_inserted, v_seen;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'log_events'
       AND p.prosecdef
       AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) cfg
                    WHERE cfg IN ('search_path=', 'search_path=""'))
  ) THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: log_events() is not SECURITY DEFINER with an empty search_path.';
  END IF;
END
$$;
