-- Genre suggestions table for user-contributed tags
-- Users can suggest genre tags for songs; data is exported periodically for analysis

CREATE TABLE IF NOT EXISTS genre_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  song_id TEXT NOT NULL,
  raw_tag TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_genre_suggestions_song ON genre_suggestions(song_id);
CREATE INDEX IF NOT EXISTS idx_genre_suggestions_user ON genre_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_genre_suggestions_tag ON genre_suggestions(raw_tag);

-- Enable RLS
ALTER TABLE genre_suggestions ENABLE ROW LEVEL SECURITY;

-- Only logged-in users can insert their own suggestions
CREATE POLICY "Users can insert own suggestions"
  ON genre_suggestions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can view their own suggestions (for potential future "your suggestions" feature)
CREATE POLICY "Users can view own suggestions"
  ON genre_suggestions FOR SELECT
  USING (auth.uid() = user_id);
