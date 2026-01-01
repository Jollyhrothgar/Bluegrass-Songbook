-- Make lists publicly viewable by UUID (read-only for non-owners)
-- UUIDs are unguessable, so this is effectively "unlisted" sharing

-- Allow anyone to SELECT a specific list by ID
-- (existing policy restricts to owner, we need to add public read)
DROP POLICY IF EXISTS "Users can view own lists" ON user_lists;
DROP POLICY IF EXISTS "Anyone can view lists by id" ON user_lists;
DROP POLICY IF EXISTS "Users can insert own lists" ON user_lists;
DROP POLICY IF EXISTS "Users can update own lists" ON user_lists;
DROP POLICY IF EXISTS "Users can delete own lists" ON user_lists;

-- Public read access (anyone with the UUID can view)
CREATE POLICY "Anyone can view lists by id"
ON user_lists FOR SELECT
USING (true);

-- Owner-only write access
CREATE POLICY "Users can insert own lists"
ON user_lists FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lists"
ON user_lists FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own lists"
ON user_lists FOR DELETE
USING (auth.uid() = user_id);

-- Same for list items - public read, owner-only write
DROP POLICY IF EXISTS "Users can view own list items" ON user_list_items;
DROP POLICY IF EXISTS "Anyone can view list items" ON user_list_items;
DROP POLICY IF EXISTS "Users can insert own list items" ON user_list_items;
DROP POLICY IF EXISTS "Users can update own list items" ON user_list_items;
DROP POLICY IF EXISTS "Users can delete own list items" ON user_list_items;

-- Public read (if you know the list_id, you can see items)
CREATE POLICY "Anyone can view list items"
ON user_list_items FOR SELECT
USING (true);

-- Owner-only write (check via parent list ownership)
CREATE POLICY "Users can insert own list items"
ON user_list_items FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM user_lists
        WHERE user_lists.id = list_id
        AND user_lists.user_id = auth.uid()
    )
);

CREATE POLICY "Users can update own list items"
ON user_list_items FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM user_lists
        WHERE user_lists.id = list_id
        AND user_lists.user_id = auth.uid()
    )
);

CREATE POLICY "Users can delete own list items"
ON user_list_items FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM user_lists
        WHERE user_lists.id = list_id
        AND user_lists.user_id = auth.uid()
    )
);

-- Function to fetch a public list with its items (for non-owners)
CREATE OR REPLACE FUNCTION get_public_list(p_list_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_list JSON;
    v_items JSON;
BEGIN
    -- Get list metadata
    SELECT json_build_object(
        'id', id,
        'name', name,
        'user_id', user_id,
        'position', position
    ) INTO v_list
    FROM user_lists
    WHERE id = p_list_id;

    IF v_list IS NULL THEN
        RETURN json_build_object('error', 'List not found');
    END IF;

    -- Get list items
    SELECT COALESCE(json_agg(song_id ORDER BY position), '[]'::json)
    INTO v_items
    FROM user_list_items
    WHERE list_id = p_list_id;

    RETURN json_build_object(
        'list', v_list,
        'songs', v_items
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_list TO anon, authenticated;
