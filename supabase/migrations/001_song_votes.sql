-- Song Votes Migration
-- Creates tables for tracking song version votes

-- song_votes: Individual user votes on song versions
CREATE TABLE IF NOT EXISTS song_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    song_id TEXT NOT NULL,           -- Song ID from index.json
    group_id TEXT NOT NULL,          -- Group ID for faster lookups
    vote_value INTEGER DEFAULT 1,    -- 1 = upvote (could extend to ratings later)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, song_id)         -- One vote per user per song version
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_song_votes_group ON song_votes(group_id);
CREATE INDEX IF NOT EXISTS idx_song_votes_song ON song_votes(song_id);
CREATE INDEX IF NOT EXISTS idx_song_votes_user ON song_votes(user_id);

-- Enable Row Level Security
ALTER TABLE song_votes ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Anyone can read vote counts (aggregated in queries)
CREATE POLICY "Anyone can view votes"
    ON song_votes FOR SELECT
    USING (true);

-- Users can insert their own votes
CREATE POLICY "Users can insert own votes"
    ON song_votes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own votes
CREATE POLICY "Users can update own votes"
    ON song_votes FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own votes
CREATE POLICY "Users can delete own votes"
    ON song_votes FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger to update updated_at on changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER song_votes_updated_at
    BEFORE UPDATE ON song_votes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- View for aggregated vote counts per song
CREATE OR REPLACE VIEW song_vote_counts AS
SELECT
    song_id,
    group_id,
    COUNT(*) as vote_count,
    SUM(vote_value) as vote_sum
FROM song_votes
GROUP BY song_id, group_id;

-- Grant access to the view
GRANT SELECT ON song_vote_counts TO authenticated;
GRANT SELECT ON song_vote_counts TO anon;
