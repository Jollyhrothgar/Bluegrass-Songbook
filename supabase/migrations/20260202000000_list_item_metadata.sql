-- Add metadata column to user_list_items for setlist management
-- Metadata stores per-item data: key override, tempo, notes
-- Example: {"key": "G", "tempo": 120, "notes": "Kick: Mike solo"}

-- Add metadata column
ALTER TABLE user_list_items
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Create index for efficient querying of metadata
-- GIN index allows searching within the JSONB
CREATE INDEX IF NOT EXISTS idx_user_list_items_metadata ON user_list_items USING GIN (metadata);

-- No RLS policy changes needed - metadata inherits existing policies:
-- - "Anyone can view list items" (SELECT)
-- - "Owners can insert list items" (INSERT)
-- - "Owners can update list items" (UPDATE)
-- - "Owners can delete list items" (DELETE)

-- Add helper function to update item metadata
CREATE OR REPLACE FUNCTION update_list_item_metadata(
    p_list_id UUID,
    p_song_id TEXT,
    p_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if user is an owner of the list
    IF NOT EXISTS (
        SELECT 1 FROM user_lists
        WHERE id = p_list_id
        AND auth.uid() = ANY(owners)
    ) THEN
        RETURN FALSE;
    END IF;

    -- Update the metadata (merge with existing)
    UPDATE user_list_items
    SET metadata = COALESCE(metadata, '{}'::jsonb) || p_metadata
    WHERE list_id = p_list_id AND song_id = p_song_id;

    RETURN FOUND;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_list_item_metadata TO authenticated;
