-- Multi-owner lists with follow/unfollow and Thunderdome orphan claiming
--
-- Design:
-- - Lists can have multiple owners (owners[] array)
-- - Anyone can follow a list (list_followers table)
-- - When last owner leaves, list becomes "orphaned" for 30 days
-- - During orphan period, any follower can claim ownership (Thunderdome!)
-- - After 30 days, orphaned lists are deleted

-- ============================================
-- SCHEMA CHANGES
-- ============================================

-- Add owners array and orphan tracking to user_lists
ALTER TABLE user_lists
ADD COLUMN IF NOT EXISTS owners UUID[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS orphaned_at TIMESTAMPTZ DEFAULT NULL;

-- Migrate existing lists: copy user_id into owners array
UPDATE user_lists
SET owners = ARRAY[user_id]
WHERE owners = '{}' OR owners IS NULL;

-- Create index for efficient owner lookups
CREATE INDEX IF NOT EXISTS idx_user_lists_owners ON user_lists USING GIN (owners);

-- ============================================
-- LIST FOLLOWERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS list_followers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(list_id, user_id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_list_followers_user ON list_followers(user_id);
CREATE INDEX IF NOT EXISTS idx_list_followers_list ON list_followers(list_id);

-- Enable RLS
ALTER TABLE list_followers ENABLE ROW LEVEL SECURITY;

-- Followers policies
CREATE POLICY "Anyone can view followers"
ON list_followers FOR SELECT
USING (true);

CREATE POLICY "Users can follow lists"
ON list_followers FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unfollow"
ON list_followers FOR DELETE
USING (auth.uid() = user_id);

-- ============================================
-- LIST INVITES TABLE (for adding co-owners)
-- ============================================

CREATE TABLE IF NOT EXISTS list_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for token lookups
CREATE INDEX IF NOT EXISTS idx_list_invites_token ON list_invites(token);

-- Enable RLS
ALTER TABLE list_invites ENABLE ROW LEVEL SECURITY;

-- Invite policies
CREATE POLICY "Owners can view invites for their lists"
ON list_invites FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM user_lists
        WHERE user_lists.id = list_id
        AND auth.uid() = ANY(user_lists.owners)
    )
);

CREATE POLICY "Owners can create invites"
ON list_invites FOR INSERT
WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
        SELECT 1 FROM user_lists
        WHERE user_lists.id = list_id
        AND auth.uid() = ANY(user_lists.owners)
    )
);

CREATE POLICY "Owners can delete invites"
ON list_invites FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM user_lists
        WHERE user_lists.id = list_id
        AND auth.uid() = ANY(user_lists.owners)
    )
);

-- ============================================
-- UPDATE USER_LISTS POLICIES FOR MULTI-OWNER
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view lists by id" ON user_lists;
DROP POLICY IF EXISTS "Users can insert own lists" ON user_lists;
DROP POLICY IF EXISTS "Users can update own lists" ON user_lists;
DROP POLICY IF EXISTS "Users can delete own lists" ON user_lists;

-- Public read access (anyone with the UUID can view)
CREATE POLICY "Anyone can view lists by id"
ON user_lists FOR SELECT
USING (true);

-- Owner-only write access (check owners array)
CREATE POLICY "Users can insert own lists"
ON user_lists FOR INSERT
WITH CHECK (auth.uid() = user_id);  -- Creator becomes first owner

CREATE POLICY "Owners can update lists"
ON user_lists FOR UPDATE
USING (auth.uid() = ANY(owners));

CREATE POLICY "Owners can delete lists"
ON user_lists FOR DELETE
USING (auth.uid() = ANY(owners));

-- ============================================
-- UPDATE USER_LIST_ITEMS POLICIES FOR MULTI-OWNER
-- ============================================

DROP POLICY IF EXISTS "Anyone can view list items" ON user_list_items;
DROP POLICY IF EXISTS "Users can insert own list items" ON user_list_items;
DROP POLICY IF EXISTS "Users can update own list items" ON user_list_items;
DROP POLICY IF EXISTS "Users can delete own list items" ON user_list_items;

-- Public read
CREATE POLICY "Anyone can view list items"
ON user_list_items FOR SELECT
USING (true);

-- Owner-only write (check via parent list ownership)
CREATE POLICY "Owners can insert list items"
ON user_list_items FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM user_lists
        WHERE user_lists.id = list_id
        AND auth.uid() = ANY(user_lists.owners)
    )
);

CREATE POLICY "Owners can update list items"
ON user_list_items FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM user_lists
        WHERE user_lists.id = list_id
        AND auth.uid() = ANY(user_lists.owners)
    )
);

CREATE POLICY "Owners can delete list items"
ON user_list_items FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM user_lists
        WHERE user_lists.id = list_id
        AND auth.uid() = ANY(user_lists.owners)
    )
);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Check if user is owner of a list
CREATE OR REPLACE FUNCTION is_list_owner(p_list_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_lists
        WHERE id = p_list_id
        AND p_user_id = ANY(owners)
    );
$$;

-- Check if user follows a list
CREATE OR REPLACE FUNCTION is_list_follower(p_list_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM list_followers
        WHERE list_id = p_list_id
        AND user_id = p_user_id
    );
$$;

-- Add owner to list (used when claiming invite)
CREATE OR REPLACE FUNCTION add_list_owner(p_list_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE user_lists
    SET
        owners = array_append(owners, p_user_id),
        orphaned_at = NULL  -- Clear orphan status if someone claims
    WHERE id = p_list_id
    AND NOT (p_user_id = ANY(owners));  -- Don't add duplicates

    RETURN FOUND;
END;
$$;

-- Remove owner from list (handles orphaning)
CREATE OR REPLACE FUNCTION remove_list_owner(p_list_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owners UUID[];
    v_new_owners UUID[];
    v_follower_count INT;
BEGIN
    -- Get current owners
    SELECT owners INTO v_owners
    FROM user_lists
    WHERE id = p_list_id;

    IF v_owners IS NULL THEN
        RETURN json_build_object('error', 'List not found');
    END IF;

    IF NOT (p_user_id = ANY(v_owners)) THEN
        RETURN json_build_object('error', 'Not an owner');
    END IF;

    -- Remove this owner
    v_new_owners := array_remove(v_owners, p_user_id);

    IF array_length(v_new_owners, 1) IS NULL OR array_length(v_new_owners, 1) = 0 THEN
        -- Last owner leaving - check for followers
        SELECT COUNT(*) INTO v_follower_count
        FROM list_followers
        WHERE list_id = p_list_id;

        IF v_follower_count > 0 THEN
            -- Start Thunderdome countdown
            UPDATE user_lists
            SET owners = '{}', orphaned_at = NOW()
            WHERE id = p_list_id;

            RETURN json_build_object(
                'status', 'orphaned',
                'follower_count', v_follower_count,
                'message', 'List is now orphaned. Followers have 30 days to claim ownership.'
            );
        ELSE
            -- No followers - delete immediately
            DELETE FROM user_lists WHERE id = p_list_id;

            RETURN json_build_object(
                'status', 'deleted',
                'message', 'List deleted (no followers to inherit)'
            );
        END IF;
    ELSE
        -- Other owners remain
        UPDATE user_lists
        SET owners = v_new_owners
        WHERE id = p_list_id;

        RETURN json_build_object(
            'status', 'removed',
            'remaining_owners', array_length(v_new_owners, 1)
        );
    END IF;
END;
$$;

-- Claim an orphaned list (Thunderdome!)
CREATE OR REPLACE FUNCTION claim_orphaned_list(p_list_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_orphaned_at TIMESTAMPTZ;
    v_is_follower BOOLEAN;
BEGIN
    -- Check list status
    SELECT orphaned_at INTO v_orphaned_at
    FROM user_lists
    WHERE id = p_list_id;

    IF v_orphaned_at IS NULL THEN
        RETURN json_build_object('error', 'List is not orphaned');
    END IF;

    -- Check if claiming user is a follower
    SELECT EXISTS (
        SELECT 1 FROM list_followers
        WHERE list_id = p_list_id AND user_id = auth.uid()
    ) INTO v_is_follower;

    IF NOT v_is_follower THEN
        RETURN json_build_object('error', 'Only followers can claim orphaned lists');
    END IF;

    -- Check if still within 30-day window
    IF v_orphaned_at + INTERVAL '30 days' < NOW() THEN
        RETURN json_build_object('error', 'Claim period has expired');
    END IF;

    -- Claim it!
    UPDATE user_lists
    SET
        owners = ARRAY[auth.uid()],
        orphaned_at = NULL
    WHERE id = p_list_id;

    -- Remove from followers (now an owner)
    DELETE FROM list_followers
    WHERE list_id = p_list_id AND user_id = auth.uid();

    RETURN json_build_object(
        'status', 'claimed',
        'message', 'You are now the owner of this list!'
    );
END;
$$;

-- Claim an invite token
CREATE OR REPLACE FUNCTION claim_list_invite(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
BEGIN
    -- Find the invite
    SELECT * INTO v_invite
    FROM list_invites
    WHERE token = p_token;

    IF v_invite IS NULL THEN
        RETURN json_build_object('error', 'Invalid invite token');
    END IF;

    IF v_invite.used_by IS NOT NULL THEN
        RETURN json_build_object('error', 'Invite already used');
    END IF;

    IF v_invite.expires_at < NOW() THEN
        RETURN json_build_object('error', 'Invite has expired');
    END IF;

    -- Add user as owner
    PERFORM add_list_owner(v_invite.list_id, auth.uid());

    -- Mark invite as used
    UPDATE list_invites
    SET used_by = auth.uid(), used_at = NOW()
    WHERE id = v_invite.id;

    -- Remove from followers if they were following
    DELETE FROM list_followers
    WHERE list_id = v_invite.list_id AND user_id = auth.uid();

    RETURN json_build_object(
        'status', 'success',
        'list_id', v_invite.list_id,
        'message', 'You are now a co-owner of this list!'
    );
END;
$$;

-- Generate invite token (called by frontend)
CREATE OR REPLACE FUNCTION generate_list_invite(p_list_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT;
    v_invite_id UUID;
BEGIN
    -- Check ownership
    IF NOT is_list_owner(p_list_id) THEN
        RETURN json_build_object('error', 'Not an owner of this list');
    END IF;

    -- Generate unique token
    v_token := encode(gen_random_bytes(16), 'hex');

    -- Create invite
    INSERT INTO list_invites (list_id, token, created_by)
    VALUES (p_list_id, v_token, auth.uid())
    RETURNING id INTO v_invite_id;

    RETURN json_build_object(
        'status', 'success',
        'token', v_token,
        'invite_id', v_invite_id,
        'expires_at', NOW() + INTERVAL '7 days'
    );
END;
$$;

-- Update get_public_list to include ownership info
CREATE OR REPLACE FUNCTION get_public_list(p_list_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_list JSON;
    v_items JSON;
    v_is_owner BOOLEAN;
    v_is_follower BOOLEAN;
    v_orphaned_at TIMESTAMPTZ;
BEGIN
    -- Get list metadata
    SELECT
        json_build_object(
            'id', id,
            'name', name,
            'user_id', user_id,
            'position', position,
            'owners', owners,
            'orphaned_at', orphaned_at
        ),
        orphaned_at
    INTO v_list, v_orphaned_at
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

    -- Check user's relationship to this list
    v_is_owner := is_list_owner(p_list_id);
    v_is_follower := is_list_follower(p_list_id);

    RETURN json_build_object(
        'list', v_list,
        'songs', v_items,
        'is_owner', v_is_owner,
        'is_follower', v_is_follower,
        'is_orphaned', v_orphaned_at IS NOT NULL,
        'can_claim', v_orphaned_at IS NOT NULL AND v_is_follower
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION is_list_owner TO authenticated;
GRANT EXECUTE ON FUNCTION is_list_follower TO authenticated;
GRANT EXECUTE ON FUNCTION add_list_owner TO authenticated;
GRANT EXECUTE ON FUNCTION remove_list_owner TO authenticated;
GRANT EXECUTE ON FUNCTION claim_orphaned_list TO authenticated;
GRANT EXECUTE ON FUNCTION claim_list_invite TO authenticated;
GRANT EXECUTE ON FUNCTION generate_list_invite TO authenticated;
GRANT EXECUTE ON FUNCTION get_public_list TO anon, authenticated;
