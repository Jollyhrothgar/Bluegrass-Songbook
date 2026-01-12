// User lists management for Bluegrass Songbook

import {
    userLists, setUserLists,
    allSongs, currentSong,
    isCloudSyncEnabled, setCloudSyncEnabled,
    setListContext,
    // Centralized list viewing state
    viewingListId, setViewingListId,
    viewingPublicList, setViewingPublicList,
    FAVORITES_LIST_ID,
    listEditMode, setListEditMode,
    multiSelectMode, setMultiSelectMode, clearSelectedSongs
} from './state.js';
import { escapeHtml, generateLocalId } from './utils.js';
import { showRandomSongs, hideBatchOperationsBar } from './search-core.js';
import { trackListAction } from './analytics.js';
import { showListPicker, closeListPicker, updateTriggerButton } from './list-picker.js';

// Re-export FAVORITES_LIST_ID for backwards compatibility
export { FAVORITES_LIST_ID };
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

// ============================================
// FOLDER ORGANIZATION (LOCAL-ONLY)
// ============================================
// Folders are purely local organization - they never sync to cloud.
// Lists are cloud entities; folders just organize where they appear.

const FOLDERS_KEY = 'songbook-folders';

/**
 * Folder schema:
 * {
 *   folders: [
 *     { id: "uuid", name: "Practice", parentId: null, position: 0 },
 *     { id: "uuid2", name: "By Genre", parentId: null, position: 1 },
 *     { id: "uuid3", name: "Bluegrass", parentId: "uuid2", position: 0 }
 *   ],
 *   listPlacements: {
 *     "list-cloud-id": "folder-uuid",  // List in folder
 *     "list-cloud-id-2": null          // List at root
 *   }
 * }
 */
let folderData = { folders: [], listPlacements: {} };

function loadFolders() {
    try {
        const saved = localStorage.getItem(FOLDERS_KEY);
        if (saved) {
            folderData = JSON.parse(saved);
            // Ensure required properties exist
            if (!folderData.folders) folderData.folders = [];
            if (!folderData.listPlacements) folderData.listPlacements = {};
        }
    } catch (e) {
        console.error('Failed to load folders:', e);
        folderData = { folders: [], listPlacements: {} };
    }
}

function saveFolders() {
    try {
        localStorage.setItem(FOLDERS_KEY, JSON.stringify(folderData));
    } catch (e) {
        console.error('Failed to save folders:', e);
    }
}

/**
 * Get all folders
 */
export function getFolders() {
    return folderData.folders;
}

/**
 * Get folders at a specific level (by parentId)
 */
export function getFoldersAtLevel(parentId = null) {
    return folderData.folders
        .filter(f => f.parentId === parentId)
        .sort((a, b) => a.position - b.position);
}

/**
 * Create a new folder
 */
export function createFolder(name, parentId = null) {
    const siblings = getFoldersAtLevel(parentId);
    const position = siblings.length;

    const folder = {
        id: generateLocalId(),
        name,
        parentId,
        position
    };

    folderData.folders.push(folder);
    saveFolders();
    return folder;
}

/**
 * Rename a folder
 */
export function renameFolder(folderId, newName) {
    const folder = folderData.folders.find(f => f.id === folderId);
    if (folder) {
        folder.name = newName;
        saveFolders();
    }
}

/**
 * Delete a folder (moves contents to parent or root)
 */
export function deleteFolder(folderId) {
    const folder = folderData.folders.find(f => f.id === folderId);
    if (!folder) return;

    // Move child folders to parent
    folderData.folders
        .filter(f => f.parentId === folderId)
        .forEach(f => {
            f.parentId = folder.parentId;
        });

    // Move lists in this folder to parent (or root)
    Object.keys(folderData.listPlacements).forEach(listId => {
        if (folderData.listPlacements[listId] === folderId) {
            folderData.listPlacements[listId] = folder.parentId;
        }
    });

    // Remove the folder
    folderData.folders = folderData.folders.filter(f => f.id !== folderId);
    saveFolders();
}

/**
 * Move a folder to a different parent
 */
export function moveFolder(folderId, newParentId) {
    const folder = folderData.folders.find(f => f.id === folderId);
    if (!folder) return;

    // Prevent moving a folder into itself or its descendants
    if (newParentId === folderId || isDescendantOf(newParentId, folderId)) {
        return false;
    }

    const siblings = getFoldersAtLevel(newParentId);
    folder.parentId = newParentId;
    folder.position = siblings.length;
    saveFolders();
    return true;
}

/**
 * Check if a folder is a descendant of another
 */
function isDescendantOf(potentialDescendant, ancestorId) {
    if (!potentialDescendant) return false;
    const folder = folderData.folders.find(f => f.id === potentialDescendant);
    if (!folder) return false;
    if (folder.parentId === ancestorId) return true;
    return isDescendantOf(folder.parentId, ancestorId);
}

/**
 * Get the folder a list is placed in (null = root)
 */
export function getListFolder(listId) {
    return folderData.listPlacements[listId] || null;
}

/**
 * Place a list in a folder (null = root)
 */
export function setListFolder(listId, folderId) {
    if (folderId === null) {
        delete folderData.listPlacements[listId];
    } else {
        folderData.listPlacements[listId] = folderId;
    }
    saveFolders();
}

/**
 * Get all lists in a specific folder
 */
export function getListsInFolder(folderId) {
    return Object.entries(folderData.listPlacements)
        .filter(([_, folder]) => folder === folderId)
        .map(([listId]) => listId);
}

/**
 * Get lists at root level (not in any folder)
 */
export function getListsAtRoot() {
    const placedListIds = new Set(Object.keys(folderData.listPlacements));
    return userLists.filter(list => !placedListIds.has(list.id) && !placedListIds.has(list.cloudId));
}

/**
 * Reorder folders within the same parent
 */
export function reorderFolders(parentId, orderedIds) {
    orderedIds.forEach((id, index) => {
        const folder = folderData.folders.find(f => f.id === id);
        if (folder && folder.parentId === parentId) {
            folder.position = index;
        }
    });
    saveFolders();
}

// Load folders on module initialization
loadFolders();

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
let editListBtnEl = null;
let selectListBtnEl = null;

// Callbacks (set by init)
let renderResultsFn = null;
let closeSidebarFn = null;
let pushHistoryStateFn = null;

// Followed lists (from cloud) - separate from owned lists
let followedLists = [];

// Note: Result picker now uses unified ListPicker component from list-picker.js

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
 * Migrate old song IDs to new IDs using the id_mapping.json
 * This handles the transition from old slugs (e.g., "manofconstantsorrowlyricsandchords")
 * to new slugs (e.g., "im-a-man-of-constant-sorrow")
 */
async function migrateOldSongIds() {
    const MIGRATION_KEY = 'songbook-ids-migrated-v1';

    // Skip if already migrated
    if (localStorage.getItem(MIGRATION_KEY)) {
        return;
    }

    try {
        // Fetch the ID mapping
        const response = await fetch('data/id_mapping.json');
        if (!response.ok) {
            console.log('[migrateOldSongIds] No id_mapping.json found, skipping migration');
            return;
        }

        const idMapping = await response.json();
        let totalMigrated = 0;

        // Update all lists
        for (const list of userLists) {
            const newSongs = list.songs.map(oldId => {
                const newId = idMapping[oldId];
                if (newId && newId !== oldId) {
                    totalMigrated++;
                    return newId;
                }
                return oldId;
            });
            list.songs = newSongs;
        }

        if (totalMigrated > 0) {
            console.log(`[migrateOldSongIds] Migrated ${totalMigrated} song IDs to new format`);
            saveLists();

            // Re-render if we're currently viewing favorites
            if (viewingListId === FAVORITES_LIST_ID) {
                showFavorites();
            }
        }

        // Mark migration as complete
        localStorage.setItem(MIGRATION_KEY, 'true');
    } catch (e) {
        console.error('[migrateOldSongIds] Migration failed:', e);
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
                    // Update folder placement key before assigning cloudId
                    // (placement was stored under local id, needs to move to cloudId)
                    const currentFolder = getListFolder(list.id);
                    if (currentFolder !== null) {
                        delete folderData.listPlacements[list.id];
                        folderData.listPlacements[data.id] = currentFolder;
                        saveFolders();
                    }
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

        // Also load followed lists
        await loadFollowedLists();

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
 * Load followed lists from cloud
 */
export async function loadFollowedLists() {
    if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
        followedLists = [];
        return;
    }

    try {
        const { data, error } = await SupabaseAuth.fetchFollowedLists();
        if (error) {
            console.error('Error loading followed lists:', error);
            followedLists = [];
        } else {
            followedLists = data || [];
        }
        renderSidebarLists();
    } catch (err) {
        console.error('Error loading followed lists:', err);
        followedLists = [];
    }
}

/**
 * Get followed lists (for external access)
 */
export function getFollowedLists() {
    return followedLists;
}

/**
 * Render lists in sidebar
 */
// Track expanded folders state
let expandedFolders = new Set(JSON.parse(localStorage.getItem('songbook-expanded-folders') || '[]'));

// Track inline editing state
let editingNewFolder = null;  // { parentId: string|null } if creating new folder
let editingFolderId = null;   // folder id being renamed

function saveExpandedFolders() {
    localStorage.setItem('songbook-expanded-folders', JSON.stringify([...expandedFolders]));
}

function toggleFolderExpanded(folderId) {
    if (expandedFolders.has(folderId)) {
        expandedFolders.delete(folderId);
    } else {
        expandedFolders.add(folderId);
    }
    saveExpandedFolders();
    renderSidebarLists();
}

export function renderSidebarLists() {
    if (!navListsContainerEl) return;
    navListsContainerEl.innerHTML = '';

    // Exclude Favorites list - it has its own nav button
    const customLists = userLists.filter(l => l.id !== FAVORITES_LIST_ID);
    const rootFolders = getFoldersAtLevel(null);
    const hasContent = customLists.length > 0 || rootFolders.length > 0;

    // Always show "My Lists" section if user is signed in or has content
    // This ensures the folder creation UI is always accessible
    const isSignedIn = typeof SupabaseAuth !== 'undefined' && SupabaseAuth.isLoggedIn?.();
    const showMyListsSection = hasContent || isSignedIn;

    // Create "My Lists" section
    if (showMyListsSection) {
        const header = document.createElement('div');
        header.className = 'nav-section-header';
        header.innerHTML = `
            <span>My Lists</span>
            <div class="nav-section-actions">
                <button class="nav-section-action" title="New list" data-action="new-list">+</button>
                <button class="nav-section-action" title="New folder" data-action="new-folder">&#128193;</button>
            </div>
        `;
        navListsContainerEl.appendChild(header);

        // Make header a drop target for moving lists to root
        setupFolderDropTarget(header, null);

        // Render folders and their contents recursively
        renderFoldersAndLists(navListsContainerEl, null, 0);
    }

    // Create "Following" section if there are followed lists
    if (followedLists.length > 0) {
        const header = document.createElement('div');
        header.className = 'nav-section-header';
        header.textContent = 'Following';
        navListsContainerEl.appendChild(header);

        followedLists.forEach(list => {
            const btn = document.createElement('button');
            const isOrphaned = list.isOrphaned || !!list.orphaned_at;
            btn.className = 'nav-item nav-item-followed' +
                (viewingListId === list.id ? ' active' : '') +
                (isOrphaned ? ' nav-item-orphaned' : '');
            btn.dataset.listId = list.id;
            btn.dataset.isFollowed = 'true';
            btn.innerHTML = `
                <span class="nav-icon">${isOrphaned ? '&#9888;' : '&#128279;'}</span>
                <span class="nav-label">${escapeHtml(list.name)}</span>
                ${list.songs?.length > 0 ? `<span class="nav-badge">${list.songs.length}</span>` : ''}
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

    // Add new list button event handler
    const newListBtn = navListsContainerEl.querySelector('[data-action="new-list"]');
    newListBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        startCreateList(null);
    });

    // Add new folder button event handler
    const newFolderBtn = navListsContainerEl.querySelector('[data-action="new-folder"]');
    newFolderBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        startCreateFolder(null);
    });
}

/**
 * Render folders and lists recursively
 */
function renderFoldersAndLists(container, parentId, depth) {
    const folders = getFoldersAtLevel(parentId);
    const listsInThisFolder = parentId === null
        ? getListsAtRoot()
        : userLists.filter(l => {
            const listId = l.cloudId || l.id;
            return getListFolder(listId) === parentId;
        });

    // Render "new folder" input if we're creating at this level
    if (editingNewFolder && editingNewFolder.parentId === parentId) {
        const newFolderEl = document.createElement('div');
        newFolderEl.className = 'nav-folder nav-folder-editing';
        newFolderEl.style.paddingLeft = `${depth * 0.75}rem`;

        const headerEl = document.createElement('div');
        headerEl.className = 'nav-item nav-folder-header';
        headerEl.innerHTML = `
            <span class="nav-folder-arrow">▶</span>
            <span class="nav-icon">&#128193;</span>
        `;

        const input = createInlineInput('', commitNewFolder, cancelNewFolder);
        headerEl.appendChild(input);
        newFolderEl.appendChild(headerEl);
        container.appendChild(newFolderEl);
    }

    // Render folders
    folders.forEach(folder => {
        const isExpanded = expandedFolders.has(folder.id);
        const isEditing = editingFolderId === folder.id;
        const folderEl = document.createElement('div');
        folderEl.className = 'nav-folder';
        folderEl.dataset.folderId = folder.id;
        folderEl.style.paddingLeft = `${depth * 0.75}rem`;

        const headerBtn = document.createElement('button');
        headerBtn.className = 'nav-item nav-folder-header';

        if (isEditing) {
            // Render with inline input for renaming
            headerBtn.innerHTML = `
                <span class="nav-folder-arrow">${isExpanded ? '▼' : '▶'}</span>
                <span class="nav-icon">&#128193;</span>
            `;
            const input = createInlineInput(
                folder.name,
                (newName) => commitRenameFolder(folder.id, newName),
                cancelRenameFolder
            );
            headerBtn.appendChild(input);
            // Don't toggle on click when editing
        } else {
            // Normal folder rendering
            headerBtn.innerHTML = `
                <span class="nav-folder-arrow">${isExpanded ? '▼' : '▶'}</span>
                <span class="nav-icon">&#128193;</span>
                <span class="nav-label">${escapeHtml(folder.name)}</span>
            `;
            headerBtn.addEventListener('click', () => toggleFolderExpanded(folder.id));

            // Add context menu on right-click
            headerBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showFolderContextMenu(folder, e.clientX, e.clientY);
            });

            // Set up folder as drop target for lists
            setupFolderDropTarget(headerBtn, folder.id);
        }

        folderEl.appendChild(headerBtn);

        // Render contents if expanded
        if (isExpanded) {
            const contentEl = document.createElement('div');
            contentEl.className = 'nav-folder-content';
            renderFoldersAndLists(contentEl, folder.id, depth + 1);
            folderEl.appendChild(contentEl);
        }

        container.appendChild(folderEl);
    });

    // Render lists at this level
    listsInThisFolder.forEach(list => {
        if (list.id === FAVORITES_LIST_ID) return;

        const isEditing = editingListId === list.id;
        const btn = document.createElement('button');
        btn.className = 'nav-item' + (viewingListId === list.id ? ' active' : '') + (isEditing ? ' nav-item-editing' : '');
        btn.dataset.listId = list.id;
        btn.style.paddingLeft = `${(depth * 0.75) + 1.5}rem`;

        if (isEditing) {
            // Render with inline input for renaming
            btn.innerHTML = `<span class="nav-icon">&#9776;</span>`;
            const input = createInlineInput(
                list.name,
                (newName) => commitRenameList(list.id, newName),
                cancelRenameList,
                'List name'
            );
            btn.appendChild(input);
        } else {
            // Normal rendering
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

            // Add context menu on right-click
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showListContextMenu(list, e.clientX, e.clientY);
            });

            // Make list draggable
            btn.draggable = true;
            btn.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    type: 'list',
                    listId: list.cloudId || list.id
                }));
                btn.classList.add('dragging');
            });
            btn.addEventListener('dragend', () => {
                btn.classList.remove('dragging');
                clearDropTargets();
            });
        }

        container.appendChild(btn);
    });

    // Render "new list" input if we're creating at this level
    if (creatingNewList && creatingNewList.folderId === parentId) {
        const newListEl = document.createElement('button');
        newListEl.className = 'nav-item nav-item-editing';
        newListEl.style.paddingLeft = `${(depth * 0.75) + 1.5}rem`;
        newListEl.innerHTML = `<span class="nav-icon">&#9776;</span>`;

        const input = createInlineInput('', commitNewList, cancelNewList, 'List name');
        newListEl.appendChild(input);
        container.appendChild(newListEl);
    }
}

/**
 * Clear all drop target highlights
 */
function clearDropTargets() {
    document.querySelectorAll('.drop-target').forEach(el => {
        el.classList.remove('drop-target');
    });
}

/**
 * Set up folder as a drop target
 */
function setupFolderDropTarget(element, folderId) {
    element.addEventListener('dragover', (e) => {
        e.preventDefault();
        element.classList.add('drop-target');
    });

    element.addEventListener('dragleave', (e) => {
        // Only remove if leaving the element entirely
        if (!element.contains(e.relatedTarget)) {
            element.classList.remove('drop-target');
        }
    });

    element.addEventListener('drop', (e) => {
        e.preventDefault();
        element.classList.remove('drop-target');

        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.type === 'list') {
                setListFolder(data.listId, folderId);
                renderSidebarLists();
            }
        } catch (err) {
            console.error('Drop error:', err);
        }
    });
}

/**
 * Start inline folder creation
 */
function startCreateFolder(parentId = null) {
    editingNewFolder = { parentId };
    // If creating in a folder, expand it
    if (parentId) {
        expandedFolders.add(parentId);
        saveExpandedFolders();
    }
    renderSidebarLists();
}

/**
 * Commit the new folder (called from input handlers)
 */
function commitNewFolder(name) {
    if (name && name.trim() && editingNewFolder) {
        createFolder(name.trim(), editingNewFolder.parentId);
    }
    editingNewFolder = null;
    renderSidebarLists();
}

/**
 * Cancel new folder creation
 */
function cancelNewFolder() {
    editingNewFolder = null;
    renderSidebarLists();
}

/**
 * Start inline folder rename
 */
function startRenameFolder(folderId) {
    editingFolderId = folderId;
    renderSidebarLists();
}

/**
 * Commit folder rename
 */
function commitRenameFolder(folderId, newName) {
    if (newName && newName.trim()) {
        renameFolder(folderId, newName.trim());
    }
    editingFolderId = null;
    renderSidebarLists();
}

/**
 * Cancel folder rename
 */
function cancelRenameFolder() {
    editingFolderId = null;
    renderSidebarLists();
}

// ============================================
// LIST INLINE EDITING
// ============================================

let editingListId = null;  // list id being renamed

/**
 * Start inline list rename
 */
function startRenameList(listId) {
    editingListId = listId;
    renderSidebarLists();
}

/**
 * Commit list rename
 */
function commitRenameList(listId, newName) {
    if (newName && newName.trim()) {
        renameList(listId, newName.trim());
    }
    editingListId = null;
    renderSidebarLists();
}

/**
 * Cancel list rename
 */
function cancelRenameList() {
    editingListId = null;
    renderSidebarLists();
}

// Track new list creation state
let creatingNewList = null;  // { folderId: string|null } if creating new list

/**
 * Start inline list creation
 */
function startCreateList(folderId = null) {
    creatingNewList = { folderId };
    // If creating in a folder, expand it
    if (folderId) {
        expandedFolders.add(folderId);
        saveExpandedFolders();
    }
    renderSidebarLists();
}

/**
 * Commit the new list (called from input handlers)
 */
function commitNewList(name) {
    if (name && name.trim() && creatingNewList) {
        const list = createList(name.trim());
        if (list && creatingNewList.folderId) {
            setListFolder(list.id, creatingNewList.folderId);
        }
    }
    creatingNewList = null;
    renderSidebarLists();
}

/**
 * Cancel new list creation
 */
function cancelNewList() {
    creatingNewList = null;
    renderSidebarLists();
}

/**
 * Show context menu for a list
 */
function showListContextMenu(list, x, y) {
    // Remove any existing context menu
    const existing = document.querySelector('.list-context-menu');
    if (existing) existing.remove();

    // Also close folder context menu if open
    const folderMenu = document.querySelector('.folder-context-menu');
    if (folderMenu) folderMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'list-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // Don't allow deleting favorites
    const isFavorites = list.id === FAVORITES_LIST_ID;

    menu.innerHTML = `
        <button data-action="rename">Rename</button>
        ${!isFavorites ? '<button data-action="delete" class="danger">Delete</button>' : ''}
    `;

    menu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'rename') {
            startRenameList(list.id);
        } else if (action === 'delete') {
            if (confirm(`Delete "${list.name}"? Songs won't be deleted from the songbook.`)) {
                deleteList(list.id);
                renderSidebarLists();
            }
        }
        menu.remove();
    });

    document.body.appendChild(menu);

    // Close on outside click
    const closeHandler = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

/**
 * Create an inline input element for name editing (folders, lists, etc.)
 * Reusable component - just pass different callbacks for different contexts.
 */
function createInlineInput(initialValue, onCommit, onCancel, placeholder = 'Name') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'nav-inline-input';
    input.value = initialValue;
    input.placeholder = placeholder;

    // Handle Enter/Escape
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(input.value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    });

    // Handle blur (commit if has value, cancel if empty)
    input.addEventListener('blur', () => {
        // Use setTimeout to allow click events on other elements to fire first
        setTimeout(() => {
            if (input.value.trim()) {
                onCommit(input.value);
            } else {
                onCancel();
            }
        }, 100);
    });

    // Auto-focus after adding to DOM
    setTimeout(() => {
        input.focus();
        input.select();
    }, 0);

    return input;
}

/**
 * Show context menu for a folder
 */
function showFolderContextMenu(folder, x, y) {
    // Remove any existing context menu
    const existing = document.querySelector('.folder-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'folder-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.innerHTML = `
        <button data-action="rename">Rename</button>
        <button data-action="new-list">New List Here</button>
        <button data-action="new-subfolder">New Subfolder</button>
        <button data-action="delete" class="danger">Delete</button>
    `;

    menu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'rename') {
            startRenameFolder(folder.id);
        } else if (action === 'new-list') {
            startCreateList(folder.id);
        } else if (action === 'new-subfolder') {
            startCreateFolder(folder.id);
        } else if (action === 'delete') {
            if (confirm(`Delete folder "${folder.name}"? Lists will be moved out.`)) {
                deleteFolder(folder.id);
                renderSidebarLists();
            }
        }
        menu.remove();
    });

    document.body.appendChild(menu);

    // Close on outside click
    const closeHandler = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
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

    // First check if this is a local (owned) list
    const localList = userLists.find(l => l.id === listId);

    if (localList) {
        // It's a local list - show it normally as owner
        setViewingListId(listId);
        setViewingPublicList(null);
        renderListViewUI(localList.name, localList.songs, {
            isOwner: true,
            isFollower: false,
            isOrphaned: false
        });
        return;
    }

    // Check if this is a followed list
    const followedList = followedLists.find(l => l.id === listId);
    if (followedList) {
        setViewingListId(listId);
        setViewingPublicList({
            list: followedList,
            songs: followedList.songs || [],
            isOwner: false,
            isFollower: true,
            isOrphaned: followedList.isOrphaned || !!followedList.orphaned_at
        });
        renderListViewUI(followedList.name, followedList.songs || [], {
            isOwner: false,
            isFollower: true,
            isOrphaned: followedList.isOrphaned || !!followedList.orphaned_at,
            canClaim: followedList.isOrphaned || !!followedList.orphaned_at
        });
        return;
    }

    // Not a local or followed list - try to fetch as a public list
    if (typeof SupabaseAuth === 'undefined') {
        showListNotFound();
        return;
    }

    const { data, error } = await SupabaseAuth.fetchPublicList(listId);
    if (error || !data || !data.list) {
        showListNotFound();
        return;
    }

    // Check ownership status from the response
    const isOwner = data.is_owner || false;
    const isFollower = data.is_follower || false;
    const isOrphaned = data.is_orphaned || false;
    const canClaim = data.can_claim || false;

    setViewingListId(listId);
    setViewingPublicList({
        list: data.list,
        songs: data.songs,
        isOwner,
        isFollower,
        isOrphaned,
        canClaim
    });

    renderListViewUI(data.list.name, data.songs, {
        isOwner,
        isFollower,
        isOrphaned,
        canClaim
    });
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

    // Show search container/results, hide landing page
    const searchContainer = document.querySelector('.search-container');
    const editorPanel = document.getElementById('editor-panel');
    const landingPage = document.getElementById('landing-page');
    if (landingPage) landingPage.classList.add('hidden');
    if (searchContainer) searchContainer.classList.remove('hidden');
    if (resultsDivEl) resultsDivEl.classList.remove('hidden');
    if (editorPanel) editorPanel.classList.add('hidden');
    if (songViewEl) songViewEl.classList.add('hidden');
    if (printListBtnEl) printListBtnEl.classList.add('hidden');
}

/**
 * Render the list view UI (shared by local and public lists)
 * @param {string} listName - Display name of the list
 * @param {string[]} songIds - Array of song IDs in the list
 * @param {Object|boolean} status - Ownership status (or boolean for backwards compat)
 * @param {boolean} status.isOwner - User is an owner of this list
 * @param {boolean} status.isFollower - User follows this list
 * @param {boolean} status.isOrphaned - List has no owners (Thunderdome mode)
 * @param {boolean} status.canClaim - User can claim this orphaned list
 */
function renderListViewUI(listName, songIds, status) {
    // Backwards compatibility: if status is a boolean, convert to object
    const ownership = typeof status === 'boolean'
        ? { isOwner: status, isFollower: false, isOrphaned: false, canClaim: false }
        : status;

    if (closeSidebarFn) closeSidebarFn();

    // Update nav active states
    if (navSearchEl) navSearchEl.classList.remove('active');
    if (navFavoritesEl) navFavoritesEl.classList.remove('active');
    if (navAddSongEl) navAddSongEl.classList.remove('active');

    // Update sidebar list buttons
    if (navListsContainerEl) {
        navListsContainerEl.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.listId === viewingListId);
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

    // Build status text with ownership badge
    let statusHtml = `${escapeHtml(listName)}: ${listSongs.length} song${listSongs.length !== 1 ? 's' : ''}`;
    if (ownership.isOrphaned) {
        statusHtml += ' <span class="list-badge list-badge-orphaned">Needs Owner</span>';
    } else if (ownership.isFollower && !ownership.isOwner) {
        statusHtml += ' <span class="list-badge list-badge-following">Following</span>';
    } else if (!ownership.isOwner && viewingPublicList) {
        statusHtml += ' <span class="list-badge list-badge-shared">Shared List</span>';
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

    // Show search container/results, hide landing page
    const searchContainer = document.querySelector('.search-container');
    const editorPanel = document.getElementById('editor-panel');
    const landingPage = document.getElementById('landing-page');
    if (landingPage) landingPage.classList.add('hidden');
    if (searchContainer) searchContainer.classList.remove('hidden');
    if (resultsDivEl) resultsDivEl.classList.remove('hidden');
    if (editorPanel) editorPanel.classList.add('hidden');
    if (songViewEl) songViewEl.classList.add('hidden');

    // Show action buttons
    if (printListBtnEl) printListBtnEl.classList.remove('hidden');
    if (shareListBtnEl && ownership.isOwner) shareListBtnEl.classList.remove('hidden');

    // Duplicate/Import/Copy button
    const duplicateListBtn = document.getElementById('duplicate-list-btn');
    if (duplicateListBtn) {
        if (ownership.isOwner) {
            duplicateListBtn.textContent = 'Duplicate';
            duplicateListBtn.classList.remove('hidden');
        } else {
            // "Copy to My Lists" for non-owners (safety valve)
            duplicateListBtn.textContent = 'Copy to My Lists';
            duplicateListBtn.classList.remove('hidden');
        }
    }

    // Follow/Unfollow button
    const followListBtn = document.getElementById('follow-list-btn');
    if (followListBtn) {
        if (!ownership.isOwner && viewingListId) {
            if (ownership.isFollower) {
                followListBtn.textContent = 'Unfollow';
                followListBtn.classList.remove('hidden');
            } else {
                followListBtn.textContent = 'Follow';
                followListBtn.classList.remove('hidden');
            }
        } else {
            followListBtn.classList.add('hidden');
        }
    }

    // Claim button (for orphaned lists)
    const claimListBtn = document.getElementById('claim-list-btn');
    if (claimListBtn) {
        if (ownership.canClaim && ownership.isOrphaned) {
            claimListBtn.classList.remove('hidden');
        } else {
            claimListBtn.classList.add('hidden');
        }
    }

    // Show delete button for own lists (but not favorites)
    const deleteListBtn = document.getElementById('delete-list-btn');
    if (deleteListBtn) {
        if (ownership.isOwner && viewingListId !== FAVORITES_LIST_ID && viewingListId !== 'favorites') {
            deleteListBtn.classList.remove('hidden');
        } else {
            deleteListBtn.classList.add('hidden');
        }
    }

    // Show edit button for own lists (allows removing songs)
    if (editListBtnEl) {
        if (ownership.isOwner) {
            editListBtnEl.classList.remove('hidden');
            // Update button text based on current edit mode
            editListBtnEl.textContent = listEditMode ? 'Done' : 'Edit';
        } else {
            editListBtnEl.classList.add('hidden');
        }
    }

    // Show select button for own lists (allows multi-select batch operations)
    if (selectListBtnEl) {
        if (ownership.isOwner) {
            selectListBtnEl.classList.remove('hidden');
            // Update button text based on current select mode
            selectListBtnEl.textContent = multiSelectMode ? 'Done' : 'Select';
        } else {
            selectListBtnEl.classList.add('hidden');
        }
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
    const followListBtn = document.getElementById('follow-list-btn');
    if (followListBtn) followListBtn.classList.add('hidden');
    const claimListBtn = document.getElementById('claim-list-btn');
    if (claimListBtn) claimListBtn.classList.add('hidden');
    // Reset edit mode when leaving list view
    if (editListBtnEl) {
        editListBtnEl.classList.add('hidden');
        editListBtnEl.textContent = 'Edit';
    }
    setListEditMode(false);
    // Reset multi-select mode when leaving list view
    if (selectListBtnEl) {
        selectListBtnEl.classList.add('hidden');
        selectListBtnEl.textContent = 'Select';
    }
    setMultiSelectMode(false);
    clearSelectedSongs();
    hideBatchOperationsBar();
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
 * Delegates to unified ListPicker component
 */
export function showResultListPicker(btn, songId) {
    const song = allSongs.find(s => s.id === songId);
    if (!song) return;

    showListPicker(songId, btn, {
        onUpdate: () => updateResultListButton(btn, songId)
    });
}

/**
 * Close floating result list picker
 * Delegates to unified ListPicker component
 */
export function closeResultListPicker() {
    closeListPicker();
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
    editListBtnEl = document.getElementById('edit-list-btn');
    selectListBtnEl = document.getElementById('select-list-btn');
    renderResultsFn = renderResults;
    closeSidebarFn = closeSidebar;
    pushHistoryStateFn = pushHistoryState;

    // Edit list button - toggle edit mode (show remove buttons)
    editListBtnEl?.addEventListener('click', () => {
        const newEditMode = !listEditMode;
        setListEditMode(newEditMode);
        // Exit multi-select mode when entering edit mode
        if (newEditMode && multiSelectMode) {
            setMultiSelectMode(false);
            clearSelectedSongs();
            if (selectListBtnEl) selectListBtnEl.textContent = 'Select';
        }
        // Update button text
        if (editListBtnEl) {
            editListBtnEl.textContent = newEditMode ? 'Done' : 'Edit';
        }
        // Re-render results to show/hide remove buttons
        if (viewingListId) {
            showListView(viewingListId);
        }
    });

    // Select list button - toggle multi-select mode (show checkboxes)
    selectListBtnEl?.addEventListener('click', () => {
        const newSelectMode = !multiSelectMode;
        setMultiSelectMode(newSelectMode);
        // Exit edit mode when entering select mode
        if (newSelectMode && listEditMode) {
            setListEditMode(false);
            if (editListBtnEl) editListBtnEl.textContent = 'Edit';
        }
        // Clear selections and hide batch bar when exiting select mode
        if (!newSelectMode) {
            clearSelectedSongs();
            hideBatchOperationsBar();
        }
        // Update button text
        if (selectListBtnEl) {
            selectListBtnEl.textContent = newSelectMode ? 'Done' : 'Select';
        }
        // Re-render results to show/hide checkboxes
        if (viewingListId) {
            showListView(viewingListId);
        }
    });

    // Share list button - opens share modal
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

        openShareModal(shareId);
    });

    // Initialize share modal handlers
    initShareModal();

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

    // Follow/Unfollow list button
    const followListBtn = document.getElementById('follow-list-btn');
    followListBtn?.addEventListener('click', async () => {
        if (!viewingListId || typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
            alert('Please sign in to follow lists');
            return;
        }

        const isCurrentlyFollowing = viewingPublicList?.isFollower || followedLists.some(l => l.id === viewingListId);

        if (isCurrentlyFollowing) {
            // Unfollow
            const { error } = await SupabaseAuth.unfollowList(viewingListId);
            if (error) {
                alert('Failed to unfollow list');
                return;
            }
            // Remove from local followedLists
            followedLists = followedLists.filter(l => l.id !== viewingListId);
            renderSidebarLists();
            // Update button text
            followListBtn.textContent = 'Follow';
            if (viewingPublicList) {
                viewingPublicList.isFollower = false;
            }
        } else {
            // Follow
            const { error } = await SupabaseAuth.followList(viewingListId);
            if (error) {
                alert('Failed to follow list');
                return;
            }
            // Reload followed lists to get the full data
            await loadFollowedLists();
            // Update button text
            followListBtn.textContent = 'Unfollow';
            if (viewingPublicList) {
                viewingPublicList.isFollower = true;
            }
        }
    });

    // Claim orphaned list button (Thunderdome!)
    const claimListBtn = document.getElementById('claim-list-btn');
    claimListBtn?.addEventListener('click', async () => {
        if (!viewingListId || typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
            alert('Please sign in to claim lists');
            return;
        }

        if (!confirm('Claim ownership of this list? You will become the sole owner.')) {
            return;
        }

        const { data, error } = await SupabaseAuth.claimOrphanedList(viewingListId);
        if (error) {
            alert(error.message || 'Failed to claim list');
            return;
        }

        // Success! Reload lists to reflect new ownership
        await performFullListsSync();
        // Re-show the list (now as owner)
        showListView(viewingListId);
    });

    // Load from localStorage
    loadLists();

    // Migrate old favorites format to new list-based format
    migrateOldFavorites();

    // Migrate old song IDs to new IDs (from works migration)
    migrateOldSongIds();

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

    // Note: Result picker click-outside handling is now managed by unified ListPicker
}

// ============================================
// SHARE MODAL
// ============================================

let currentShareListId = null;

function openShareModal(shareId) {
    currentShareListId = shareId;

    const modal = document.getElementById('share-modal');
    const backdrop = document.getElementById('share-modal-backdrop');
    const viewLinkInput = document.getElementById('share-view-link');
    const inviteSection = document.getElementById('share-invite-section');
    const inviteActions = document.getElementById('share-invite-actions');
    const inviteLinkRow = document.getElementById('share-invite-link-row');
    const inviteExpiry = document.getElementById('share-invite-expiry');

    if (!modal || !backdrop) return;

    // Set the view link
    const shareUrl = `${window.location.origin}${window.location.pathname}#list/${shareId}`;
    if (viewLinkInput) viewLinkInput.value = shareUrl;

    // Determine if user is owner (can generate invites)
    const isOwner = viewingPublicList?.isOwner ||
        userLists.some(l => l.cloudId === shareId || l.id === shareId) ||
        (viewingListId === 'favorites' || viewingListId === FAVORITES_LIST_ID);

    // Show/hide invite section based on ownership
    if (inviteSection) {
        inviteSection.classList.toggle('hidden', !isOwner);
    }

    // Reset invite state
    if (inviteActions) inviteActions.classList.remove('hidden');
    if (inviteLinkRow) inviteLinkRow.classList.add('hidden');
    if (inviteExpiry) inviteExpiry.classList.add('hidden');

    // Show modal
    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
}

function closeShareModal() {
    const modal = document.getElementById('share-modal');
    const backdrop = document.getElementById('share-modal-backdrop');

    if (modal) modal.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
    currentShareListId = null;
}

function initShareModal() {
    const backdrop = document.getElementById('share-modal-backdrop');
    const closeBtn = document.getElementById('share-modal-close');
    const copyLinkBtn = document.getElementById('share-copy-link');
    const generateInviteBtn = document.getElementById('share-generate-invite');
    const copyInviteBtn = document.getElementById('share-copy-invite');

    // Close on backdrop click or close button
    backdrop?.addEventListener('click', closeShareModal);
    closeBtn?.addEventListener('click', closeShareModal);

    // Copy view link
    copyLinkBtn?.addEventListener('click', async () => {
        const viewLinkInput = document.getElementById('share-view-link');
        if (!viewLinkInput) return;

        try {
            await navigator.clipboard.writeText(viewLinkInput.value);
            copyLinkBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyLinkBtn.textContent = 'Copy';
            }, 2000);
        } catch (err) {
            prompt('Copy this link:', viewLinkInput.value);
        }
    });

    // Generate invite link
    generateInviteBtn?.addEventListener('click', async () => {
        if (!currentShareListId) return;

        if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
            alert('Please sign in to generate invite links');
            return;
        }

        generateInviteBtn.disabled = true;
        generateInviteBtn.textContent = 'Generating...';

        try {
            const result = await SupabaseAuth.generateListInvite(currentShareListId);

            if (result.error) {
                alert('Failed to generate invite: ' + result.error);
                generateInviteBtn.disabled = false;
                generateInviteBtn.textContent = 'Generate Invite Link';
                return;
            }

            // Build invite URL
            const inviteUrl = `${window.location.origin}${window.location.pathname}#invite/${result.token}`;

            // Show the invite link
            const inviteActions = document.getElementById('share-invite-actions');
            const inviteLinkRow = document.getElementById('share-invite-link-row');
            const inviteLinkInput = document.getElementById('share-invite-link');
            const inviteExpiry = document.getElementById('share-invite-expiry');

            if (inviteActions) inviteActions.classList.add('hidden');
            if (inviteLinkRow) inviteLinkRow.classList.remove('hidden');
            if (inviteLinkInput) inviteLinkInput.value = inviteUrl;
            if (inviteExpiry) inviteExpiry.classList.remove('hidden');
        } catch (err) {
            console.error('Error generating invite:', err);
            alert('Failed to generate invite link');
            generateInviteBtn.disabled = false;
            generateInviteBtn.textContent = 'Generate Invite Link';
        }
    });

    // Copy invite link
    copyInviteBtn?.addEventListener('click', async () => {
        const inviteLinkInput = document.getElementById('share-invite-link');
        if (!inviteLinkInput) return;

        try {
            await navigator.clipboard.writeText(inviteLinkInput.value);
            copyInviteBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyInviteBtn.textContent = 'Copy';
            }, 2000);
        } catch (err) {
            prompt('Copy this invite link:', inviteLinkInput.value);
        }
    });
}
