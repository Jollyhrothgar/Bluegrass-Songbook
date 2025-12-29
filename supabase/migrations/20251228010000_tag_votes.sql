-- Tag votes table for community curation of song tags
-- Users can upvote (+1) or downvote (-1) tags on songs

CREATE TABLE IF NOT EXISTS tag_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  song_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  vote_value INTEGER NOT NULL CHECK (vote_value IN (-1, 1)),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, song_id, tag_name)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tag_votes_song ON tag_votes(song_id);
CREATE INDEX IF NOT EXISTS idx_tag_votes_tag ON tag_votes(tag_name);
CREATE INDEX IF NOT EXISTS idx_tag_votes_user ON tag_votes(user_id);

-- Aggregated view for efficient vote count queries
CREATE OR REPLACE VIEW tag_vote_counts AS
SELECT
  song_id,
  tag_name,
  SUM(vote_value) as net_score,
  COUNT(*) FILTER (WHERE vote_value = 1) as upvotes,
  COUNT(*) FILTER (WHERE vote_value = -1) as downvotes
FROM tag_votes
GROUP BY song_id, tag_name;

-- Enable RLS
ALTER TABLE tag_votes ENABLE ROW LEVEL SECURITY;

-- Anyone can read vote counts (needed for display)
CREATE POLICY "Anyone can view votes"
  ON tag_votes FOR SELECT
  USING (true);

-- Users can insert their own votes
CREATE POLICY "Users can insert own votes"
  ON tag_votes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own votes
CREATE POLICY "Users can update own votes"
  ON tag_votes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own votes
CREATE POLICY "Users can delete own votes"
  ON tag_votes FOR DELETE
  USING (auth.uid() = user_id);

-- Grant access to the view
GRANT SELECT ON tag_vote_counts TO authenticated, anon;
