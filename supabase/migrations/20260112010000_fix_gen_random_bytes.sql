-- Fix generate_list_invite to use extensions.gen_random_bytes
-- The pgcrypto extension is in the extensions schema on Supabase

CREATE OR REPLACE FUNCTION generate_list_invite(p_list_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token TEXT;
    v_invite_id UUID;
BEGIN
    -- Check ownership
    IF NOT is_list_owner(p_list_id) THEN
        RETURN json_build_object('error', 'Not an owner of this list');
    END IF;

    -- Generate unique token (gen_random_bytes is from pgcrypto in extensions schema)
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
