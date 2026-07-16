-- Add notes and status columns to pending_songs for placeholder metadata editing
ALTER TABLE pending_songs ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE pending_songs ADD COLUMN IF NOT EXISTS status text;
