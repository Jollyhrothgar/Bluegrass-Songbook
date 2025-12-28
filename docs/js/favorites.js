// Favorites management for Bluegrass Songbook

import {
    favorites, setFavorites, addFavorite, removeFavorite, hasFavorite,
    allSongs, userLists,
    isCloudSyncEnabled, setCloudSyncEnabled,
    syncInProgress, setSyncInProgress,
    showingFavorites, setShowingFavorites
} from './state.js';

// Module-level DOM references (set by init)
let navFavoritesEl = null;
let navSearchEl = null;
let navFavoritesCountEl = null;
let searchStatsEl = null;
let searchInputEl = null;
let resultsDivEl = null;

// Callbacks (set by init)
let renderResultsFn = null;
let showRandomSongsFn = null;

/**
 * Save favorites to localStorage
 */
export function saveFavorites() {
    localStorage.setItem('songbook-favorites', JSON.stringify([...favorites]));
    updateFavoritesCount();
}

/**
 * Load favorites from localStorage
 */
export function loadFavorites() {
    try {
        const saved = localStorage.getItem('songbook-favorites');
        if (saved) {
            setFavorites(new Set(JSON.parse(saved)));
        }
    } catch (e) {
        console.error('Failed to load favorites:', e);
    }
}

/**
 * Update favorites count in sidebar
 */
export function updateFavoritesCount() {
    if (navFavoritesCountEl) {
        if (favorites.size > 0) {
            navFavoritesCountEl.textContent = favorites.size;
            navFavoritesCountEl.classList.remove('hidden');
        } else {
            navFavoritesCountEl.classList.add('hidden');
        }
    }
}

/**
 * Check if a song is a favorite
 */
export function isFavorite(songId) {
    return hasFavorite(songId);
}

/**
 * Toggle favorite status for a song
 */
export function toggleFavorite(songId) {
    const isAdding = !hasFavorite(songId);

    if (isAdding) {
        addFavorite(songId);
    } else {
        removeFavorite(songId);
    }

    // Save locally immediately
    saveFavorites();
    updateFavoriteButton();

    // Sync to cloud in background (optimistic UI)
    syncFavoriteToCloud(songId, isAdding);

    // Update result list if visible
    if (resultsDivEl && !resultsDivEl.classList.contains('hidden')) {
        const item = resultsDivEl.querySelector(`[data-id="${songId}"]`);
        if (item) {
            item.classList.toggle('is-favorite', hasFavorite(songId));
        }
    }
}

/**
 * Sync a single favorite change to cloud (non-blocking)
 */
async function syncFavoriteToCloud(songId, isAdding) {
    if (!isCloudSyncEnabled || typeof SupabaseAuth === 'undefined') return;

    try {
        if (isAdding) {
            await SupabaseAuth.addCloudFavorite(songId);
        } else {
            await SupabaseAuth.removeCloudFavorite(songId);
        }
    } catch (err) {
        console.error('Cloud sync error:', err);
        // Favorites are safe in localStorage, cloud will catch up on next full sync
    }
}

/**
 * Full sync: merge localStorage with cloud
 */
export async function performFullSync() {
    if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
        setCloudSyncEnabled(false);
        return;
    }

    setSyncInProgress(true);
    updateSyncUI('syncing');

    try {
        const localFavs = [...favorites];
        const { data: merged, error } = await SupabaseAuth.syncFavoritesToCloud(localFavs);

        if (error) {
            throw error;
        }

        // Update local favorites with merged set
        setFavorites(new Set(merged));
        saveFavorites();

        setCloudSyncEnabled(true);
        updateSyncUI('synced');

    } catch (err) {
        console.error('Full sync failed:', err);
        updateSyncUI('error');
        // Keep using local favorites
    } finally {
        setSyncInProgress(false);
    }
}

/**
 * Update sync indicator in UI
 */
export function updateSyncUI(status) {
    const indicator = document.getElementById('sync-indicator');
    const text = document.getElementById('sync-text');

    if (!indicator || !text) return;

    switch (status) {
        case 'syncing':
            indicator.className = 'sync-indicator syncing';
            text.textContent = 'Syncing...';
            break;
        case 'synced':
            indicator.className = 'sync-indicator synced';
            const listCount = userLists.length;
            const totalSongs = userLists.reduce((sum, l) => sum + l.songs.length, 0);
            let syncText = `${favorites.size} favorites`;
            if (listCount > 0) {
                syncText += `, ${listCount} list${listCount !== 1 ? 's' : ''} (${totalSongs} songs)`;
            }
            text.textContent = syncText + ' synced';
            break;
        case 'error':
            indicator.className = 'sync-indicator error';
            text.textContent = 'Sync error (using local)';
            break;
        case 'offline':
            indicator.className = 'sync-indicator offline';
            text.textContent = 'Sign in to sync';
            break;
    }
}

/**
 * Legacy function - favoriteBtn no longer exists
 */
export function updateFavoriteButton() {
    // Favorites checkbox in list picker is updated by renderListPickerDropdown()
}

/**
 * Show favorites view
 */
export function showFavorites() {
    setShowingFavorites(true);
    if (navFavoritesEl) navFavoritesEl.classList.add('active');
    if (navSearchEl) navSearchEl.classList.remove('active');

    const favSongs = allSongs.filter(s => hasFavorite(s.id));

    if (searchStatsEl) {
        searchStatsEl.textContent = `${favSongs.length} favorite${favSongs.length !== 1 ? 's' : ''}`;
    }
    if (searchInputEl) {
        searchInputEl.value = '';
    }

    if (renderResultsFn) {
        renderResultsFn(favSongs, '');
    }
}

/**
 * Hide favorites view
 */
export function hideFavorites() {
    setShowingFavorites(false);
    if (navFavoritesEl) navFavoritesEl.classList.remove('active');
    if (navSearchEl) navSearchEl.classList.add('active');

    if (showRandomSongsFn) {
        showRandomSongsFn();
    }
}

/**
 * Initialize favorites module with DOM elements and callbacks
 */
export function initFavorites(options) {
    const {
        navFavorites,
        navSearch,
        navFavoritesCount,
        searchStats,
        searchInput,
        resultsDiv,
        renderResults,
        showRandomSongs
    } = options;

    navFavoritesEl = navFavorites;
    navSearchEl = navSearch;
    navFavoritesCountEl = navFavoritesCount;
    searchStatsEl = searchStats;
    searchInputEl = searchInput;
    resultsDivEl = resultsDiv;
    renderResultsFn = renderResults;
    showRandomSongsFn = showRandomSongs;

    // Load from localStorage
    loadFavorites();
    updateFavoritesCount();
}
