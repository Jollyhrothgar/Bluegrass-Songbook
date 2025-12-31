-- Analytics events table for tracking user behavior
-- Privacy-respecting: No IP, no user agent, just behavioral patterns

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_visitor ON analytics_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_created ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_name_created ON analytics_events(event_name, created_at DESC);

-- GIN index for JSONB property queries
CREATE INDEX IF NOT EXISTS idx_events_properties ON analytics_events USING GIN (properties);

-- RPC function for batched event inserts (efficient, single round-trip)
CREATE OR REPLACE FUNCTION log_events(
  p_visitor_id TEXT,
  p_events JSONB  -- Array of {event_name, properties, timestamp}
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_record JSONB;
  inserted_count INTEGER := 0;
BEGIN
  FOR event_record IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    INSERT INTO analytics_events (visitor_id, event_name, properties, created_at)
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

-- Enable RLS
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- No direct table access for users (use RPC function only)
-- Admin access via service role key in dashboard notebook

-- Grant execute on the log function to anonymous users
GRANT EXECUTE ON FUNCTION log_events(TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION log_events(TEXT, JSONB) TO authenticated;

-- Aggregated view for daily event counts
CREATE OR REPLACE VIEW daily_event_counts AS
SELECT
  date_trunc('day', created_at) AS date,
  event_name,
  COUNT(*) AS event_count,
  COUNT(DISTINCT visitor_id) AS unique_visitors
FROM analytics_events
GROUP BY date_trunc('day', created_at), event_name;
