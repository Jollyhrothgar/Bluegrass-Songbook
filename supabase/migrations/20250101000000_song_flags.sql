-- Song flags table for user-reported issues
-- Allows anonymous flagging via visitor_id, with optional user_id for authenticated users

CREATE TABLE song_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id TEXT NOT NULL,
  flag_type TEXT NOT NULL CHECK (flag_type IN (
    'wrong-chord', 'wrong-placement', 'lyric-error', 'missing-section', 'other'
  )),
  description TEXT,
  visitor_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'wontfix')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id)
);

-- Indexes for common queries
CREATE INDEX idx_flags_song ON song_flags(song_id);
CREATE INDEX idx_flags_status ON song_flags(status, created_at DESC);
CREATE INDEX idx_flags_visitor ON song_flags(visitor_id);

-- Aggregation view: flag counts per song
CREATE VIEW song_flag_counts AS
SELECT song_id,
       COUNT(*) FILTER (WHERE status = 'open') as open_flags,
       COUNT(*) as total_flags
FROM song_flags
GROUP BY song_id;

-- RPC for anonymous flag submission
CREATE OR REPLACE FUNCTION submit_flag(
  p_song_id TEXT,
  p_flag_type TEXT,
  p_description TEXT,
  p_visitor_id TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_flag_id UUID;
BEGIN
  INSERT INTO song_flags (song_id, flag_type, description, visitor_id, user_id)
  VALUES (p_song_id, p_flag_type, p_description, p_visitor_id, auth.uid())
  RETURNING id INTO v_flag_id;

  RETURN v_flag_id;
END;
$$;

-- RPC for getting visitor's flag count (for gamification)
CREATE OR REPLACE FUNCTION get_visitor_flag_count(p_visitor_id TEXT)
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COUNT(*)::INTEGER FROM song_flags WHERE visitor_id = p_visitor_id;
$$;

-- RLS
ALTER TABLE song_flags ENABLE ROW LEVEL SECURITY;

-- Anyone can read open flags (for showing "this song has issues" badge)
CREATE POLICY "Public read open flags" ON song_flags
  FOR SELECT USING (status = 'open');

-- Insert via RPC only (SECURITY DEFINER handles auth)
GRANT EXECUTE ON FUNCTION submit_flag TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_visitor_flag_count TO anon, authenticated;
