-- A1: close the list-ownership holes.
--
-- Before this migration, in production:
--
--   * add_list_owner(list, user) was executable by anon and authenticated (the
--     Supabase default privileges grant EXECUTE on every new public function,
--     on top of the PUBLIC default) and appended ANY user id to ANY list's
--     owners. Its only legitimate caller is claim_list_invite, which runs as
--     the definer and does not need the grant.
--   * remove_list_owner(list, user DEFAULT auth.uid()) let a caller name any
--     user, and only checked that THAT user was an owner -- not that the caller
--     was. Removing the last owner of a follower-less list deletes it.
--   * user_lists, user_list_items and list_followers had FOR SELECT USING
--     (true), so the anon key could dump every list, every follower and every
--     per-item note. "Share by link" never needed that: the link view goes
--     through get_public_list (SECURITY DEFINER), which is untouched here.
--
-- After it:
--
--   * add_list_owner is executable by nobody but its owner (and so by the
--     SECURITY DEFINER claim_list_invite).
--   * remove_list_owner(p_list_id) only ever removes auth.uid(). The two-arg
--     form is dropped (CREATE OR REPLACE cannot change a parameter list); the
--     client already calls rpc('remove_list_owner', { p_list_id }).
--   * A list is readable by its owners and its followers (and, through
--     user_list_items, so are its items). list_followers rows are readable by
--     the follower and by the list's owners. anon reads nothing directly.
--   * The remaining list RPCs are no longer executable by anon / PUBLIC.
--
-- Read policies that were created by hand in the dashboard are not in this
-- repo, so the loop below drops EVERY select policy on the three tables rather
-- than only the ones this repo knows by name.

-- ============================================
-- 1. FUNCTION GRANTS
-- ============================================

-- Nobody calls this directly; claim_list_invite does, as definer.
REVOKE ALL ON FUNCTION public.add_list_owner(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Cleanup job: service role only.
REVOKE ALL ON FUNCTION public.cleanup_expired_orphans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_orphans() TO service_role;

-- Signed-in users only. All of these read auth.uid(), which is NULL for anon.
REVOKE ALL ON FUNCTION public.is_list_owner(uuid, uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_list_follower(uuid, uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_list_invite(text)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_orphaned_list(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_list_invite(uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_list_item_metadata(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_list_owner(uuid, uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_list_follower(uuid, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_list_invite(text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_orphaned_list(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_list_invite(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_list_item_metadata(uuid, text, jsonb) TO authenticated;

-- The share-link view: anyone, signed in or not. Stated explicitly so the
-- grant does not depend on PUBLIC defaults.
REVOKE ALL ON FUNCTION public.get_public_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_list(uuid) TO anon, authenticated;

-- ============================================
-- 2. remove_list_owner: only ever removes the caller
-- ============================================

DROP FUNCTION IF EXISTS public.remove_list_owner(uuid, uuid);

CREATE OR REPLACE FUNCTION public.remove_list_owner(p_list_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_owners uuid[];
    v_new_owners uuid[];
    v_follower_count int;
BEGIN
    IF v_uid IS NULL THEN
        RETURN json_build_object('error', 'Not signed in');
    END IF;

    -- Lock the row so two owners leaving at once cannot both see "another
    -- owner remains".
    SELECT owners INTO v_owners
    FROM public.user_lists
    WHERE id = p_list_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('error', 'List not found');
    END IF;

    IF NOT (v_uid = ANY(COALESCE(v_owners, '{}'::uuid[]))) THEN
        RETURN json_build_object('error', 'Not an owner');
    END IF;

    v_new_owners := array_remove(v_owners, v_uid);

    IF COALESCE(array_length(v_new_owners, 1), 0) = 0 THEN
        -- Last owner leaving - check for followers
        SELECT COUNT(*) INTO v_follower_count
        FROM public.list_followers
        WHERE list_id = p_list_id;

        IF v_follower_count > 0 THEN
            -- Start Thunderdome countdown
            UPDATE public.user_lists
            SET owners = '{}', orphaned_at = NOW()
            WHERE id = p_list_id;

            RETURN json_build_object(
                'status', 'orphaned',
                'follower_count', v_follower_count,
                'message', 'List is now orphaned. Followers have 30 days to claim ownership.'
            );
        ELSE
            -- No followers - delete immediately
            DELETE FROM public.user_lists WHERE id = p_list_id;

            RETURN json_build_object(
                'status', 'deleted',
                'message', 'List deleted (no followers to inherit)'
            );
        END IF;
    ELSE
        -- Other owners remain
        UPDATE public.user_lists
        SET owners = v_new_owners
        WHERE id = p_list_id;

        RETURN json_build_object(
            'status', 'removed',
            'remaining_owners', array_length(v_new_owners, 1)
        );
    END IF;
END;
$$;

-- A new function gets the PUBLIC default AND the Supabase default grants to
-- anon / authenticated / service_role; narrow it to signed-in users.
REVOKE ALL ON FUNCTION public.remove_list_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_list_owner(uuid) TO authenticated;

-- ============================================
-- 3. READ POLICIES
-- ============================================

-- Backfill legacy lists BEFORE the open read policy goes away.
--
-- 20260109224000 added owners (DEFAULT '{}') and backfilled it once, on
-- 2026-01-09. The client only started sending owners: [currentUser.id] on
-- 2026-01-12 (ab7bf46d6), so lists created in between kept owners = '{}'.
-- The new read policy is owner-or-follower, so without this those lists (and
-- their items) would vanish from their own creator, and the client's sync
-- would read that as "deleted in cloud" and drop them locally. The client's
-- fetchCloudLists repair never fixed them: its UPDATE is itself filtered by
-- the owners-only UPDATE policy. A list that was orphaned on purpose always
-- has orphaned_at set, so this cannot revive one. Idempotent.
DO $$
DECLARE
    v_fixed bigint;
BEGIN
    UPDATE public.user_lists
    SET owners = ARRAY[user_id]
    WHERE (owners IS NULL OR owners = '{}'::uuid[])
      AND orphaned_at IS NULL;
    GET DIAGNOSTICS v_fixed = ROW_COUNT;
    RAISE NOTICE 'backfilled owners on % legacy list(s)', v_fixed;
END
$$;

-- Say what is about to be kept: an ALL policy with a real qual survives the
-- loop below, but the postcondition rejects one that is open to PUBLIC.
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN
        SELECT tablename, policyname, roles::text AS roles, qual
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('user_lists', 'user_list_items', 'list_followers')
          AND cmd = 'ALL' AND qual IS DISTINCT FROM 'true'
    LOOP
        RAISE NOTICE 'keeping ALL policy % on % (roles %, using %)',
            pol.policyname, pol.tablename, pol.roles, pol.qual;
    END LOOP;
END
$$;

-- Drop every SELECT policy on the three tables (and any catch-all ALL policy
-- that is USING (true)), whatever it is called and wherever it came from.
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('user_lists', 'user_list_items', 'list_followers')
          AND (cmd = 'SELECT' OR (cmd = 'ALL' AND qual = 'true'))
    LOOP
        RAISE NOTICE 'dropping read policy % on %', pol.policyname, pol.tablename;
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END
$$;

-- A list is readable by its owners and its followers. The follower half goes
-- through the SECURITY DEFINER helper so this policy and the list_followers
-- policy below (which asks about list ownership) do not recurse into each
-- other.
CREATE POLICY "Owners and followers can view lists"
ON public.user_lists FOR SELECT
TO authenticated
USING (
    auth.uid() = ANY(owners)
    OR public.is_list_follower(id)
);

-- Items are readable exactly when their list is (the subquery is itself
-- filtered by the policy above).
CREATE POLICY "Owners and followers can view list items"
ON public.user_list_items FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_lists
        WHERE user_lists.id = user_list_items.list_id
    )
);

-- Followers see their own rows; owners see who follows their list.
CREATE POLICY "Followers and owners can view followers"
ON public.list_followers FOR SELECT
TO authenticated
USING (
    auth.uid() = user_id
    OR public.is_list_owner(list_id)
);

-- A new list may only name its creator as an owner. Without this, anyone could
-- create a list that lists a stranger as owner and have it appear in that
-- stranger's library.
DROP POLICY IF EXISTS "Users can insert own lists" ON public.user_lists;
CREATE POLICY "Users can insert own lists"
ON public.user_lists FOR INSERT
WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(owners, '{}'::uuid[]) <@ ARRAY[auth.uid()]
);

-- ============================================
-- 4. POSTCONDITIONS (see "Self-verifying migrations" in supabase/CLAUDE.md)
-- ============================================

DO $$
DECLARE
    v_bad text;
BEGIN
    -- add_list_owner: nobody (PUBLIC, anon, authenticated) may execute it.
    IF EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace,
               LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE n.nspname = 'public'
           AND p.proname = 'add_list_owner'
           AND a.privilege_type = 'EXECUTE'
           AND (a.grantee = 0
                OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
    ) THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: add_list_owner is still executable by PUBLIC, anon or authenticated.';
    END IF;

    -- remove_list_owner: exactly one overload, (uuid), SECURITY DEFINER,
    -- pinned search_path, not executable by anon / PUBLIC.
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'remove_list_owner') <> 1 THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: remove_list_owner must have exactly one overload.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'remove_list_owner'
           AND p.pronargs = 1
           AND p.proargtypes[0] = 'uuid'::regtype
           AND p.prosecdef
           AND p.proconfig IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: remove_list_owner(uuid) is missing, not SECURITY DEFINER, or has no pinned search_path.';
    END IF;
    IF has_function_privilege('anon', 'public.remove_list_owner(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.remove_list_owner(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: remove_list_owner(uuid) must be executable by authenticated and not by anon.';
    END IF;

    -- get_public_list: still the share-link door.
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'get_public_list'
           AND p.prosecdef AND p.proconfig IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: get_public_list is missing, not SECURITY DEFINER, or has no pinned search_path.';
    END IF;
    IF NOT has_function_privilege('anon', 'public.get_public_list(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: anon can no longer execute get_public_list; share links would break.';
    END IF;

    -- No legacy list may be left with nobody as owner (orphans keep orphaned_at).
    IF EXISTS (
        SELECT 1 FROM public.user_lists
         WHERE (owners IS NULL OR owners = '{}'::uuid[]) AND orphaned_at IS NULL
    ) THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: a non-orphaned list has no owners; its creator could not read it.';
    END IF;

    -- Read policies: every SELECT (or ALL) policy on the three tables is
    -- limited to authenticated and is not a blanket true.
    SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_bad
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('user_lists', 'user_list_items', 'list_followers')
       AND cmd IN ('SELECT', 'ALL')
       AND (qual IS NULL OR qual = 'true' OR NOT (roles = ARRAY['authenticated']::name[]));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: open read policy still present: %', v_bad;
    END IF;

    -- ...and each table has its read policy, with RLS on.
    IF (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND cmd = 'SELECT'
           AND (tablename, policyname) IN (
               ('user_lists', 'Owners and followers can view lists'),
               ('user_list_items', 'Owners and followers can view list items'),
               ('list_followers', 'Followers and owners can view followers'))) <> 3 THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: one of the three list read policies is missing.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_class
         WHERE oid IN ('public.user_lists'::regclass, 'public.user_list_items'::regclass,
                       'public.list_followers'::regclass)
           AND NOT relrowsecurity
    ) THEN
        RAISE EXCEPTION 'POSTCONDITION FAILED: RLS is not enabled on a list table.';
    END IF;
END
$$;
