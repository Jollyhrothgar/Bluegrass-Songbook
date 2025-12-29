// Supabase Authentication Module for Bluegrass Songbook

// Configuration
const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

// State
let supabaseClient = null;
let currentUser = null;
let isInitialized = false;

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

    const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin + window.location.pathname
        }
    });

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

// ============================================
// USER LISTS API
// ============================================

// Fetch all user lists with their songs
async function fetchCloudLists() {
    if (!supabaseClient || !currentUser) {
        return { data: [], error: null };
    }

    // Fetch lists
    const { data: lists, error: listsError } = await supabaseClient
        .from('user_lists')
        .select('id, name, position')
        .eq('user_id', currentUser.id)
        .order('position', { ascending: true });

    if (listsError) {
        console.error('Error fetching lists:', listsError);
        return { data: [], error: listsError };
    }

    // Fetch all list items
    const listIds = lists.map(l => l.id);
    if (listIds.length === 0) {
        return { data: [], error: null };
    }

    const { data: items, error: itemsError } = await supabaseClient
        .from('user_list_items')
        .select('list_id, song_id, position')
        .in('list_id', listIds)
        .order('position', { ascending: true });

    if (itemsError) {
        console.error('Error fetching list items:', itemsError);
        return { data: lists.map(l => ({ ...l, songs: [] })), error: itemsError };
    }

    // Group items by list
    const itemsByList = {};
    items.forEach(item => {
        if (!itemsByList[item.list_id]) {
            itemsByList[item.list_id] = [];
        }
        itemsByList[item.list_id].push(item.song_id);
    });

    // Combine lists with their songs
    const result = lists.map(list => ({
        id: list.id,
        name: list.name,
        position: list.position,
        songs: itemsByList[list.id] || []
    }));

    return { data: result, error: null };
}

// Create a new list
async function createCloudList(name) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
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
            name: name,
            position: nextPosition
        })
        .select()
        .single();

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

// Delete a list
async function deleteCloudList(listId) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    const { error } = await supabaseClient
        .from('user_lists')
        .delete()
        .eq('id', listId);

    return { error };
}

// Add song to a list
async function addToCloudList(listId, songId) {
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

    const { error } = await supabaseClient
        .from('user_list_items')
        .upsert({
            list_id: listId,
            song_id: songId,
            position: nextPosition
        }, {
            onConflict: 'list_id,song_id'
        });

    return { error };
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

// Sync local lists to cloud (merge strategy)
async function syncListsToCloud(localLists) {
    if (!supabaseClient || !currentUser) {
        return { error: { message: 'Not logged in' } };
    }

    // Fetch existing cloud lists
    const { data: cloudLists, error: fetchError } = await fetchCloudLists();
    if (fetchError) return { error: fetchError };

    // Create a map of cloud lists by name for matching
    const cloudByName = {};
    cloudLists.forEach(list => {
        cloudByName[list.name] = list;
    });

    // Process local lists
    const mergedLists = [];
    for (const localList of localLists) {
        const cloudMatch = cloudByName[localList.name];

        if (cloudMatch) {
            // Merge songs (union)
            const mergedSongs = [...new Set([...localList.songs, ...cloudMatch.songs])];

            // Add any local-only songs to cloud
            const localOnlySongs = localList.songs.filter(s => !cloudMatch.songs.includes(s));
            for (const songId of localOnlySongs) {
                await addToCloudList(cloudMatch.id, songId);
            }

            mergedLists.push({
                id: cloudMatch.id,
                name: cloudMatch.name,
                position: cloudMatch.position,
                songs: mergedSongs
            });
            delete cloudByName[localList.name];
        } else {
            // Create new list in cloud
            const { data: newList, error } = await createCloudList(localList.name);
            if (error) {
                console.error('Error creating list:', error);
                continue;
            }

            // Add songs to the new list
            for (const songId of localList.songs) {
                await addToCloudList(newList.id, songId);
            }

            mergedLists.push({
                id: newList.id,
                name: localList.name,
                position: newList.position,
                songs: localList.songs
            });
        }
    }

    // Add cloud-only lists to merged result
    Object.values(cloudByName).forEach(cloudList => {
        mergedLists.push(cloudList);
    });

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

// Export functions for use in search.js
window.SupabaseAuth = {
    init: initSupabase,
    onAuthChange,
    signInWithGoogle,
    signOut,
    getUser,
    isLoggedIn,
    // Favorites
    fetchCloudFavorites,
    addCloudFavorite,
    removeCloudFavorite,
    syncFavoritesToCloud,
    // Lists
    fetchCloudLists,
    createCloudList,
    renameCloudList,
    deleteCloudList,
    addToCloudList,
    removeFromCloudList,
    syncListsToCloud,
    // Votes
    fetchGroupVotes,
    fetchUserVotes,
    castVote,
    removeVote,
    // Genre Suggestions
    submitGenreSuggestions
};
