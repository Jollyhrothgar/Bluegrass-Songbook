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

// Export functions for use in search.js
window.SupabaseAuth = {
    init: initSupabase,
    onAuthChange,
    signInWithGoogle,
    signOut,
    getUser,
    isLoggedIn,
    fetchCloudFavorites,
    addCloudFavorite,
    removeCloudFavorite,
    syncFavoritesToCloud
};
