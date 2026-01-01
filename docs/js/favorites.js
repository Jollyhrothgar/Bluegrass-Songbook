// Favorites management for Bluegrass Songbook

import {
    favorites, setFavorites, addFavorite, removeFavorite, hasFavorite, reorderFavorite,
    allSongs, userLists,
    isCloudSyncEnabled, setCloudSyncEnabled,
    syncInProgress, setSyncInProgress,
    showingFavorites, setShowingFavorites,
    setListContext,
    favoritesCloudId, setFavoritesCloudId, loadFavoritesCloudId
} from './state.js';
import { trackFavorite } from './analytics.js';

// Module-level DOM references (set by init)
let navFavoritesEl = null;
let navSearchEl = null;
let navFavoritesCountEl = null;
let searchStatsEl = null;
let searchInputEl = null;
let resultsDivEl = null;
let printListBtnEl = null;

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
            setFavorites(JSON.parse(saved));
        }
    } catch (e) {
        console.error('Failed to load favorites:', e);
    }
}

/**
 * Reorder a favorite (for drag and drop)
 */
export function reorderFavoriteItem(fromIndex, toIndex) {
    if (reorderFavorite(fromIndex, toIndex)) {
        saveFavorites();
        return true;
    }
    return false;
}

/**
 * Update favorites count in sidebar
 */
export function updateFavoritesCount() {
    if (navFavoritesCountEl) {
        if (favorites.length > 0) {
            navFavoritesCountEl.textContent = favorites.length;
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

    // Track favorite toggle
    trackFavorite(songId, isAdding ? 'add' : 'remove');

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

        // Safety check: don't wipe out local favorites if sync returns empty
        // but we had local favorites (indicates a sync issue, not empty favorites)
        let effectiveFavorites = merged;
        if (merged.length === 0 && localFavs.length > 0) {
            console.warn('Sync returned empty but had local favorites - keeping local');
            effectiveFavorites = localFavs;
            // Don't update localStorage, keep local favorites
        } else {
            // Update local favorites with merged set
            setFavorites(merged);
            saveFavorites();
        }

        // Get or create the shareable favorites list and store its UUID
        const { data: cloudId } = await SupabaseAuth.getOrCreateFavoritesList(effectiveFavorites);
        if (cloudId) {
            setFavoritesCloudId(cloudId);
        }

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
 * Get the shareable cloud ID for favorites
 */
export function getFavoritesCloudId() {
    return favoritesCloudId;
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
            let syncText = `${favorites.length} favorites`;
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

    // Preserve order from favorites array
    const favSongs = favorites
        .map(id => allSongs.find(s => s.id === id))
        .filter(Boolean);
    const favSongIds = favorites.filter(id => allSongs.find(s => s.id === id));

    // Set list context for navigation - use cloud ID if available for sharing
    const effectiveListId = favoritesCloudId || 'favorites';
    setListContext({
        listId: effectiveListId,
        listName: 'Favorites',
        songIds: favSongIds,
        currentIndex: -1
    });

    if (searchStatsEl) {
        searchStatsEl.textContent = `${favSongs.length} favorite${favSongs.length !== 1 ? 's' : ''}`;
    }
    if (searchInputEl) {
        searchInputEl.value = '';
    }

    if (renderResultsFn) {
        renderResultsFn(favSongs, '');
    }

    // Show print list button
    if (printListBtnEl) printListBtnEl.classList.remove('hidden');

    // Show share button if we have a cloud ID (user is signed in and synced)
    const shareListBtn = document.getElementById('share-list-btn');
    if (shareListBtn) {
        shareListBtn.classList.toggle('hidden', !favoritesCloudId);
    }
}

/**
 * Hide favorites view
 */
export function hideFavorites() {
    setShowingFavorites(false);
    setListContext(null);
    if (navFavoritesEl) navFavoritesEl.classList.remove('active');
    if (navSearchEl) navSearchEl.classList.add('active');

    // Hide print list button
    if (printListBtnEl) printListBtnEl.classList.add('hidden');

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
        printListBtn,
        renderResults,
        showRandomSongs
    } = options;

    navFavoritesEl = navFavorites;
    navSearchEl = navSearch;
    navFavoritesCountEl = navFavoritesCount;
    searchStatsEl = searchStats;
    searchInputEl = searchInput;
    resultsDivEl = resultsDiv;
    printListBtnEl = printListBtn;
    renderResultsFn = renderResults;
    showRandomSongsFn = showRandomSongs;

    // Load from localStorage
    loadFavorites();
    loadFavoritesCloudId();
    updateFavoritesCount();
}
