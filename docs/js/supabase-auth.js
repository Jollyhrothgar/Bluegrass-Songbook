// Supabase Authentication Module for Bluegrass Songbook

// Configuration
const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

// State
let supabaseClient = null;
let currentUser = null;
let isInitialized = false;
let trustedUserCache = null;
let adminUserCache = null;

// Callbacks for state changes
const onAuthChangeCallbacks = [];

// Initialize Supabase client
function initSupabase() {
    if (isInitialized) return;

    if (typeof supabase === 'undefined') {
        console.warn('Supabase SDK not loaded, auth disabled');
        return;
    }

    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    isInitialized = true;

    // Listen for auth state changes
    supabaseClient.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;

        // Clear trusted user cache on auth change
        clearTrustedUserCache();

        // Notify all registered callbacks
        onAuthChangeCallbacks.forEach(callback => {
            try {
                callback(event, currentUser);
            } catch (err) {
                console.error('Auth callback error:', err);
            }
        });
    });

    // Check initial session
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
        currentUser = session?.user || null;
        onAuthChangeCallbacks.forEach(cb => cb('INITIAL', currentUser));
    });
}

// Register callback for auth state changes
function onAuthChange(callback) {
    onAuthChangeCallbacks.push(callback);
    // Call immediately with current state if initialized
    if (isInitialized) {
        callback('REGISTERED', currentUser);
    }
}

// Sign in with Google
async function signInWithGoogle() {
    if (!supabaseClient) {
        console.error('Supabase not initialized');
        return { error: { message: 'Auth not available' } };
    }

    const redirectUrl = window.location.origin + window.location.pathname;

    const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: redirectUrl
        }
    });

    if (error) {
        console.error('[Auth] OAuth error:', error);
    }

    return { data, error };
}

// Sign up with email/password
async function signUpWithEmail(email, password) {
    if (!supabaseClient) {
        return { data: null, error: { message: 'Auth not available' } };
    }

    const redirectUrl = window.location.origin + window.location.pathname;

    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: redirectUrl
        }
    });

    if (error) {
        console.error('[Auth] Sign up error:', error);
    }

    return { data, error };
}

// Sign in with email/password
async function signInWithEmail(email, password) {
    if (!supabaseClient) {
        return { data: null, error: { message: 'Auth not available' } };
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        console.error('[Auth] Sign in error:', error);
    }

    return { data, error };
}

// Send password reset email
async function resetPassword(email) {
    if (!supabaseClient) {
        return { data: null, error: { message: 'Auth not available' } };
    }

    const redirectUrl = window.location.origin + window.location.pathname;

    const { data, error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl
    });

    if (error) {
        console.error('[Auth] Reset password error:', error);
    }

    return { data, error };
}

// Update password (for logged-in user, e.g. after reset link)
async function updatePassword(newPassword) {
    if (!supabaseClient) {
        return { data: null, error: { message: 'Auth not available' } };
    }

    const { data, error } = await supabaseClient.auth.updateUser({
        password: newPassword
    });

    if (error) {
        console.error('[Auth] Update password error:', error);
    }

    return { data, error };
}

// Sign out
async function signOut() {
    if (!supabaseClient) return { error: null };

    const { error } = await supabaseClient.auth.signOut();
    return { error };
}

// Get current user
function getUser() {
    return currentUser;
}

// Check if user is logged in
function isLoggedIn() {
    return currentUser !== null;
}

// Check if current user is a trusted user (can make instant edits)
async function isTrustedUser() {
    if (!supabaseClient || !currentUser) return false;

    // Return cached value if available
    if (trustedUserCache !== null) return trustedUserCache;

    try {
        const { data, error } = await supabaseClient.rpc('is_trusted_user');
        if (error) {
            console.error('Error checking trusted user status:', error);
            return false;
        }
        trustedUserCache = data === true;
        return trustedUserCache;
    } catch (err) {
        console.error('Error checking trusted user status:', err);
        return false;
    }
}

// Check if current user is an admin (can delete songs)
async function isAdmin() {
    if (!supabaseClient || !currentUser) return false;

    // Return cached value if available
    if (adminUserCache !== null) return adminUserCache;

    try {
        const { data, error } = await supabaseClient.rpc('is_admin');
        if (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
        adminUserCache = data === true;
        return adminUserCache;
    } catch (err) {
        console.error('Error checking admin status:', err);
        return false;
    }
}

// Delete a song (admin only, soft delete)
async function deleteSong(songId, reason = null) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    try {
        const { data, error } = await supabaseClient.rpc('delete_song', {
            p_song_id: songId,
            p_reason: reason
        });

        if (error) {
            console.error('Error deleting song:', error);
            return { data: null, error };
        }

        if (data?.error) {
            return { data: null, error: { message: data.error } };
        }

        return { data, error: null };
    } catch (err) {
        console.error('Error deleting song:', err);
        return { data: null, error: err };
    }
}

// Clear trusted user cache (called on auth state change)
function clearTrustedUserCache() {
    trustedUserCache = null;
    adminUserCache = null;
}

// ============================================
// FAVORITES SYNC API
// ============================================

// Fetch all favorites from Supabase
async function fetchCloudFavorites() {
    if (!supabaseClient || !currentUser) {
        return { data: [], error: null };
    }

    const { data, error } = await supabaseClient
        .from('user_favorites')
        .select('song_id')
        .eq('user_id', currentUser.id);

    if (error) {
        console.error('Error fetching favorites:', error);
        return { data: [], error };
    }

    return { data: data.map(row => row.song_id), error: null };
}

// Add a favorite to Supabase
async function addCloudFavorite(songId) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const { error } = await supabaseClient
        .from('user_favorites')
        .upsert({
            user_id: currentUser.id,
            song_id: songId
        }, {
            onConflict: 'user_id,song_id'
        });

    return { error };
}

// Remove a favorite from Supabase
async function removeCloudFavorite(songId) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const { error } = await supabaseClient
        .from('user_favorites')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('song_id', songId);

    return { error };
}

// Sync local favorites to cloud (merge strategy)
async function syncFavoritesToCloud(localFavorites) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    // Fetch existing cloud favorites
    const { data: cloudFavorites, error: fetchError } = await fetchCloudFavorites();
    if (fetchError) return { error: fetchError };

    // Find favorites only in local
    const localOnly = localFavorites.filter(id => !cloudFavorites.includes(id));

    // Batch insert local-only favorites
    if (localOnly.length > 0) {
        const inserts = localOnly.map(songId => ({
            user_id: currentUser.id,
            song_id: songId
        }));

        const { error } = await supabaseClient
            .from('user_favorites')
            .upsert(inserts, { onConflict: 'user_id,song_id' });

        if (error) return { error };
    }

    // Merge: union of local and cloud
    const merged = [...new Set([...localFavorites, ...cloudFavorites])];
    return { data: merged, error: null };
}

// Get or create the "Favorites" list for sharing
// Returns the list UUID that can be shared
async function getOrCreateFavoritesList(favorites) {
    if (!supabaseClient || !currentUser) {
        return { data: null, error: { message: 'Not logged in' } };
    }

    // Check if user already has a Favorites list (special name)
    const { data: existing, error: fetchError } = await supabaseClient
        .from('user_lists')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('name', '❤️ Favorites')
        .single();

    let listId;

    if (existing) {
        listId = existing.id;
    } else if (fetchError && fetchError.code === 'PGRST116') {
        // No rows returned - create the list
        const { data: created, error: createError } = await supabaseClient
            .from('user_lists')
            .insert({
                user_id: currentUser.id,
                name: '❤️ Favorites',
                position: -1  // Special position to keep it first
            })
            .select('id')
            .single();

        if (createError) return { data: null, error: createError };
        listId = created.id;
    } else if (fetchError) {
        return { data: null, error: fetchError };
    }

    // Sync the songs to this list
    // First, clear existing songs
    await supabaseClient
        .from('list_songs')
        .delete()
        .eq('list_id', listId);

    // Then insert current favorites
    if (favorites.length > 0) {
        const inserts = favorites.map((songId, index) => ({
            list_id: listId,
            song_id: songId,
            position: index
        }));

        const { error: insertError } = await supabaseClient
            .from('list_songs')
            .insert(inserts);

        if (insertError) {
            console.error('Error syncing favorites to list:', insertError);
        }
    }

    return { data: listId, error: null };
}

// ============================================
// USER LISTS API
// ============================================

// Fetch all lists the user owns (checks owners array)
async function fetchCloudLists() {
    if (!supabaseClient || !currentUser) {
        return { data: [], error: null };
    }

    // Fetch lists where user is in owners array
    const { data: lists, error: listsError } = await supabaseClient
        .from('user_lists')
        .select('id, name, position, owners, orphaned_at')
        .contains('owners', [currentUser.id])
        .order('position', { ascending: true });

    if (listsError) {
        console.error('Error fetching lists:', listsError);
        return { data: [], error: listsError };
    }

    // Also fetch lists with empty owners that belong to this user (migration fix)
    // These are lists created before the owners array was properly populated
    const { data: orphanedLists, error: orphanError } = await supabaseClient
        .from('user_lists')
        .select('id, name, position, owners, orphaned_at')
        .eq('user_id', currentUser.id)
        .or('owners.eq.{},owners.is.null');

    if (!orphanError && orphanedLists && orphanedLists.length > 0) {
        // Repair lists with empty owners array (migration fix)
        for (const list of orphanedLists) {
            const { error: repairError } = await supabaseClient
                .from('user_lists')
                .update({ owners: [currentUser.id] })
                .eq('id', list.id);
            if (repairError) {
                console.error('[Auth] Failed to repair list:', list.name, repairError);
            } else {
                // Add to our results with fixed owners
                list.owners = [currentUser.id];
            }
        }
        // Merge with existing lists (avoid duplicates)
        const existingIds = new Set(lists.map(l => l.id));
        for (const list of orphanedLists) {
            if (!existingIds.has(list.id)) {
                lists.push(list);
            }
        }
        // Re-sort by position
        lists.sort((a, b) => (a.position || 0) - (b.position || 0));
    }

    // Fetch all list items
    const listIds = lists.map(l => l.id);
    if (listIds.length === 0) {
        return { data: [], error: null };
    }

    const { data: items, error: itemsError } = await supabaseClient
        .from('user_list_items')
        .select('list_id, song_id, position, metadata')
        .in('list_id', listIds)
        .order('position', { ascending: true });

    if (itemsError) {
        console.error('Error fetching list items:', itemsError);
        return { data: lists.map(l => ({ ...l, songs: [], songMetadata: {} })), error: itemsError };
    }

    // Group items by list (songs array and metadata map)
    const itemsByList = {};
    const metadataByList = {};
    items.forEach(item => {
        if (!itemsByList[item.list_id]) {
            itemsByList[item.list_id] = [];
            metadataByList[item.list_id] = {};
        }
        itemsByList[item.list_id].push(item.song_id);
        // Only store metadata if it has content
        if (item.metadata && Object.keys(item.metadata).length > 0) {
            metadataByList[item.list_id][item.song_id] = item.metadata;
        }
    });

    // Combine lists with their songs and metadata
    const result = lists.map(list => ({
        id: list.id,
        name: list.name,
        position: list.position,
        songs: itemsByList[list.id] || [],
        songMetadata: metadataByList[list.id] || {}
    }));

    return { data: result, error: null };
}

// Create a new list (or return existing if duplicate name)
async function createCloudList(name) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    // First check if a list with this name already exists
    const { data: existingList } = await supabaseClient
        .from('user_lists')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('name', name)
        .maybeSingle();  // Use maybeSingle to avoid 406 when not found

    if (existingList) {
        // List already exists, return it
        return { data: existingList, error: null };
    }

    // Get max position
    const { data: existing } = await supabaseClient
        .from('user_lists')
        .select('position')
        .eq('user_id', currentUser.id)
        .order('position', { ascending: false })
        .limit(1);

    const nextPosition = existing && existing.length > 0 ? existing[0].position + 1 : 0;

    const { data, error } = await supabaseClient
        .from('user_lists')
        .insert({
            user_id: currentUser.id,
            owners: [currentUser.id],  // Must set owners for RLS policies
            name: name,
            position: nextPosition
        })
        .select()
        .single();

    // Handle race condition - if insert fails due to duplicate, fetch the existing one
    if (error && error.code === '23505') {
        const { data: raceList } = await supabaseClient
            .from('user_lists')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('name', name)
            .single();
        if (raceList) {
            return { data: raceList, error: null };
        }
    }

    return { data, error };
}

// Rename a list
async function renameCloudList(listId, newName) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const { error } = await supabaseClient
        .from('user_lists')
        .update({ name: newName })
        .eq('id', listId);

    return { error };
}

// Delete a list (tries by ID first, then by name as fallback)
async function deleteCloudList(listId, listName = null) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    // Try to delete by ID first
    let { error, data } = await supabaseClient
        .from('user_lists')
        .delete()
        .eq('id', listId)
        .select();

    if (!error && data && data.length > 0) {
        return { error: null };
    }

    // If nothing was deleted and we have a name, try deleting by name
    // This handles the case where the local cloudId is stale/incorrect
    if (!error && (!data || data.length === 0) && listName) {
        const result = await supabaseClient
            .from('user_lists')
            .delete()
            .eq('name', listName)
            .eq('user_id', currentUser.id)
            .select();

        error = result.error;
    }

    return { error };
}

// Add song to a list (with optional metadata)
async function addToCloudList(listId, songId, metadata = null) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    // Get max position in list
    const { data: existing } = await supabaseClient
        .from('user_list_items')
        .select('position')
        .eq('list_id', listId)
        .order('position', { ascending: false })
        .limit(1);

    const nextPosition = existing && existing.length > 0 ? existing[0].position + 1 : 0;

    const insertData = {
        list_id: listId,
        song_id: songId,
        position: nextPosition
    };

    // Include metadata if provided
    if (metadata && Object.keys(metadata).length > 0) {
        insertData.metadata = metadata;
    }

    const { error } = await supabaseClient
        .from('user_list_items')
        .upsert(insertData, {
            onConflict: 'list_id,song_id'
        });

    return { error };
}

// Update metadata for a list item
async function updateListItemMetadata(listId, songId, metadata) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    // Use the RPC function for proper ownership check
    const { data, error } = await supabaseClient.rpc('update_list_item_metadata', {
        p_list_id: listId,
        p_song_id: songId,
        p_metadata: metadata
    });

    if (error) {
        console.error('Error updating list item metadata:', error);
        return { error };
    }

    return { data, error: null };
}

// Remove song from a list
async function removeFromCloudList(listId, songId) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const { error } = await supabaseClient
        .from('user_list_items')
        .delete()
        .eq('list_id', listId)
        .eq('song_id', songId);

    return { error };
}

// Fetch a public list by ID (works for any user, not just owner)
async function fetchPublicList(listId) {
    if (!supabaseClient) {
        return { data: null, error: { message: 'Supabase not initialized' } };
    }

    try {
        const { data, error } = await supabaseClient.rpc('get_public_list', {
            p_list_id: listId
        });

        if (error) {
            console.error('Error fetching public list:', error);
            return { data: null, error };
        }

        if (data?.error) {
            return { data: null, error: { message: data.error } };
        }

        return { data, error: null };
    } catch (err) {
        console.error('Error fetching public list:', err);
        return { data: null, error: err };
    }
}

// Copy a public list to user's own lists
async function copyListToOwn(listId, newName) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    // Fetch the source list
    const { data: sourceList, error: fetchError } = await fetchPublicList(listId);
    if (fetchError || !sourceList) {
        return { error: fetchError || { message: 'Could not fetch list' } };
    }

    // Create the new list
    const { data: newList, error: createError } = await createCloudList(newName || sourceList.list.name);
    if (createError) {
        return { error: createError };
    }

    // Add all songs to the new list
    for (const songId of sourceList.songs) {
        await addToCloudList(newList.id, songId);
    }

    return {
        data: {
            id: newList.id,
            name: newName || sourceList.list.name,
            songs: sourceList.songs
        },
        error: null
    };
}

// ============================================
// LIST FOLLOWING API
// ============================================

// Fetch all lists the user follows (but doesn't own)
async function fetchFollowedLists() {
    if (!supabaseClient || !currentUser) {
        return { data: [], error: null };
    }

    // Fetch followed list IDs
    const { data: follows, error: followsError } = await supabaseClient
        .from('list_followers')
        .select('list_id')
        .eq('user_id', currentUser.id);

    if (followsError) {
        console.error('Error fetching followed lists:', followsError);
        return { data: [], error: followsError };
    }

    if (!follows || follows.length === 0) {
        return { data: [], error: null };
    }

    const listIds = follows.map(f => f.list_id);

    // Fetch the actual list data
    const { data: lists, error: listsError } = await supabaseClient
        .from('user_lists')
        .select('id, name, position, owners, orphaned_at')
        .in('id', listIds);

    if (listsError) {
        console.error('Error fetching followed list details:', listsError);
        return { data: [], error: listsError };
    }

    // Fetch all list items (including metadata)
    const { data: items, error: itemsError } = await supabaseClient
        .from('user_list_items')
        .select('list_id, song_id, position, metadata')
        .in('list_id', listIds)
        .order('position', { ascending: true });

    if (itemsError) {
        console.error('Error fetching followed list items:', itemsError);
        return { data: lists.map(l => ({ ...l, songs: [], songMetadata: {}, isFollowed: true })), error: itemsError };
    }

    // Group items by list (songs array and metadata map)
    const itemsByList = {};
    const metadataByList = {};
    items.forEach(item => {
        if (!itemsByList[item.list_id]) {
            itemsByList[item.list_id] = [];
            metadataByList[item.list_id] = {};
        }
        itemsByList[item.list_id].push(item.song_id);
        // Only store metadata if it has content
        if (item.metadata && Object.keys(item.metadata).length > 0) {
            metadataByList[item.list_id][item.song_id] = item.metadata;
        }
    });

    // Combine lists with their songs, metadata, and mark as followed
    const result = lists.map(list => ({
        id: list.id,
        name: list.name,
        position: list.position,
        owners: list.owners || [],
        orphaned_at: list.orphaned_at,
        songs: itemsByList[list.id] || [],
        songMetadata: metadataByList[list.id] || {},
        isFollowed: true,
        isOrphaned: !!list.orphaned_at
    }));

    return { data: result, error: null };
}

// Follow a list
async function followList(listId) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const { error } = await supabaseClient
        .from('list_followers')
        .insert({
            list_id: listId,
            user_id: currentUser.id
        });

    // Ignore duplicate key error (already following)
    if (error && error.code === '23505') {
        return { error: null };
    }

    return { error };
}

// Unfollow a list
async function unfollowList(listId) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const { error } = await supabaseClient
        .from('list_followers')
        .delete()
        .eq('list_id', listId)
        .eq('user_id', currentUser.id);

    return { error };
}

// ============================================
// LIST OWNERSHIP API
// ============================================

// Generate an invite link for co-ownership
async function generateListInvite(listId) {
    if (!supabaseClient || !currentUser) {
        return { data: null, error: { message: 'Not logged in' } };
    }

    try {
        const { data, error } = await supabaseClient.rpc('generate_list_invite', {
            p_list_id: listId
        });

        if (error) {
            console.error('Error generating invite:', error);
            return { data: null, error };
        }

        if (data?.error) {
            return { data: null, error: { message: data.error } };
        }

        return { data, error: null };
    } catch (err) {
        console.error('Error generating invite:', err);
        return { data: null, error: err };
    }
}

// Claim an invite token to become co-owner
async function claimListInvite(token) {
    if (!supabaseClient || !currentUser) {
        return { data: null, error: { message: 'Not logged in' } };
    }

    try {
        const { data, error } = await supabaseClient.rpc('claim_list_invite', {
            p_token: token
        });

        if (error) {
            console.error('Error claiming invite:', error);
            return { data: null, error };
        }

        if (data?.error) {
            return { data: null, error: { message: data.error } };
        }

        return { data, error: null };
    } catch (err) {
        console.error('Error claiming invite:', err);
        return { data: null, error: err };
    }
}

// Leave a list (remove self as owner)
async function leaveList(listId) {
    if (!supabaseClient || !currentUser) {
        return { data: null, error: { message: 'Not logged in' } };
    }

    try {
        const { data, error } = await supabaseClient.rpc('remove_list_owner', {
            p_list_id: listId
        });

        if (error) {
            console.error('Error leaving list:', error);
            return { data: null, error };
        }

        if (data?.error) {
            return { data: null, error: { message: data.error } };
        }

        return { data, error: null };
    } catch (err) {
        console.error('Error leaving list:', err);
        return { data: null, error: err };
    }
}

// Claim an orphaned list (Thunderdome!)
async function claimOrphanedList(listId) {
    if (!supabaseClient || !currentUser) {
        return { data: null, error: { message: 'Not logged in' } };
    }

    try {
        const { data, error } = await supabaseClient.rpc('claim_orphaned_list', {
            p_list_id: listId
        });

        if (error) {
            console.error('Error claiming orphaned list:', error);
            return { data: null, error };
        }

        if (data?.error) {
            return { data: null, error: { message: data.error } };
        }

        return { data, error: null };
    } catch (err) {
        console.error('Error claiming orphaned list:', err);
        return { data: null, error: err };
    }
}

// Sync local lists to cloud (merge strategy)
async function syncListsToCloud(localLists) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    // Fetch existing cloud lists
    const { data: cloudLists, error: fetchError } = await fetchCloudLists();
    if (fetchError) return { error: fetchError };

    // Old favorites list names to clean up
    const oldFavoritesNames = ['❤️ Favorites', '❤️ favorites', '♥ Favorites'];

    // Create a map of cloud lists by name for matching
    const cloudByName = {};
    const listsToDelete = [];
    cloudLists.forEach(list => {
        // Mark old-style favorites for deletion
        if (oldFavoritesNames.includes(list.name)) {
            listsToDelete.push(list);
        }
        cloudByName[list.name] = list;
    });

    // Delete old-style favorites lists and merge their songs into "Favorites"
    for (const oldList of listsToDelete) {
        const favoritesMatch = cloudByName['Favorites'];
        if (favoritesMatch && oldList.songs && oldList.songs.length > 0) {
            // Merge songs into the proper Favorites list
            for (const songId of oldList.songs) {
                if (!favoritesMatch.songs.includes(songId)) {
                    await addToCloudList(favoritesMatch.id, songId);
                    favoritesMatch.songs.push(songId);
                }
            }
        }
        // Delete the old list
        await deleteCloudList(oldList.id);
        delete cloudByName[oldList.name];
    }

    // Process local lists
    const mergedLists = [];
    for (const localList of localLists) {
        // Skip old-style favorites names from local (shouldn't exist but just in case)
        if (oldFavoritesNames.includes(localList.name)) {
            continue;
        }

        const cloudMatch = cloudByName[localList.name];

        if (cloudMatch) {
            // Merge songs (union)
            const mergedSongs = [...new Set([...localList.songs, ...cloudMatch.songs])];

            // Merge metadata (local takes precedence for conflicts, cloud fills gaps)
            const mergedMetadata = {
                ...(cloudMatch.songMetadata || {}),
                ...(localList.songMetadata || {})
            };

            // Add any local-only songs to cloud
            const localOnlySongs = localList.songs.filter(s => !cloudMatch.songs.includes(s));
            for (const songId of localOnlySongs) {
                const metadata = localList.songMetadata?.[songId] || null;
                await addToCloudList(cloudMatch.id, songId, metadata);
            }

            mergedLists.push({
                id: cloudMatch.id,
                name: cloudMatch.name,
                position: cloudMatch.position,
                songs: mergedSongs,
                songMetadata: mergedMetadata
            });
            delete cloudByName[localList.name];
        } else if (localList.cloudId) {
            // List has a cloudId but doesn't exist in cloud anymore - it was deleted
            continue;
        } else {
            // New local list without cloudId - create in cloud
            const { data: newList, error } = await createCloudList(localList.name);
            if (error) {
                console.error('Error creating list:', error);
                continue;
            }

            // Add songs to the new list with their metadata
            for (const songId of localList.songs) {
                const metadata = localList.songMetadata?.[songId] || null;
                await addToCloudList(newList.id, songId, metadata);
            }

            mergedLists.push({
                id: newList.id,
                name: localList.name,
                position: newList.position,
                songs: localList.songs,
                songMetadata: localList.songMetadata || {}
            });
        }
    }

    // Add cloud-only lists to merged result (excluding old favorites which were deleted)
    Object.values(cloudByName)
        .filter(l => !oldFavoritesNames.includes(l.name))
        .forEach(cloudList => mergedLists.push(cloudList));

    // Sort by position
    mergedLists.sort((a, b) => a.position - b.position);

    return { data: mergedLists, error: null };
}

// ============================================
// SONG VOTES API
// ============================================

// Fetch vote counts for all songs in a group
async function fetchGroupVotes(groupId) {
    if (!supabaseClient) {
        return { data: [], error: null };
    }

    const { data, error } = await supabaseClient
        .from('song_vote_counts')
        .select('song_id, vote_count')
        .eq('group_id', groupId);

    if (error) {
        console.error('Error fetching group votes:', error);
        return { data: [], error };
    }

    // Convert to a map for easy lookup
    const voteMap = {};
    data.forEach(row => {
        voteMap[row.song_id] = row.vote_count;
    });

    return { data: voteMap, error: null };
}

// Fetch user's votes for a list of songs
async function fetchUserVotes(songIds) {
    if (!supabaseClient || !currentUser || songIds.length === 0) {
        return { data: {}, error: null };
    }

    const { data, error } = await supabaseClient
        .from('song_votes')
        .select('song_id, vote_value')
        .eq('user_id', currentUser.id)
        .in('song_id', songIds);

    if (error) {
        console.error('Error fetching user votes:', error);
        return { data: {}, error };
    }

    // Convert to a map
    const voteMap = {};
    data.forEach(row => {
        voteMap[row.song_id] = row.vote_value;
    });

    return { data: voteMap, error: null };
}

// Cast or update a vote on a song
async function castVote(songId, groupId, value = 1) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const { error } = await supabaseClient
        .from('song_votes')
        .upsert({
            user_id: currentUser.id,
            song_id: songId,
            group_id: groupId,
            vote_value: value
        }, {
            onConflict: 'user_id,song_id'
        });

    return { error };
}

// Remove a vote from a song
async function removeVote(songId) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const { error } = await supabaseClient
        .from('song_votes')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('song_id', songId);

    return { error };
}

// =============================================================================
// Genre Suggestions
// =============================================================================

// Submit genre suggestions for a song
// tags: array of strings (already validated by caller, but we sanitize again for safety)
async function submitGenreSuggestions(songId, tags) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    // Defense-in-depth: sanitize again before sending to database
    const sanitize = (str) => str
        .toLowerCase()
        .replace(/[^a-z0-9\s\-]/g, '')  // Only allow safe chars
        .replace(/\s+/g, ' ')            // Collapse spaces
        .trim()
        .slice(0, 30);                   // Max length

    const sanitizedTags = tags
        .map(sanitize)
        .filter(t => t.length > 0);

    if (sanitizedTags.length === 0) {
        return { error: { message: 'No valid tags' } };
    }

    const rows = sanitizedTags.map(tag => ({
        user_id: currentUser.id,
        song_id: String(songId).slice(0, 100),  // Limit song_id length too
        raw_tag: tag
    }));

    const { data, error } = await supabaseClient
        .from('genre_suggestions')
        .insert(rows);

    if (error) {
        console.error('Error submitting genre suggestions:', error);
    }

    return { data, error };
}

// =============================================================================
// Tag Voting
// =============================================================================

// Fetch vote counts for all tags on a song
async function fetchTagVotes(songId) {
    if (!supabaseClient) {
        return { data: {}, error: null };
    }

    const { data, error } = await supabaseClient
        .from('tag_vote_counts')
        .select('tag_name, net_score, upvotes, downvotes')
        .eq('song_id', songId);

    if (error) {
        console.error('Error fetching tag votes:', error);
        return { data: {}, error };
    }

    // Convert to object: { tagName: { net, up, down } }
    const votes = {};
    for (const row of (data || [])) {
        votes[row.tag_name] = {
            net: row.net_score,
            up: row.upvotes,
            down: row.downvotes
        };
    }

    return { data: votes, error: null };
}

// Fetch current user's votes for a song's tags
async function fetchUserTagVotes(songId) {
    if (!supabaseClient || !currentUser) {
        return { data: {}, error: null };
    }

    const { data, error } = await supabaseClient
        .from('tag_votes')
        .select('tag_name, vote_value')
        .eq('song_id', songId)
        .eq('user_id', currentUser.id);

    if (error) {
        console.error('Error fetching user tag votes:', error);
        return { data: {}, error };
    }

    // Convert to object: { tagName: voteValue }
    const votes = {};
    for (const row of (data || [])) {
        votes[row.tag_name] = row.vote_value;
    }

    return { data: votes, error: null };
}

// Cast or update a vote on a tag
async function castTagVote(songId, tagName, value) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    if (value !== 1 && value !== -1) {
        return { error: { message: 'Invalid vote value' } };
    }

    // Sanitize tag name
    const cleanTag = tagName.toLowerCase().replace(/[^a-z0-9\s\-]/g, '').trim();
    if (!cleanTag) {
        return { error: { message: 'Invalid tag name' } };
    }

    const { error } = await supabaseClient
        .from('tag_votes')
        .upsert({
            user_id: currentUser.id,
            song_id: String(songId).slice(0, 100),
            tag_name: cleanTag,
            vote_value: value
        }, {
            onConflict: 'user_id,song_id,tag_name'
        });

    if (error) {
        console.error('Error casting tag vote:', error);
    }

    return { error };
}

// Remove a vote from a tag
async function removeTagVote(songId, tagName) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const cleanTag = tagName.toLowerCase().replace(/[^a-z0-9\s\-]/g, '').trim();

    const { error } = await supabaseClient
        .from('tag_votes')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('song_id', songId)
        .eq('tag_name', cleanTag);

    if (error) {
        console.error('Error removing tag vote:', error);
    }

    return { error };
}

// =============================================================================
// Visitor Statistics
// =============================================================================

// Get or create a visitor ID (stored in localStorage, not PII)
function getVisitorId() {
    let visitorId = localStorage.getItem('songbook-visitor-id');
    if (!visitorId) {
        // Generate a random ID (not linked to any personal info)
        visitorId = 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('songbook-visitor-id', visitorId);
    }
    return visitorId;
}

// Log a page visit and return current stats
async function logVisit() {
    if (!supabaseClient) {
        return { data: null, error: { message: 'Supabase not initialized' } };
    }

    const visitorId = getVisitorId();

    try {
        const { data, error } = await supabaseClient.rpc('log_visit', {
            p_visitor_id: visitorId
        });

        if (error) {
            console.error('Error logging visit:', error);
            return { data: null, error };
        }

        return { data, error: null };
    } catch (err) {
        console.error('Error logging visit:', err);
        return { data: null, error: err };
    }
}

// Get current visitor stats without logging
async function getVisitorStats() {
    if (!supabaseClient) {
        return { data: null, error: { message: 'Supabase not initialized' } };
    }

    try {
        const { data, error } = await supabaseClient.rpc('get_visitor_stats');

        if (error) {
            console.error('Error getting visitor stats:', error);
            return { data: null, error };
        }

        return { data, error: null };
    } catch (err) {
        console.error('Error getting visitor stats:', err);
        return { data: null, error: err };
    }
}

// Note: This file is loaded as a regular script, not a module.
// Functions are exposed via window.SupabaseAuth for use by other modules.

window.SupabaseAuth = {
    init: initSupabase,
    onAuthChange,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    resetPassword,
    updatePassword,
    signOut,
    getUser,
    isLoggedIn,
    isTrustedUser,
    isAdmin,
    deleteSong,
    // Expose supabase client for direct access (e.g., pending_songs)
    get supabase() { return supabaseClient; },
    // Favorites
    fetchCloudFavorites,
    addCloudFavorite,
    removeCloudFavorite,
    syncFavoritesToCloud,
    getOrCreateFavoritesList,
    // Lists (owned)
    fetchCloudLists,
    fetchPublicList,
    copyListToOwn,
    createCloudList,
    renameCloudList,
    deleteCloudList,
    addToCloudList,
    removeFromCloudList,
    updateListItemMetadata,
    syncListsToCloud,
    // Lists (following)
    fetchFollowedLists,
    followList,
    unfollowList,
    // Lists (ownership)
    generateListInvite,
    claimListInvite,
    leaveList,
    claimOrphanedList,
    // Votes (song versions)
    fetchGroupVotes,
    fetchUserVotes,
    castVote,
    removeVote,
    // Genre Suggestions
    submitGenreSuggestions,
    // Tag Voting
    fetchTagVotes,
    fetchUserTagVotes,
    castTagVote,
    removeTagVote,
    // Visitor Stats
    logVisit,
    getVisitorStats,
    // Internal (for analytics module)
    _getClient: () => supabaseClient
};
