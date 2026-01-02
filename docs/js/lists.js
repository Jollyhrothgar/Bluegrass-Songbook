// User lists management for Bluegrass Songbook

import {
    userLists, setUserLists,
    allSongs, currentSong,
    isCloudSyncEnabled, setCloudSyncEnabled,
    setListContext,
    // Centralized list viewing state
    viewingListId, setViewingListId,
    viewingPublicList, setViewingPublicList
} from './state.js';
import { escapeHtml, generateLocalId } from './utils.js';
import { showRandomSongs } from './search-core.js';
import { trackListAction } from './analytics.js';

// Favorites is just a special list with this ID/name
const FAVORITES_LIST_ID = 'favorites';
const FAVORITES_LIST_NAME = 'Favorites';

// Track deleted lists to prevent sync from resurrecting them (persisted to localStorage)
const DELETED_LISTS_KEY = 'songbook-deleted-lists';
const DELETED_NAMES_KEY = 'songbook-deleted-names';
let deletedListIds = new Set();
let deletedListNames = new Set();

function loadDeletedLists() {
    try {
        const savedIds = localStorage.getItem(DELETED_LISTS_KEY);
        if (savedIds) deletedListIds = new Set(JSON.parse(savedIds));
        const savedNames = localStorage.getItem(DELETED_NAMES_KEY);
        if (savedNames) deletedListNames = new Set(JSON.parse(savedNames));
    } catch (e) {
        console.error('Failed to load deleted lists:', e);
    }
}

function saveDeletedLists() {
    try {
        localStorage.setItem(DELETED_LISTS_KEY, JSON.stringify([...deletedListIds]));
        localStorage.setItem(DELETED_NAMES_KEY, JSON.stringify([...deletedListNames]));
    } catch (e) {
        console.error('Failed to save deleted lists:', e);
    }
}

function addDeletedList(id, name) {
    if (id) deletedListIds.add(id);
    if (name) deletedListNames.add(name);
    saveDeletedLists();
}

function isListDeleted(id, name) {
    return deletedListIds.has(id) || deletedListNames.has(name);
}

// Load on module initialization
loadDeletedLists();

// DOM element references (set by init)
let navListsContainerEl = null;
let navSearchEl = null;
let navFavoritesEl = null;
let navAddSongEl = null;
let searchStatsEl = null;
let searchInputEl = null;
let resultsDivEl = null;
let songViewEl = null;
let listsContainerEl = null;
let customListsContainerEl = null;
let favoritesCheckboxEl = null;
let listPickerBtnEl = null;
let listPickerDropdownEl = null;
let printListBtnEl = null;
let shareListBtnEl = null;

// Callbacks (set by init)
let renderResultsFn = null;
let closeSidebarFn = null;
let pushHistoryStateFn = null;

// Floating result picker state
let activeResultPicker = null;

// Nav element for favorites count badge
let navFavoritesCountEl = null;

// ============================================
// FAVORITES (as a special list)
// ============================================

/**
 * Get the Favorites list (returns null if it doesn't exist)
 */
export function getFavoritesList() {
    return userLists.find(l => l.id === FAVORITES_LIST_ID) || null;
}

/**
 * Get or create the Favorites list
 */
export function getOrCreateFavoritesList() {
    let favList = getFavoritesList();
    if (!favList) {
        favList = {
            id: FAVORITES_LIST_ID,
            name: FAVORITES_LIST_NAME,
            songs: [],
            cloudId: null
        };
        // Insert at the beginning so it appears first
        userLists.unshift(favList);
        saveLists();
    }
    return favList;
}

/**
 * Check if a song is in the Favorites list
 */
export function isFavorite(songId) {
    const favList = getFavoritesList();
    return favList ? favList.songs.includes(songId) : false;
}

/**
 * Toggle a song in the Favorites list
 */
export function toggleFavorite(songId) {
    const favList = getOrCreateFavoritesList();
    const index = favList.songs.indexOf(songId);

    if (index === -1) {
        // Add to favorites
        favList.songs.push(songId);
        trackListAction('add_song', FAVORITES_LIST_ID);
    } else {
        // Remove from favorites
        favList.songs.splice(index, 1);
        trackListAction('remove_song', FAVORITES_LIST_ID);
    }

    saveLists();
    updateFavoritesCount();

    // Re-render if currently viewing favorites
    if (viewingListId === FAVORITES_LIST_ID || viewingListId === 'favorites') {
        showFavorites();
    }

    // Sync to cloud if logged in
    if (favList.cloudId && typeof SupabaseAuth !== 'undefined' && SupabaseAuth.isLoggedIn()) {
        if (index === -1) {
            SupabaseAuth.addToCloudList(favList.cloudId, songId).catch(console.error);
        } else {
            SupabaseAuth.removeFromCloudList(favList.cloudId, songId).catch(console.error);
        }
    }

    return index === -1; // Returns true if added, false if removed
}

/**
 * Reorder a song within the Favorites list (for drag and drop)
 */
export function reorderFavoriteItem(fromIndex, toIndex) {
    const favList = getFavoritesList();
    if (!favList) return false;
    return reorderSongInList(FAVORITES_LIST_ID, fromIndex, toIndex);
}

/**
 * Update the favorites count badge in the nav
 */
export function updateFavoritesCount() {
    if (!navFavoritesCountEl) {
        navFavoritesCountEl = document.getElementById('nav-favorites-count');
    }
    if (!navFavoritesCountEl) return;

    const favList = getFavoritesList();
    const count = favList ? favList.songs.length : 0;

    navFavoritesCountEl.textContent = count.toString();
    navFavoritesCountEl.classList.toggle('hidden', count === 0);
}

/**
 * Update sync status UI
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
            const favList = getFavoritesList();
            const favCount = favList ? favList.songs.length : 0;
            const customLists = userLists.filter(l => l.id !== FAVORITES_LIST_ID);
            text.textContent = `${favCount} favorites` + (customLists.length > 0 ? `, ${customLists.length} lists` : '');
            break;
        case 'error':
            indicator.className = 'sync-indicator error';
            text.textContent = 'Sync error';
            break;
    }
}

/**
 * Show the Favorites list view
 */
export function showFavorites() {
    const favList = getFavoritesList();

    // Update nav states
    if (navSearchEl) navSearchEl.classList.remove('active');
    if (navFavoritesEl) navFavoritesEl.classList.add('active');
    if (navAddSongEl) navAddSongEl.classList.remove('active');

    if (!favList || favList.songs.length === 0) {
        // Empty favorites view
        setViewingListId(FAVORITES_LIST_ID);
        setViewingPublicList(null);

        setListContext({
            listId: FAVORITES_LIST_ID,
            listName: FAVORITES_LIST_NAME,
            songIds: [],
            currentIndex: -1
        });

        if (searchStatsEl) {
            searchStatsEl.textContent = '0 favorites';
        }
        if (searchInputEl) {
            searchInputEl.value = '';
        }
        if (renderResultsFn) {
            renderResultsFn([], '');
        }

        // Show search container
        const searchContainer = document.querySelector('.search-container');
        const editorPanel = document.getElementById('editor-panel');
        if (searchContainer) searchContainer.classList.remove('hidden');
        if (resultsDivEl) resultsDivEl.classList.remove('hidden');
        if (editorPanel) editorPanel.classList.add('hidden');
        if (songViewEl) songViewEl.classList.add('hidden');
        if (printListBtnEl) printListBtnEl.classList.add('hidden');
        if (shareListBtnEl) shareListBtnEl.classList.add('hidden');

        return;
    }

    // Show favorites using the regular list view
    setViewingListId(FAVORITES_LIST_ID);  // Always use local ID for favorites
    setViewingPublicList(null);
    renderListViewUI(FAVORITES_LIST_NAME, favList.songs, true);

    // Update nav (renderListViewUI clears favorites active state)
    if (navFavoritesEl) navFavoritesEl.classList.add('active');

    // Show action buttons for favorites (but not delete)
    if (shareListBtnEl) shareListBtnEl.classList.remove('hidden');
    if (printListBtnEl) printListBtnEl.classList.remove('hidden');
    const duplicateListBtn = document.getElementById('duplicate-list-btn');
    if (duplicateListBtn) {
        duplicateListBtn.textContent = 'Duplicate';
        duplicateListBtn.classList.remove('hidden');
    }
    // Explicitly hide delete for favorites
    const deleteListBtn = document.getElementById('delete-list-btn');
    if (deleteListBtn) deleteListBtn.classList.add('hidden');
}

/**
 * Save lists to localStorage
 */
export function saveLists() {
    localStorage.setItem('songbook-lists', JSON.stringify(userLists));
    renderSidebarLists();
}

/**
 * Load lists from localStorage
 */
export function loadLists() {
    try {
        const saved = localStorage.getItem('songbook-lists');
        if (saved) {
            setUserLists(JSON.parse(saved));
        }
    } catch (e) {
        console.error('Failed to load lists:', e);
    }
}

/**
 * Migrate old favorites format (songbook-favorites) to new list-based format
 */
function migrateOldFavorites() {
    try {
        const oldFavs = localStorage.getItem('songbook-favorites');
        if (!oldFavs) return;

        const favIds = JSON.parse(oldFavs);
        if (!Array.isArray(favIds) || favIds.length === 0) {
            // Clean up empty old format
            localStorage.removeItem('songbook-favorites');
            localStorage.removeItem('songbook-favorites-cloud-id');
            return;
        }

        // Get or create Favorites list and merge old favorites
        const favList = getOrCreateFavoritesList();

        // Merge old favorites (avoid duplicates)
        const existingSet = new Set(favList.songs);
        for (const songId of favIds) {
            if (!existingSet.has(songId)) {
                favList.songs.push(songId);
            }
        }

        // Preserve cloud ID if it existed
        const oldCloudId = localStorage.getItem('songbook-favorites-cloud-id');
        if (oldCloudId && !favList.cloudId) {
            favList.cloudId = oldCloudId;
        }

        saveLists();

        // Remove old storage keys
        localStorage.removeItem('songbook-favorites');
        localStorage.removeItem('songbook-favorites-cloud-id');

        console.log(`Migrated ${favIds.length} favorites to list-based system`);
    } catch (e) {
        console.error('Failed to migrate old favorites:', e);
    }
}

/**
 * Create a new list
 */
export function createList(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;

    // Check for duplicate names
    if (userLists.some(l => l.name.toLowerCase() === trimmed.toLowerCase())) {
        return null;
    }

    const newList = {
        id: generateLocalId(),
        name: trimmed,
        songs: [],
        cloudId: null
    };

    userLists.push(newList);
    saveLists();
    trackListAction('create', newList.id);

    // Sync to cloud if logged in
    syncListToCloud(newList, 'create');

    return newList;
}

/**
 * Rename a list
 */
export function renameList(listId, newName) {
    const trimmed = newName.trim();
    if (!trimmed) return false;

    const list = userLists.find(l => l.id === listId);
    if (!list) return false;

    // Check for duplicate names
    if (userLists.some(l => l.id !== listId && l.name.toLowerCase() === trimmed.toLowerCase())) {
        return false;
    }

    list.name = trimmed;
    saveLists();

    // Sync to cloud
    if (list.cloudId) {
        syncListToCloud(list, 'rename');
    }

    return true;
}

/**
 * Delete a list
 */
export async function deleteList(listId) {
    const index = userLists.findIndex(l => l.id === listId);
    if (index === -1) return false;

    const list = userLists[index];

    // Track deleted list by both ID and name to prevent sync from resurrecting it
    addDeletedList(list.cloudId, list.name);
    addDeletedList(listId, null);

    userLists.splice(index, 1);
    saveLists();
    trackListAction('delete', listId);

    // Sync to cloud
    if (list.cloudId) {
        await syncListToCloud(list, 'delete');
    }

    return true;
}

/**
 * Add a song to a list
 */
export function addSongToList(listId, songId) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return false;

    if (!list.songs.includes(songId)) {
        list.songs.push(songId);
        saveLists();
        trackListAction('add_song', listId);

        // Sync to cloud
        if (list.cloudId && typeof SupabaseAuth !== 'undefined' && SupabaseAuth.isLoggedIn()) {
            SupabaseAuth.addToCloudList(list.cloudId, songId).catch(console.error);
        }
    }

    return true;
}

/**
 * Remove a song from a list
 */
export function removeSongFromList(listId, songId) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return false;

    const index = list.songs.indexOf(songId);
    if (index !== -1) {
        list.songs.splice(index, 1);
        saveLists();
        trackListAction('remove_song', listId);

        // Sync to cloud
        if (list.cloudId && typeof SupabaseAuth !== 'undefined' && SupabaseAuth.isLoggedIn()) {
            SupabaseAuth.removeFromCloudList(list.cloudId, songId).catch(console.error);
        }
    }

    return true;
}

/**
 * Reorder a song within a list (for drag and drop)
 */
export function reorderSongInList(listId, fromIndex, toIndex) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return false;
    if (fromIndex < 0 || fromIndex >= list.songs.length) return false;
    if (toIndex < 0 || toIndex >= list.songs.length) return false;
    if (fromIndex === toIndex) return false;

    // Remove from old position and insert at new position
    const [songId] = list.songs.splice(fromIndex, 1);
    list.songs.splice(toIndex, 0, songId);
    saveLists();
    trackListAction('reorder', listId);

    // Note: Cloud sync for reorder would need a separate API
    // For now, full list sync handles this on next login

    return true;
}

/**
 * Check if a song is in a specific list
 */
export function isSongInList(listId, songId) {
    const list = userLists.find(l => l.id === listId);
    return list ? list.songs.includes(songId) : false;
}

/**
 * Check if a song is in any list
 */
export function isSongInAnyList(songId) {
    return userLists.some(l => l.songs.includes(songId));
}

/**
 * Sync a single list change to cloud
 */
async function syncListToCloud(list, action) {
    if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) return;

    try {
        switch (action) {
            case 'create':
                const { data } = await SupabaseAuth.createCloudList(list.name);
                if (data) {
                    list.cloudId = data.id;
                    // Add songs to the new cloud list
                    for (const songId of list.songs) {
                        await SupabaseAuth.addToCloudList(data.id, songId);
                    }
                    saveLists();
                }
                break;
            case 'rename':
                if (list.cloudId) {
                    await SupabaseAuth.renameCloudList(list.cloudId, list.name);
                }
                break;
            case 'delete':
                if (list.cloudId || list.name) {
                    // Pass both cloudId and name - if ID doesn't match, delete by name as fallback
                    const result = await SupabaseAuth.deleteCloudList(list.cloudId, list.name);
                    if (result.error) {
                        console.error('Failed to delete cloud list:', result.error);
                    }
                }
                break;
        }
    } catch (err) {
        console.error('List sync error:', err);
    }
}

// Track sync state to prevent duplicate syncs
let syncInProgress = false;

/**
 * Full sync: merge localStorage lists with cloud
 * Also migrates old cloud favorites (user_favorites table) to the new list-based system
 */
export async function performFullListsSync() {
    if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
        return;
    }

    // Prevent duplicate syncs
    if (syncInProgress) return;
    syncInProgress = true;

    try {
        // Step 1: Migrate old cloud favorites from user_favorites table
        await migrateCloudFavorites();

        // Step 2: Sync lists (including the Favorites list)
        const { data: merged, error } = await SupabaseAuth.syncListsToCloud(userLists);
        if (error) throw error;

        // Step 3: Process and deduplicate lists
        let processedLists = processCloudLists(merged);

        // Step 4: Re-filter for any lists deleted DURING the sync (race condition fix)
        if (deletedListIds.size > 0 || deletedListNames.size > 0) {
            processedLists = processedLists.filter(l =>
                !isListDeleted(l.id, l.name) && !isListDeleted(l.cloudId, l.name)
            );
        }

        // Update local lists with processed data
        setUserLists(processedLists);
        saveLists();
        updateFavoritesCount();

        // Enable cloud sync for future operations
        setCloudSyncEnabled(true);
        updateSyncUI('synced');
    } catch (err) {
        console.error('Lists sync failed:', err);
        updateSyncUI('error');
    } finally {
        syncInProgress = false;
    }
}

/**
 * Process cloud lists into local format, deduplicating and handling Favorites specially
 */
function processCloudLists(cloudLists) {
    const result = [];
    let favoritesEntry = null;
    const seenNames = new Set();

    // Old-style favorites list names to migrate
    const oldFavoritesNames = ['❤️ Favorites', '❤️ favorites', '♥ Favorites'];

    for (const cloudList of cloudLists) {
        // Skip lists that were deleted during this session (check both ID and name)
        if (isListDeleted(cloudList.id, cloudList.name)) {
            continue;
        }

        // Skip duplicates by name (keep first occurrence)
        if (seenNames.has(cloudList.name)) {
            continue;
        }

        // Handle Favorites and old-style favorites
        if (cloudList.name === FAVORITES_LIST_NAME || oldFavoritesNames.includes(cloudList.name)) {
            if (!favoritesEntry) {
                // First favorites list we encounter
                favoritesEntry = {
                    id: FAVORITES_LIST_ID,
                    name: FAVORITES_LIST_NAME,
                    songs: cloudList.songs || [],
                    cloudId: cloudList.name === FAVORITES_LIST_NAME ? cloudList.id : null
                };
            } else {
                // Merge songs from additional favorites lists
                const existingSongs = new Set(favoritesEntry.songs);
                for (const songId of (cloudList.songs || [])) {
                    if (!existingSongs.has(songId)) {
                        favoritesEntry.songs.push(songId);
                    }
                }
                // If this is the proper "Favorites" name and we don't have a cloudId yet, use it
                if (cloudList.name === FAVORITES_LIST_NAME && !favoritesEntry.cloudId) {
                    favoritesEntry.cloudId = cloudList.id;
                }
            }
            seenNames.add(cloudList.name);
            continue;
        }

        // Regular list
        seenNames.add(cloudList.name);
        result.push({
            id: cloudList.id,
            name: cloudList.name,
            songs: cloudList.songs || [],
            cloudId: cloudList.id
        });
    }

    // Add favorites at the beginning if it exists
    if (favoritesEntry) {
        result.unshift(favoritesEntry);
    }

    return result;
}

/**
 * Migrate old cloud favorites (user_favorites table) to the Favorites list
 * This is a one-time migration that adds songs from the old table to the local favorites
 */
async function migrateCloudFavorites() {
    if (typeof SupabaseAuth === 'undefined') return;

    try {
        // Fetch old cloud favorites from user_favorites table
        const { data: oldCloudFavs, error } = await SupabaseAuth.fetchCloudFavorites();
        if (error || !oldCloudFavs || oldCloudFavs.length === 0) {
            return; // No old favorites to migrate
        }

        console.log(`Migrating ${oldCloudFavs.length} cloud favorites to list system`);

        // Find existing Favorites list (don't create one - sync will handle that)
        let favList = getFavoritesList();
        if (!favList) {
            // Create a minimal favorites list to hold the migrated songs
            favList = {
                id: FAVORITES_LIST_ID,
                name: FAVORITES_LIST_NAME,
                songs: [],
                cloudId: null
            };
            userLists.unshift(favList);
        }

        // Merge old cloud favorites (avoid duplicates)
        const existingSet = new Set(favList.songs);
        for (const songId of oldCloudFavs) {
            if (!existingSet.has(songId)) {
                favList.songs.push(songId);
            }
        }

        // Save locally - don't call full saveLists() to avoid re-render during sync
        localStorage.setItem('songbook-lists', JSON.stringify(userLists));
    } catch (e) {
        console.error('Failed to migrate cloud favorites:', e);
    }
}

/**
 * Render lists in sidebar
 */
export function renderSidebarLists() {
    if (!navListsContainerEl) return;
    navListsContainerEl.innerHTML = '';

    // Exclude Favorites list - it has its own nav button
    const customLists = userLists.filter(l => l.id !== FAVORITES_LIST_ID);

    customLists.forEach(list => {
        const btn = document.createElement('button');
        btn.className = 'nav-item' + (viewingListId === list.id ? ' active' : '');
        btn.dataset.listId = list.id;
        btn.innerHTML = `
            <span class="nav-icon">&#9776;</span>
            <span class="nav-label">${escapeHtml(list.name)}</span>
            ${list.songs.length > 0 ? `<span class="nav-badge">${list.songs.length}</span>` : ''}
        `;
        btn.addEventListener('click', () => {
            showListView(list.id);
            if (pushHistoryStateFn) {
                pushHistoryStateFn('list', { listId: list.id });
            }
        });
        navListsContainerEl.appendChild(btn);
    });
}

/**
 * Show songs in a specific list (local or public)
 */
export async function showListView(listId) {
    // Handle favorites as a special "list"
    if (listId === 'favorites' || listId === FAVORITES_LIST_ID) {
        showFavorites();
        return;
    }

    // First check if this is a local list
    const localList = userLists.find(l => l.id === listId);

    if (localList) {
        // It's a local list - show it normally
        setViewingListId(listId);
        setViewingPublicList(null);
        renderListViewUI(localList.name, localList.songs, true);
        return;
    }

    // Not a local list - try to fetch as a public list
    if (typeof SupabaseAuth === 'undefined') {
        showListNotFound();
        return;
    }

    const { data, error } = await SupabaseAuth.fetchPublicList(listId);
    if (error || !data || !data.list) {
        showListNotFound();
        return;
    }

    // Check if current user owns this list
    const currentUser = SupabaseAuth.getUser();
    const isOwner = currentUser && data.list.user_id === currentUser.id;

    setViewingListId(listId);
    setViewingPublicList({
        list: data.list,
        songs: data.songs,
        isOwner
    });

    renderListViewUI(data.list.name, data.songs, isOwner);
}

/**
 * Show "list not found" message
 */
function showListNotFound() {
    setViewingListId(null);
    setViewingPublicList(null);

    if (searchStatsEl) {
        searchStatsEl.textContent = 'List not found';
    }
    if (resultsDivEl) {
        resultsDivEl.innerHTML = '<p class="no-results">This list doesn\'t exist or has been deleted.</p>';
    }

    // Show search container/results
    const searchContainer = document.querySelector('.search-container');
    const editorPanel = document.getElementById('editor-panel');
    if (searchContainer) searchContainer.classList.remove('hidden');
    if (resultsDivEl) resultsDivEl.classList.remove('hidden');
    if (editorPanel) editorPanel.classList.add('hidden');
    if (songViewEl) songViewEl.classList.add('hidden');
    if (printListBtnEl) printListBtnEl.classList.add('hidden');
}

/**
 * Render the list view UI (shared by local and public lists)
 */
function renderListViewUI(listName, songIds, isOwner) {
    if (closeSidebarFn) closeSidebarFn();

    // Update nav active states
    if (navSearchEl) navSearchEl.classList.remove('active');
    if (navFavoritesEl) navFavoritesEl.classList.remove('active');
    if (navAddSongEl) navAddSongEl.classList.remove('active');

    // Update sidebar list buttons (only for local lists)
    if (navListsContainerEl) {
        navListsContainerEl.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.listId === viewingListId && !viewingPublicList);
        });
    }

    // Show the list songs (preserve order from the list)
    const listSongs = songIds
        .map(id => allSongs.find(s => s.id === id))
        .filter(Boolean);

    // Set list context for navigation
    setListContext({
        listId: viewingListId,
        listName: listName,
        songIds: songIds,
        currentIndex: -1  // Will be set when a song is opened
    });

    // Build status text with "Copy to My Lists" button for non-owners
    let statusHtml = `${escapeHtml(listName)}: ${listSongs.length} song${listSongs.length !== 1 ? 's' : ''}`;
    if (viewingPublicList && !isOwner) {
        statusHtml += ' <span class="shared-list-badge">Shared List</span>';
    }

    if (searchStatsEl) {
        searchStatsEl.innerHTML = statusHtml;
    }
    if (searchInputEl) {
        searchInputEl.value = '';
    }
    if (renderResultsFn) {
        renderResultsFn(listSongs, '');
    }

    // Show search container/results
    const searchContainer = document.querySelector('.search-container');
    const editorPanel = document.getElementById('editor-panel');
    if (searchContainer) searchContainer.classList.remove('hidden');
    if (resultsDivEl) resultsDivEl.classList.remove('hidden');
    if (editorPanel) editorPanel.classList.add('hidden');
    if (songViewEl) songViewEl.classList.add('hidden');

    // Show action buttons
    if (printListBtnEl) printListBtnEl.classList.remove('hidden');
    if (shareListBtnEl && isOwner) shareListBtnEl.classList.remove('hidden');

    // Duplicate/Import button - show for all lists, text changes based on ownership
    const duplicateListBtn = document.getElementById('duplicate-list-btn');
    if (duplicateListBtn) {
        if (isOwner) {
            duplicateListBtn.textContent = 'Duplicate';
            duplicateListBtn.classList.remove('hidden');
        } else if (viewingPublicList) {
            duplicateListBtn.textContent = 'Import';
            duplicateListBtn.classList.remove('hidden');
        }
    }

    // Show delete button for own lists (but not favorites)
    const deleteListBtn = document.getElementById('delete-list-btn');
    if (deleteListBtn && isOwner && viewingListId !== FAVORITES_LIST_ID && viewingListId !== 'favorites') {
        deleteListBtn.classList.remove('hidden');
    }

    // Hide the old copy button (now consolidated into duplicate/import)
    const copyListBtn = document.getElementById('copy-list-btn');
    if (copyListBtn) copyListBtn.classList.add('hidden');
}

/**
 * Clear list view state
 */
export function clearListView() {
    setViewingListId(null);
    setViewingPublicList(null);
    setListContext(null);
    if (navListsContainerEl) {
        navListsContainerEl.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
        });
    }
    // Hide list action buttons
    if (printListBtnEl) printListBtnEl.classList.add('hidden');
    if (shareListBtnEl) shareListBtnEl.classList.add('hidden');
    const copyListBtn = document.getElementById('copy-list-btn');
    if (copyListBtn) copyListBtn.classList.add('hidden');
    const duplicateListBtn = document.getElementById('duplicate-list-btn');
    if (duplicateListBtn) duplicateListBtn.classList.add('hidden');
    const deleteListBtn = document.getElementById('delete-list-btn');
    if (deleteListBtn) deleteListBtn.classList.add('hidden');
}

/**
 * Check if currently viewing own list (or any local list)
 */
export function isViewingOwnList() {
    if (!viewingListId) return false;
    if (viewingPublicList) return viewingPublicList.isOwner;
    return true;  // Local list = own list
}

/**
 * Get current viewing list ID
 */
export function getViewingListId() {
    return viewingListId;
}

/**
 * Fetch list data without rendering
 * @returns {Promise<{name: string, songs: string[], isOwner: boolean} | null>}
 */
export async function fetchListData(listId) {
    // First check if this is a local list
    const localList = userLists.find(l => l.id === listId);

    if (localList) {
        return {
            name: localList.name,
            songs: localList.songs,
            isOwner: true
        };
    }

    // Not a local list - try to fetch as a public list
    if (typeof SupabaseAuth === 'undefined') {
        return null;
    }

    const { data, error } = await SupabaseAuth.fetchPublicList(listId);
    if (error || !data || !data.list) {
        return null;
    }

    const currentUser = SupabaseAuth.getUser();
    const isOwner = currentUser && data.list.user_id === currentUser.id;

    return {
        name: data.list.name,
        songs: data.songs,
        isOwner
    };
}

/**
 * Render list picker dropdown (in song view)
 */
export function renderListPickerDropdown() {
    if (!customListsContainerEl || !currentSong) return;

    customListsContainerEl.innerHTML = '';

    // Exclude Favorites - it has its own checkbox
    userLists.filter(l => l.id !== FAVORITES_LIST_ID).forEach(list => {
        const label = document.createElement('label');
        label.className = 'list-option';
        const isInList = list.songs.includes(currentSong.id);
        label.innerHTML = `
            <input type="checkbox" data-list-id="${list.id}" ${isInList ? 'checked' : ''}>
            <span>&#9776;</span>
            <span>${escapeHtml(list.name)}</span>
        `;
        customListsContainerEl.appendChild(label);
    });

    // Update favorites checkbox
    if (favoritesCheckboxEl) {
        favoritesCheckboxEl.checked = isFavorite(currentSong.id);
    }

    // Update picker button state
    updateListPickerButton();
}

/**
 * Update list picker button appearance
 */
export function updateListPickerButton() {
    if (!listPickerBtnEl || !currentSong) return;

    const inFavorites = isFavorite(currentSong.id);
    const inAnyList = isSongInAnyList(currentSong.id);

    listPickerBtnEl.classList.toggle('has-lists', inFavorites || inAnyList);
}

/**
 * Update favorite button state (called from song-view.js)
 * With unified favorites/lists, this just updates the list picker
 */
export function updateFavoriteButton() {
    // The favorites checkbox is updated by renderListPickerDropdown()
    // This function exists for API compatibility with song-view.js
}

/**
 * Show floating list picker for search results
 */
export function showResultListPicker(btn, songId) {
    // Close any existing picker
    closeResultListPicker();

    const song = allSongs.find(s => s.id === songId);
    if (!song) return;

    // Create floating picker
    const picker = document.createElement('div');
    picker.className = 'result-list-picker';
    picker.innerHTML = `
        <label class="list-option favorites-option">
            <input type="checkbox" data-type="favorites" ${isFavorite(songId) ? 'checked' : ''}>
            <span class="heart-icon">&#9829;</span>
            <span>Favorites</span>
        </label>
        <div class="list-divider"></div>
        <div class="result-picker-lists">
            ${userLists.filter(l => l.id !== FAVORITES_LIST_ID).map(list => `
                <label class="list-option">
                    <input type="checkbox" data-type="list" data-list-id="${list.id}" ${list.songs.includes(songId) ? 'checked' : ''}>
                    <span>&#9776;</span>
                    <span>${escapeHtml(list.name)}</span>
                </label>
            `).join('')}
        </div>
        <button class="create-list-btn" data-type="create">+ New List</button>
    `;

    // Position the picker
    const rect = btn.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = `${rect.bottom + 4}px`;
    picker.style.right = `${window.innerWidth - rect.right}px`;

    document.body.appendChild(picker);
    activeResultPicker = { element: picker, songId, btn };

    // Handle checkbox changes
    picker.addEventListener('change', (e) => {
        if (e.target.type !== 'checkbox') return;

        if (e.target.dataset.type === 'favorites') {
            toggleFavorite(songId);
        } else if (e.target.dataset.type === 'list') {
            const listId = e.target.dataset.listId;
            if (e.target.checked) {
                addSongToList(listId, songId);
            } else {
                removeSongFromList(listId, songId);
            }
        }

        // Update the button appearance
        updateResultListButton(btn, songId);

        // Close picker after selection
        closeResultListPicker();
    });

    // Handle create new list
    picker.querySelector('[data-type="create"]').addEventListener('click', () => {
        const name = prompt('Enter list name:');
        if (name) {
            const newList = createList(name);
            if (newList) {
                addSongToList(newList.id, songId);
                closeResultListPicker();
                updateResultListButton(btn, songId);
            } else {
                alert('A list with that name already exists.');
            }
        }
    });
}

/**
 * Close floating result list picker
 */
export function closeResultListPicker() {
    if (activeResultPicker) {
        activeResultPicker.element.remove();
        activeResultPicker = null;
    }
}

/**
 * Update result list button appearance
 */
export function updateResultListButton(btn, songId) {
    const inFavorites = isFavorite(songId);
    const inAnyList = isSongInAnyList(songId);
    btn.classList.toggle('has-lists', inFavorites || inAnyList);

    // Also update the result item's favorite class
    const resultItem = btn.closest('.result-item');
    if (resultItem) {
        resultItem.classList.toggle('is-favorite', inFavorites);
    }
}

/**
 * Render manage lists modal
 */
export function renderListsModal() {
    if (!listsContainerEl) return;

    // Exclude Favorites list - it can't be renamed/deleted from here
    const customLists = userLists.filter(l => l.id !== FAVORITES_LIST_ID);

    if (customLists.length === 0) {
        listsContainerEl.innerHTML = '<p class="lists-empty">No lists yet. Create one above!</p>';
        return;
    }

    listsContainerEl.innerHTML = '';

    customLists.forEach(list => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <span class="list-item-icon">&#9776;</span>
            <span class="list-item-name">${escapeHtml(list.name)}</span>
            <span class="list-item-count">${list.songs.length} songs</span>
            <div class="list-item-actions">
                <button class="list-item-btn rename-list-btn" data-list-id="${list.id}">Rename</button>
                <button class="list-item-btn danger delete-list-btn" data-list-id="${list.id}">Delete</button>
            </div>
        `;
        listsContainerEl.appendChild(div);
    });

    // Add event listeners
    listsContainerEl.querySelectorAll('.rename-list-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const listId = btn.dataset.listId;
            const list = userLists.find(l => l.id === listId);
            if (list) {
                const newName = prompt('Enter new name:', list.name);
                if (newName && renameList(listId, newName)) {
                    renderListsModal();
                }
            }
        });
    });

    listsContainerEl.querySelectorAll('.delete-list-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const listId = btn.dataset.listId;
            const list = userLists.find(l => l.id === listId);
            if (list && confirm(`Delete "${list.name}"? Songs won't be deleted from the songbook.`)) {
                await deleteList(listId);
                renderListsModal();
            }
        });
    });
}

/**
 * Initialize lists module with DOM elements and callbacks
 */
export function initLists(options) {
    const {
        navListsContainer,
        navSearch,
        navFavorites,
        navAddSong,
        searchStats,
        searchInput,
        resultsDiv,
        songView,
        listsContainer,
        customListsContainer,
        favoritesCheckbox,
        listPickerBtn,
        listPickerDropdown,
        printListBtn,
        renderResults,
        closeSidebar,
        pushHistoryState
    } = options;

    navListsContainerEl = navListsContainer;
    navSearchEl = navSearch;
    navFavoritesEl = navFavorites;
    navAddSongEl = navAddSong;
    searchStatsEl = searchStats;
    searchInputEl = searchInput;
    resultsDivEl = resultsDiv;
    songViewEl = songView;
    listsContainerEl = listsContainer;
    customListsContainerEl = customListsContainer;
    favoritesCheckboxEl = favoritesCheckbox;
    listPickerBtnEl = listPickerBtn;
    listPickerDropdownEl = listPickerDropdown;
    printListBtnEl = printListBtn;
    shareListBtnEl = document.getElementById('share-list-btn');
    renderResultsFn = renderResults;
    closeSidebarFn = closeSidebar;
    pushHistoryStateFn = pushHistoryState;

    // Share list button - copy URL to clipboard
    shareListBtnEl?.addEventListener('click', async () => {
        let shareId = null;

        // Get the cloudId for the current list
        if (viewingListId === 'favorites' || viewingListId === FAVORITES_LIST_ID) {
            const favList = getFavoritesList();
            shareId = favList?.cloudId;
        } else if (viewingListId) {
            // For other lists, find the cloudId
            const list = userLists.find(l => l.id === viewingListId);
            shareId = list?.cloudId || viewingListId;
        }

        if (!shareId || shareId === 'favorites') {
            alert('Sign in and sync to share this list');
            return;
        }

        const shareUrl = `${window.location.origin}${window.location.pathname}#list/${shareId}`;

        try {
            await navigator.clipboard.writeText(shareUrl);
            const originalText = shareListBtnEl.textContent;
            shareListBtnEl.textContent = 'Copied!';
            setTimeout(() => {
                shareListBtnEl.textContent = originalText;
            }, 2000);
        } catch (err) {
            // Fallback for older browsers
            prompt('Copy this link:', shareUrl);
        }
    });

    // Duplicate/Import list button
    const duplicateListBtn = document.getElementById('duplicate-list-btn');
    duplicateListBtn?.addEventListener('click', async () => {
        let songsToCopy = [];
        let listName = '';

        // Handle importing a public list (not owned by user)
        if (viewingPublicList && !viewingPublicList.isOwner) {
            // Import from public list
            if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
                alert('Please sign in to import lists');
                return;
            }

            songsToCopy = viewingPublicList.songs || [];
            listName = viewingPublicList.list.name;

            if (!songsToCopy.length) {
                alert('Nothing to import');
                return;
            }

            const newName = prompt('Name for imported list:', listName);
            if (!newName) return;

            const newList = createList(newName);
            if (!newList) {
                alert('A list with that name already exists');
                return;
            }

            for (const songId of songsToCopy) {
                addSongToList(newList.id, songId);
            }

            showListView(newList.id);
            if (pushHistoryStateFn) {
                pushHistoryStateFn('list', { listId: newList.id });
            }
            return;
        }

        // Handle duplicating own list
        if (viewingListId === 'favorites' || viewingListId === FAVORITES_LIST_ID) {
            const favList = getFavoritesList();
            songsToCopy = favList?.songs || [];
            listName = 'Favorites';
        } else if (viewingListId) {
            const localList = userLists.find(l => l.id === viewingListId);
            songsToCopy = localList?.songs || [];
            listName = localList?.name || 'List';
        }

        if (!songsToCopy.length) {
            alert('Nothing to duplicate');
            return;
        }

        const newName = prompt('Name for the copy:', `${listName} (copy)`);
        if (!newName) return;

        const newList = createList(newName);
        if (!newList) {
            alert('A list with that name already exists');
            return;
        }

        for (const songId of songsToCopy) {
            addSongToList(newList.id, songId);
        }

        showListView(newList.id);
        if (pushHistoryStateFn) {
            pushHistoryStateFn('list', { listId: newList.id });
        }
    });

    // Delete list button
    const deleteListBtnInit = document.getElementById('delete-list-btn');
    deleteListBtnInit?.addEventListener('click', async () => {
        if (!viewingListId || viewingListId === 'favorites' || viewingListId === FAVORITES_LIST_ID) {
            return;
        }

        const list = userLists.find(l => l.id === viewingListId);
        const listName = list?.name || 'this list';

        if (!confirm(`Delete "${listName}"? Songs won't be deleted from the songbook.`)) {
            return;
        }

        await deleteList(viewingListId);

        // Navigate back to home
        clearListView();
        if (navSearchEl) navSearchEl.classList.add('active');
        showRandomSongs();
        if (pushHistoryStateFn) {
            pushHistoryStateFn('search', {});
        }
    });

    // Load from localStorage
    loadLists();

    // Migrate old favorites format to new list-based format
    migrateOldFavorites();

    renderSidebarLists();
    updateFavoritesCount();

    // Handle checkbox changes in the song view list picker (event delegation)
    if (listPickerDropdownEl) {
        listPickerDropdownEl.addEventListener('change', (e) => {
            const checkbox = e.target;
            if (checkbox.type !== 'checkbox' || !currentSong) return;

            if (checkbox.id === 'favorites-checkbox') {
                toggleFavorite(currentSong.id);
            } else if (checkbox.dataset.listId) {
                const listId = checkbox.dataset.listId;
                if (checkbox.checked) {
                    addSongToList(listId, currentSong.id);
                } else {
                    removeSongFromList(listId, currentSong.id);
                }
            }
            updateListPickerButton();
        });
    }

    // Close result picker when clicking outside
    document.addEventListener('click', (e) => {
        if (activeResultPicker) {
            if (!activeResultPicker.element.contains(e.target) && e.target !== activeResultPicker.btn) {
                closeResultListPicker();
            }
        }
    });
}
