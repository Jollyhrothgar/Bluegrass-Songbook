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
    clearSelectedSongs,
    setCurrentView,
    subscribe, currentView,
    focusedListId, setFocusedListId
} from './state.js';
import { openSong } from './song-view.js';
import { escapeHtml, generateLocalId, requireLogin } from './utils.js';
import { openAddSongPicker } from './add-song-picker.js';
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
// UNDO/REDO SYSTEM
// ============================================
// Action history for list operations with undo/redo support

const MAX_UNDO_HISTORY = 50;
let undoStack = [];
let redoStack = [];
let undoToastEl = null;
let undoToastTimeout = null;

/**
 * Action types that can be undone/redone
 */
const ActionType = {
    ADD_SONG: 'add_song',
    REMOVE_SONG: 'remove_song',
    REORDER_SONG: 'reorder_song',
    MOVE_SONG: 'move_song',
    COPY_SONG: 'copy_song',
    CREATE_LIST: 'create_list',
    DELETE_LIST: 'delete_list',
    RENAME_LIST: 'rename_list',
    REORDER_LIST: 'reorder_list'
};

/**
 * Record an action for undo
 * @param {string} type - ActionType
 * @param {object} data - Data needed to undo/redo the action
 * @param {string} description - Human-readable description
 */
function recordAction(type, data, description) {
    undoStack.push({ type, data, description, timestamp: Date.now() });
    if (undoStack.length > MAX_UNDO_HISTORY) {
        undoStack.shift();
    }
    // Clear redo stack when a new action is recorded
    redoStack = [];

    // Show undo toast
    showUndoToast(description);
}

/**
 * Undo the last action
 */
export function undo() {
    if (undoStack.length === 0) return false;

    const action = undoStack.pop();
    const success = executeUndo(action);

    if (success) {
        redoStack.push(action);
        showUndoToast(`Undid: ${action.description}`, true);
        renderManageListsView();
        renderSidebarLists();
        updateFavoritesCount();
        // Refresh current list view if viewing the affected list
        if (viewingListId && action.data?.listId === viewingListId) {
            showListView(viewingListId);
        } else if (viewingListId === 'favorites' && action.data?.listId === FAVORITES_LIST_ID) {
            showFavorites();
        }
    }

    return success;
}

/**
 * Redo the last undone action
 */
export function redo() {
    if (redoStack.length === 0) return false;

    const action = redoStack.pop();
    const success = executeRedo(action);

    if (success) {
        undoStack.push(action);
        showUndoToast(`Redid: ${action.description}`, true);
        renderManageListsView();
        renderSidebarLists();
        updateFavoritesCount();
        // Refresh current list view if viewing the affected list
        if (viewingListId && action.data?.listId === viewingListId) {
            showListView(viewingListId);
        } else if (viewingListId === 'favorites' && action.data?.listId === FAVORITES_LIST_ID) {
            showFavorites();
        }
    }

    return success;
}

/**
 * Execute an undo operation
 */
function executeUndo(action) {
    const { type, data } = action;

    switch (type) {
        case ActionType.ADD_SONG: {
            // Undo add = remove the song
            const list = userLists.find(l => l.id === data.listId);
            if (!list) return false;
            const idx = list.songs.indexOf(data.songId);
            if (idx !== -1) {
                list.songs.splice(idx, 1);
                saveLists();
            }
            return true;
        }

        case ActionType.REMOVE_SONG: {
            // Undo remove = add the song back at original position
            const list = userLists.find(l => l.id === data.listId);
            if (!list) return false;
            list.songs.splice(data.index, 0, data.songId);
            saveLists();
            return true;
        }

        case ActionType.REORDER_SONG: {
            // Undo reorder = move back to original position
            const list = userLists.find(l => l.id === data.listId);
            if (!list) return false;
            const song = list.songs.splice(data.toIndex, 1)[0];
            list.songs.splice(data.fromIndex, 0, song);
            saveLists();
            return true;
        }

        case ActionType.MOVE_SONG: {
            // Undo move = move back to source list
            const destList = userLists.find(l => l.id === data.destListId);
            const srcList = userLists.find(l => l.id === data.sourceListId);
            if (!destList || !srcList) return false;

            const idx = destList.songs.indexOf(data.songId);
            if (idx !== -1) destList.songs.splice(idx, 1);
            srcList.songs.splice(data.sourceIndex, 0, data.songId);
            saveLists();
            return true;
        }

        case ActionType.COPY_SONG: {
            // Undo copy = remove from destination
            const destList = userLists.find(l => l.id === data.destListId);
            if (!destList) return false;
            const idx = destList.songs.indexOf(data.songId);
            if (idx !== -1) destList.songs.splice(idx, 1);
            saveLists();
            return true;
        }

        case ActionType.CREATE_LIST: {
            // Undo create = delete the list
            const idx = userLists.findIndex(l => l.id === data.listId);
            if (idx !== -1) {
                userLists.splice(idx, 1);
                saveLists();
            }
            return true;
        }

        case ActionType.DELETE_LIST: {
            // Undo delete = restore the list at original position
            userLists.splice(data.index, 0, data.list);
            saveLists();
            return true;
        }

        case ActionType.RENAME_LIST: {
            // Undo rename = restore old name
            const list = userLists.find(l => l.id === data.listId);
            if (!list) return false;
            list.name = data.oldName;
            saveLists();
            return true;
        }

        case ActionType.REORDER_LIST: {
            // Undo reorder = swap back
            const temp = userLists[data.toIndex];
            userLists[data.toIndex] = userLists[data.fromIndex];
            userLists[data.fromIndex] = temp;
            saveLists();
            return true;
        }

        default:
            return false;
    }
}

/**
 * Execute a redo operation
 */
function executeRedo(action) {
    const { type, data } = action;

    switch (type) {
        case ActionType.ADD_SONG: {
            const list = userLists.find(l => l.id === data.listId);
            if (!list) return false;
            if (!list.songs.includes(data.songId)) {
                list.songs.push(data.songId);
                saveLists();
            }
            return true;
        }

        case ActionType.REMOVE_SONG: {
            const list = userLists.find(l => l.id === data.listId);
            if (!list) return false;
            const idx = list.songs.indexOf(data.songId);
            if (idx !== -1) {
                list.songs.splice(idx, 1);
                saveLists();
            }
            return true;
        }

        case ActionType.REORDER_SONG: {
            const list = userLists.find(l => l.id === data.listId);
            if (!list) return false;
            const song = list.songs.splice(data.fromIndex, 1)[0];
            list.songs.splice(data.toIndex, 0, song);
            saveLists();
            return true;
        }

        case ActionType.MOVE_SONG: {
            const srcList = userLists.find(l => l.id === data.sourceListId);
            const destList = userLists.find(l => l.id === data.destListId);
            if (!srcList || !destList) return false;

            const idx = srcList.songs.indexOf(data.songId);
            if (idx !== -1) srcList.songs.splice(idx, 1);
            destList.songs.push(data.songId);
            saveLists();
            return true;
        }

        case ActionType.COPY_SONG: {
            const destList = userLists.find(l => l.id === data.destListId);
            if (!destList) return false;
            if (!destList.songs.includes(data.songId)) {
                destList.songs.push(data.songId);
                saveLists();
            }
            return true;
        }

        case ActionType.CREATE_LIST: {
            userLists.splice(data.index, 0, data.list);
            saveLists();
            return true;
        }

        case ActionType.DELETE_LIST: {
            const idx = userLists.findIndex(l => l.id === data.listId);
            if (idx !== -1) {
                userLists.splice(idx, 1);
                saveLists();
            }
            return true;
        }

        case ActionType.RENAME_LIST: {
            const list = userLists.find(l => l.id === data.listId);
            if (!list) return false;
            list.name = data.newName;
            saveLists();
            return true;
        }

        case ActionType.REORDER_LIST: {
            const temp = userLists[data.fromIndex];
            userLists[data.fromIndex] = userLists[data.toIndex];
            userLists[data.toIndex] = temp;
            saveLists();
            return true;
        }

        default:
            return false;
    }
}

/**
 * Show undo toast notification
 */
function showUndoToast(message, isUndoRedo = false) {
    if (!undoToastEl) {
        // Create toast element if it doesn't exist
        undoToastEl = document.createElement('div');
        undoToastEl.className = 'undo-toast';
        undoToastEl.innerHTML = `
            <span class="undo-toast-message"></span>
            <button class="undo-toast-btn">Undo</button>
            <button class="undo-toast-close">×</button>
        `;
        document.body.appendChild(undoToastEl);

        // Wire up undo button
        undoToastEl.querySelector('.undo-toast-btn').addEventListener('click', () => {
            undo();
            hideUndoToast();
        });

        // Wire up close button
        undoToastEl.querySelector('.undo-toast-close').addEventListener('click', hideUndoToast);
    }

    // Update message
    undoToastEl.querySelector('.undo-toast-message').textContent = message;

    // Show/hide undo button based on whether this is feedback from undo/redo
    const undoBtn = undoToastEl.querySelector('.undo-toast-btn');
    undoBtn.style.display = isUndoRedo ? 'none' : 'inline-block';

    // Show toast (use RAF to ensure DOM is ready after any re-renders)
    requestAnimationFrame(() => {
        undoToastEl.classList.remove('hidden');
    });

    // Clear existing timeout
    if (undoToastTimeout) {
        clearTimeout(undoToastTimeout);
    }

    // Auto-hide after 5 seconds
    undoToastTimeout = setTimeout(hideUndoToast, 5000);
}

/**
 * Hide undo toast
 */
function hideUndoToast() {
    if (undoToastEl) {
        undoToastEl.classList.add('hidden');
    }
    if (undoToastTimeout) {
        clearTimeout(undoToastTimeout);
        undoToastTimeout = null;
    }
}

/**
 * Check if undo is available
 */
export function canUndo() {
    return undoStack.length > 0;
}

/**
 * Check if redo is available
 */
export function canRedo() {
    return redoStack.length > 0;
}

/**
 * Set up keyboard shortcuts for undo/redo
 */
export function initUndoKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Cmd+Z (Mac) or Ctrl+Z (Windows/Linux) for undo
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
            // Don't trigger when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            e.preventDefault();
            undo();
        }
        // Cmd+Shift+Z or Ctrl+Shift+Z for redo
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            e.preventDefault();
            redo();
        }
        // Cmd+Y or Ctrl+Y for redo (alternative)
        if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            e.preventDefault();
            redo();
        }
    });
}

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
    const listIds = Object.entries(folderData.listPlacements)
        .filter(([_, folder]) => folder === folderId)
        .map(([listId]) => listId);
    // Return list objects (not IDs) for consistency with getListsAtRoot()
    return userLists.filter(list => listIds.includes(list.id) || listIds.includes(list.cloudId));
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

// New list header elements
let listHeaderEl = null;
let listHeaderNameEl = null;
let listHeaderCountEl = null;
let listHeaderBadgeEl = null;
let listPrintBtnEl = null;
let listShareBtnEl = null;
let listDuplicateBtnEl = null;
let listFollowBtnEl = null;
let listClaimBtnEl = null;
let listDeleteBtnEl = null;
let listRequestBtnEl = null;

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
            songMetadata: {},
            cloudId: null
        };
        // Insert at the beginning so it appears first
        userLists.unshift(favList);
        saveLists();
    }
    // Ensure songMetadata exists (migration for existing lists)
    if (!favList.songMetadata) {
        favList.songMetadata = {};
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
export function toggleFavorite(songId, skipUndo = false) {
    const favList = getOrCreateFavoritesList();
    const index = favList.songs.indexOf(songId);

    if (index === -1) {
        // Add to favorites
        favList.songs.push(songId);
        trackListAction('add_song', FAVORITES_LIST_ID);
    } else {
        // Record for undo before removing
        if (!skipUndo) {
            const song = allSongs.find(s => s.id === songId);
            const songTitle = song?.title || songId;
            recordAction(ActionType.REMOVE_SONG, {
                listId: FAVORITES_LIST_ID,
                songId,
                index
            }, `Removed "${songTitle}" from Favorites`);
        }
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

    // Note: List header buttons are now managed by renderListViewUI
    // The new list header handles all action buttons
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
 * Clean up legacy song IDs in lists (one-time migration)
 * Converts old IDs like 'manofconstantsorrowlyricsandchords' to 'man-of-constant-sorrow'
 */
async function cleanupLegacySongIds() {
    // Check if cleanup already done (version 2 - uses mapping file properly)
    const cleanupDone = localStorage.getItem('songbook-legacy-cleanup-v2');
    if (cleanupDone) return;

    try {
        // Load the legacy ID mapping
        const response = await fetch('data/legacy_id_mapping.json');
        if (!response.ok) {
            console.warn('Legacy ID mapping not found, skipping cleanup');
            return;
        }
        const mapping = await response.json();

        let changed = false;

        // Process each list
        for (const list of userLists) {
            if (!list.songs || list.songs.length === 0) continue;

            // Replace legacy IDs and deduplicate
            const newSongSet = new Set();
            const newSongs = [];

            for (const songId of list.songs) {
                // Map to new ID if it's a legacy ID (check mapping file)
                const newId = mapping[songId] || songId;

                // Only add if not already in the set (deduplication)
                if (!newSongSet.has(newId)) {
                    newSongSet.add(newId);
                    newSongs.push(newId);
                } else if (newId !== songId) {
                    // Was a duplicate caused by having both old and new ID
                    changed = true;
                }
            }

            // Check if songs changed
            if (newSongs.length !== list.songs.length ||
                newSongs.some((id, i) => id !== list.songs[i])) {
                list.songs = newSongs;
                changed = true;
            }
        }

        if (changed) {
            saveLists();
            console.log('Cleaned up legacy song IDs in lists');
        }

        localStorage.setItem('songbook-legacy-cleanup-v2', '1');
    } catch (e) {
        console.error('Failed to cleanup legacy song IDs:', e);
    }
}

// Cache the legacy ID mapping to avoid repeated fetches
let legacyIdMappingCache = null;

/**
 * Clean legacy song IDs from a list of lists (used after sync merge)
 * Returns the cleaned lists array
 */
async function cleanLegacyIdsFromLists(lists) {
    try {
        // Load mapping if not cached
        if (!legacyIdMappingCache) {
            const response = await fetch('data/legacy_id_mapping.json');
            if (!response.ok) return lists;
            legacyIdMappingCache = await response.json();
        }
        const mapping = legacyIdMappingCache;

        let anyChanged = false;

        for (const list of lists) {
            if (!list.songs || list.songs.length === 0) continue;

            const seen = new Set();
            const cleanSongs = [];

            for (const songId of list.songs) {
                const newId = mapping[songId] || songId;
                if (!seen.has(newId)) {
                    seen.add(newId);
                    cleanSongs.push(newId);
                }
            }

            if (cleanSongs.length !== list.songs.length) {
                list.songs = cleanSongs;
                anyChanged = true;
            }
        }

        if (anyChanged) {
            console.log('Cleaned legacy song IDs after sync merge');
        }

        return lists;
    } catch (e) {
        console.error('Failed to clean legacy IDs from lists:', e);
        return lists;
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
    } catch (e) {
        console.error('Failed to migrate old favorites:', e);
    }
}

/**
 * Create a new list
 */
export function createList(name, skipUndo = false) {
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
        songMetadata: {},
        cloudId: null
    };

    const insertIndex = userLists.length;
    userLists.push(newList);
    saveLists();
    trackListAction('create', newList.id);

    // Record for undo after creating
    if (!skipUndo) {
        recordAction(ActionType.CREATE_LIST, {
            listId: newList.id,
            list: { ...newList },
            index: insertIndex
        }, `Created list "${trimmed}"`);
    }

    // Sync to cloud if logged in
    syncListToCloud(newList, 'create');

    return newList;
}

/**
 * Rename a list
 */
export function renameList(listId, newName, skipUndo = false) {
    const trimmed = newName.trim();
    if (!trimmed) return false;

    const list = userLists.find(l => l.id === listId);
    if (!list) return false;

    // Check for duplicate names
    if (userLists.some(l => l.id !== listId && l.name.toLowerCase() === trimmed.toLowerCase())) {
        return false;
    }

    const oldName = list.name;

    // Record for undo before renaming
    if (!skipUndo) {
        recordAction(ActionType.RENAME_LIST, {
            listId,
            oldName,
            newName: trimmed
        }, `Renamed "${oldName}" to "${trimmed}"`);
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
export async function deleteList(listId, skipUndo = false) {
    const index = userLists.findIndex(l => l.id === listId);
    if (index === -1) return false;

    const list = userLists[index];

    // Record for undo before deleting (deep copy the list)
    if (!skipUndo) {
        recordAction(ActionType.DELETE_LIST, {
            listId,
            list: JSON.parse(JSON.stringify(list)),
            index
        }, `Deleted list "${list.name}"`);
    }

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
 * Reorder a list by moving it up or down in the list
 * @param {string} listId - The list to move
 * @param {string} direction - 'up' or 'down'
 * @param {boolean} skipUndo - Skip recording for undo
 * @returns {boolean} - True if moved successfully
 */
export function reorderList(listId, direction, skipUndo = false) {
    const index = userLists.findIndex(l => l.id === listId);
    if (index === -1) return false;

    const newIndex = direction === 'up' ? index - 1 : index + 1;

    // Check bounds
    if (newIndex < 0 || newIndex >= userLists.length) return false;

    const list = userLists[index];

    // Record for undo before reordering
    if (!skipUndo) {
        recordAction(ActionType.REORDER_LIST, {
            listId,
            fromIndex: index,
            toIndex: newIndex
        }, `Moved "${list.name}" ${direction}`);
    }

    // Swap the lists
    const temp = userLists[index];
    userLists[index] = userLists[newIndex];
    userLists[newIndex] = temp;

    saveLists();
    return true;
}

/**
 * Add a song to a list (with optional metadata)
 * @param {string} listId - The list ID
 * @param {string} songId - The song ID
 * @param {boolean} skipUndo - Skip undo recording
 * @param {object|null} metadata - Optional metadata to include
 */
export function addSongToList(listId, songId, skipUndo = false, metadata = null) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return false;

    // Ensure songMetadata exists
    if (!list.songMetadata) {
        list.songMetadata = {};
    }

    if (!list.songs.includes(songId)) {
        // Record for undo before adding
        if (!skipUndo) {
            const song = allSongs.find(s => s.id === songId);
            const songTitle = song?.title || songId;
            recordAction(ActionType.ADD_SONG, {
                listId,
                songId
            }, `Added "${songTitle}" to ${list.name}`);
        }

        list.songs.push(songId);

        // Store metadata if provided
        if (metadata && Object.keys(metadata).length > 0) {
            list.songMetadata[songId] = metadata;
        }

        saveLists();
        trackListAction('add_song', listId);

        // Sync to cloud (include metadata)
        if (list.cloudId && typeof SupabaseAuth !== 'undefined' && SupabaseAuth.isLoggedIn()) {
            SupabaseAuth.addToCloudList(list.cloudId, songId, metadata).catch(console.error);
        }
    }

    return true;
}

/**
 * Remove a song from a list
 */
export function removeSongFromList(listId, songId, skipUndo = false) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return false;

    const index = list.songs.indexOf(songId);
    if (index !== -1) {
        // Record for undo before removing
        if (!skipUndo) {
            const song = allSongs.find(s => s.id === songId);
            const songTitle = song?.title || songId;
            recordAction(ActionType.REMOVE_SONG, {
                listId,
                songId,
                index
            }, `Removed "${songTitle}" from ${list.name}`);
        }

        list.songs.splice(index, 1);

        // Also remove associated metadata
        if (list.songMetadata && list.songMetadata[songId]) {
            delete list.songMetadata[songId];
        }

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
export function reorderSongInList(listId, fromIndex, toIndex, skipUndo = false) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return false;
    if (fromIndex < 0 || fromIndex >= list.songs.length) return false;
    if (toIndex < 0 || toIndex >= list.songs.length) return false;
    if (fromIndex === toIndex) return false;

    // Record for undo before reordering
    if (!skipUndo) {
        const songId = list.songs[fromIndex];
        const song = allSongs.find(s => s.id === songId);
        const songTitle = song?.title || songId;
        recordAction(ActionType.REORDER_SONG, {
            listId,
            fromIndex,
            toIndex
        }, `Moved "${songTitle}" in ${list.name}`);
    }

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

// ============================================
// SONG METADATA (per-item setlist data)
// ============================================

/**
 * Get metadata for a song in a list
 * @param {string} listId - The list ID
 * @param {string} songId - The song ID
 * @returns {object|null} - Metadata object or null if none
 */
export function getSongMetadata(listId, songId) {
    const list = userLists.find(l => l.id === listId || l.cloudId === listId);
    if (!list || !list.songMetadata) return null;
    return list.songMetadata[songId] || null;
}

/**
 * Update metadata for a song in a list
 * @param {string} listId - The list ID
 * @param {string} songId - The song ID
 * @param {object} metadata - Metadata to merge (key, tempo, notes)
 * @returns {boolean} - True if updated successfully
 */
export function updateSongMetadata(listId, songId, metadata) {
    const list = userLists.find(l => l.id === listId || l.cloudId === listId);
    if (!list) return false;

    // Ensure songMetadata exists
    if (!list.songMetadata) {
        list.songMetadata = {};
    }

    // Merge metadata (don't overwrite entire object, merge fields)
    const existing = list.songMetadata[songId] || {};
    const merged = { ...existing, ...metadata };

    // Remove empty/null fields
    Object.keys(merged).forEach(key => {
        if (merged[key] === null || merged[key] === undefined || merged[key] === '') {
            delete merged[key];
        }
    });

    // Store or delete if empty
    if (Object.keys(merged).length > 0) {
        list.songMetadata[songId] = merged;
    } else {
        delete list.songMetadata[songId];
    }

    saveLists();

    // Sync to cloud if logged in and list has cloudId
    const cloudId = list.cloudId || (list.id !== FAVORITES_LIST_ID && list.id);
    if (cloudId && typeof SupabaseAuth !== 'undefined' && SupabaseAuth.isLoggedIn()) {
        SupabaseAuth.updateListItemMetadata(cloudId, songId, merged).catch(console.error);
    }

    return true;
}

/**
 * Clear all metadata for a song in a list
 * @param {string} listId - The list ID
 * @param {string} songId - The song ID
 */
export function clearSongMetadata(listId, songId) {
    const list = userLists.find(l => l.id === listId || l.cloudId === listId);
    if (!list || !list.songMetadata) return;

    delete list.songMetadata[songId];
    saveLists();

    // Sync to cloud
    const cloudId = list.cloudId || (list.id !== FAVORITES_LIST_ID && list.id);
    if (cloudId && typeof SupabaseAuth !== 'undefined' && SupabaseAuth.isLoggedIn()) {
        SupabaseAuth.updateListItemMetadata(cloudId, songId, {}).catch(console.error);
    }
}

/**
 * Copy metadata from one list item to another (used when copying/moving songs)
 * @param {string} sourceListId - Source list ID
 * @param {string} destListId - Destination list ID
 * @param {string} songId - The song ID
 */
function copySongMetadata(sourceListId, destListId, songId) {
    const metadata = getSongMetadata(sourceListId, songId);
    if (metadata && Object.keys(metadata).length > 0) {
        updateSongMetadata(destListId, songId, metadata);
    }
}

/**
 * Handle duplicating or importing a list
 * Shared logic used by both duplicate buttons in the UI
 */
async function handleDuplicateOrImportList() {
    let songsToCopy = [];
    let listName = '';
    let sourceMetadata = null;

    // Handle importing a public list (not owned by user)
    if (viewingPublicList && !viewingPublicList.isOwner) {
        if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
            alert('Please sign in to import lists');
            return;
        }

        songsToCopy = viewingPublicList.songs || [];
        listName = viewingPublicList.list.name;
        sourceMetadata = viewingPublicList.songMetadata || {};

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
            const metadata = sourceMetadata[songId] || null;
            addSongToList(newList.id, songId, false, metadata);
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
        const metadata = getSongMetadata(viewingListId, songId);
        addSongToList(newList.id, songId, false, metadata);
    }

    showListView(newList.id);
    if (pushHistoryStateFn) {
        pushHistoryStateFn('list', { listId: newList.id });
    }
}

// ============================================
// NOTES BOTTOM SHEET
// ============================================

// Notes sheet state
let notesSheetEl = null;
let notesSheetBackdropEl = null;
let notesSheetSongId = null;
let notesSheetListId = null;
let notesDebounceTimer = null;

/**
 * Open the notes bottom sheet for a song
 * @param {string} listId - The list ID
 * @param {string} songId - The song ID
 * @param {string} songTitle - The song title for display
 */
export function openNotesSheet(listId, songId, songTitle) {
    if (!notesSheetEl) {
        notesSheetEl = document.getElementById('notes-sheet');
        notesSheetBackdropEl = document.getElementById('notes-sheet-backdrop');
    }

    if (!notesSheetEl) return;

    notesSheetSongId = songId;
    notesSheetListId = listId;

    // Set title
    const titleEl = document.getElementById('notes-sheet-title');
    if (titleEl) {
        titleEl.textContent = songTitle || 'Song Notes';
    }

    // Load existing metadata
    const metadata = getSongMetadata(listId, songId) || {};

    const keySelect = document.getElementById('notes-key');
    const tempoInput = document.getElementById('notes-tempo');
    const notesTextarea = document.getElementById('notes-text');

    if (keySelect) keySelect.value = metadata.key || '';
    if (tempoInput) tempoInput.value = metadata.tempo || '';
    if (notesTextarea) notesTextarea.value = metadata.notes || '';

    // Show sheet
    notesSheetEl.classList.remove('hidden');
    notesSheetBackdropEl?.classList.remove('hidden');

    // Focus the notes textarea
    setTimeout(() => notesTextarea?.focus(), 100);
}

/**
 * Close the notes bottom sheet
 */
export function closeNotesSheet() {
    if (notesSheetEl) {
        notesSheetEl.classList.add('hidden');
    }
    if (notesSheetBackdropEl) {
        notesSheetBackdropEl.classList.add('hidden');
    }

    // Clear debounce timer
    if (notesDebounceTimer) {
        clearTimeout(notesDebounceTimer);
        notesDebounceTimer = null;
    }

    notesSheetSongId = null;
    notesSheetListId = null;
}

/**
 * Save notes sheet data (debounced)
 */
function saveNotesSheetData() {
    if (!notesSheetSongId || !notesSheetListId) return;

    const keySelect = document.getElementById('notes-key');
    const tempoInput = document.getElementById('notes-tempo');
    const notesTextarea = document.getElementById('notes-text');

    const metadata = {};

    // Explicitly set null to clear values when empty (updateSongMetadata will delete null fields)
    if (keySelect?.value) {
        metadata.key = keySelect.value;
    } else {
        metadata.key = null; // Clear the key
    }

    if (tempoInput?.value) {
        const tempo = parseInt(tempoInput.value, 10);
        if (!isNaN(tempo) && tempo >= 40 && tempo <= 300) {
            metadata.tempo = tempo;
        } else {
            metadata.tempo = null; // Invalid tempo, clear it
        }
    } else {
        metadata.tempo = null; // Clear the tempo
    }

    if (notesTextarea?.value?.trim()) {
        metadata.notes = notesTextarea.value.trim();
    } else {
        metadata.notes = null; // Clear the notes
    }

    updateSongMetadata(notesSheetListId, notesSheetSongId, metadata);

    // Refresh the list view to show updated badges
    if (viewingListId) {
        // Re-render the current list view to update metadata badges
        refreshListItemMetadata(notesSheetSongId);
    }
}

/**
 * Debounced save for notes sheet input
 */
function onNotesSheetInput() {
    if (notesDebounceTimer) {
        clearTimeout(notesDebounceTimer);
    }
    notesDebounceTimer = setTimeout(saveNotesSheetData, 500);
}

/**
 * Refresh metadata display for a single list item (without full re-render)
 * @param {string} songId - The song ID to refresh
 */
function refreshListItemMetadata(songId) {
    const resultItem = document.querySelector(`.result-item[data-id="${songId}"]`);
    if (!resultItem) return;

    const metadata = getSongMetadata(viewingListId, songId);

    // Update or create metadata badges container
    let badgesContainer = resultItem.querySelector('.list-item-badges');
    if (!badgesContainer) {
        badgesContainer = document.createElement('span');
        badgesContainer.className = 'list-item-badges';
        const titleArea = resultItem.querySelector('.result-title-artist');
        if (titleArea) {
            titleArea.appendChild(badgesContainer);
        }
    }

    // Update badges content
    let badgeHtml = '';
    if (metadata?.key) {
        badgeHtml += `<span class="list-item-badge key-badge">${escapeHtml(metadata.key)}</span>`;
    }
    if (metadata?.tempo) {
        badgeHtml += `<span class="list-item-badge tempo-badge">${metadata.tempo}</span>`;
    }
    badgesContainer.innerHTML = badgeHtml;

    // Update notes icon state
    const notesBtn = resultItem.querySelector('.list-notes-btn');
    if (notesBtn) {
        const hasNotes = metadata?.notes && metadata.notes.trim();
        notesBtn.classList.toggle('has-notes', hasNotes);
        notesBtn.title = hasNotes ? 'Edit notes' : 'Add notes';
    }
}

/**
 * Initialize notes sheet event handlers
 */
function initNotesSheet() {
    notesSheetEl = document.getElementById('notes-sheet');
    notesSheetBackdropEl = document.getElementById('notes-sheet-backdrop');

    if (!notesSheetEl) return;

    // Close button
    const closeBtn = document.getElementById('notes-sheet-close');
    closeBtn?.addEventListener('click', closeNotesSheet);

    // Backdrop click closes
    notesSheetBackdropEl?.addEventListener('click', closeNotesSheet);

    // Input handlers for auto-save
    const keySelect = document.getElementById('notes-key');
    const tempoInput = document.getElementById('notes-tempo');
    const notesTextarea = document.getElementById('notes-text');

    keySelect?.addEventListener('change', saveNotesSheetData);
    tempoInput?.addEventListener('input', onNotesSheetInput);
    notesTextarea?.addEventListener('input', onNotesSheetInput);

    // Escape key closes
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && notesSheetEl && !notesSheetEl.classList.contains('hidden')) {
            closeNotesSheet();
            e.stopPropagation();
        }
    });
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

        // Step 3.5: Clean legacy song IDs from merged data
        processedLists = await cleanLegacyIdsFromLists(processedLists);

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
                    songMetadata: cloudList.songMetadata || {},
                    cloudId: cloudList.name === FAVORITES_LIST_NAME ? cloudList.id : null
                };
            } else {
                // Merge songs from additional favorites lists
                const existingSongs = new Set(favoritesEntry.songs);
                for (const songId of (cloudList.songs || [])) {
                    if (!existingSongs.has(songId)) {
                        favoritesEntry.songs.push(songId);
                        // Also merge metadata for this song
                        if (cloudList.songMetadata && cloudList.songMetadata[songId]) {
                            favoritesEntry.songMetadata[songId] = cloudList.songMetadata[songId];
                        }
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
            songMetadata: cloudList.songMetadata || {},
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
        header.textContent = 'My Lists';
        navListsContainerEl.appendChild(header);

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
 * Show songs in a specific list using the rich view UI
 * Opens the list with full song cards, drag-drop, etc.
 */
export async function showListView(listId) {
    // Handle favorites
    if (listId === 'favorites' || listId === FAVORITES_LIST_ID) {
        const favList = getFavoritesList();
        setViewingListId(FAVORITES_LIST_ID);
        renderListViewUI(favList.name, favList.songs, { isOwner: true, isFollower: false, isOrphaned: false, canClaim: false });
        setCurrentView('list');
        if (pushHistoryStateFn) pushHistoryStateFn('list', { listId: FAVORITES_LIST_ID });
        return;
    }

    // Check if this is a local (owned) list
    const localList = userLists.find(l => l.id === listId);
    if (localList) {
        setViewingListId(localList.id);
        renderListViewUI(localList.name, localList.songs || [], { isOwner: true, isFollower: false, isOrphaned: false, canClaim: false });
        setCurrentView('list');
        if (pushHistoryStateFn) pushHistoryStateFn('list', { listId: localList.id });
        return;
    }

    // Check if this is a followed list
    const followedList = followedLists.find(l => l.id === listId);
    if (followedList) {
        setViewingListId(followedList.id);
        renderListViewUI(followedList.name, followedList.songs || [], { isOwner: false, isFollower: true, isOrphaned: false, canClaim: false });
        setCurrentView('list');
        if (pushHistoryStateFn) pushHistoryStateFn('list', { listId: followedList.id });
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

    // Show the public list
    setViewingListId(listId);
    setViewingPublicList(data);
    renderListViewUI(data.list.name, data.list.songs || [], {
        isOwner: data.isOwner || false,
        isFollower: data.isFollower || false,
        isOrphaned: data.list.is_orphaned || false,
        canClaim: data.canClaim || false
    });
    setCurrentView('list');
    if (pushHistoryStateFn) pushHistoryStateFn('list', { listId });
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

    // Populate and show the new list header (use fallback to getElementById if module var not set)
    const header = listHeaderEl || document.getElementById('list-header');
    const headerName = listHeaderNameEl || document.getElementById('list-header-name');
    const headerCount = listHeaderCountEl || document.getElementById('list-header-count');
    const headerBadge = listHeaderBadgeEl || document.getElementById('list-header-badge');

    if (header) {
        header.classList.remove('hidden');

        // Set list name
        if (headerName) {
            headerName.textContent = listName;
        }

        // Set song count
        if (headerCount) {
            headerCount.textContent = `${listSongs.length} song${listSongs.length !== 1 ? 's' : ''}`;
        }

        // Set badge based on ownership status
        if (headerBadge) {
            if (ownership.isOrphaned) {
                headerBadge.textContent = 'Needs Owner';
                headerBadge.className = 'list-badge list-badge-orphaned';
                headerBadge.classList.remove('hidden');
            } else if (ownership.isFollower && !ownership.isOwner) {
                headerBadge.textContent = 'Following';
                headerBadge.className = 'list-badge list-badge-following';
                headerBadge.classList.remove('hidden');
            } else if (!ownership.isOwner && viewingPublicList) {
                headerBadge.textContent = 'Shared List';
                headerBadge.className = 'list-badge list-badge-shared';
                headerBadge.classList.remove('hidden');
            } else {
                headerBadge.classList.add('hidden');
            }
        }

        // Configure header buttons based on ownership
        // Print - always visible
        if (listPrintBtnEl) listPrintBtnEl.classList.remove('hidden');

        // Share - owner only
        if (listShareBtnEl) {
            if (ownership.isOwner) {
                listShareBtnEl.classList.remove('hidden');
            } else {
                listShareBtnEl.classList.add('hidden');
            }
        }

        // Duplicate/Copy
        if (listDuplicateBtnEl) {
            if (ownership.isOwner) {
                listDuplicateBtnEl.innerHTML = '📋 Duplicate';
            } else {
                listDuplicateBtnEl.innerHTML = '📋 Copy to My Lists';
            }
            listDuplicateBtnEl.classList.remove('hidden');
        }

        // Follow/Unfollow - non-owners only
        if (listFollowBtnEl) {
            if (!ownership.isOwner && viewingListId) {
                if (ownership.isFollower) {
                    listFollowBtnEl.innerHTML = '👁️ Unfollow';
                } else {
                    listFollowBtnEl.innerHTML = '👁️ Follow';
                }
                listFollowBtnEl.classList.remove('hidden');
            } else {
                listFollowBtnEl.classList.add('hidden');
            }
        }

        // Claim - orphaned lists only
        if (listClaimBtnEl) {
            if (ownership.canClaim && ownership.isOrphaned) {
                listClaimBtnEl.classList.remove('hidden');
            } else {
                listClaimBtnEl.classList.add('hidden');
            }
        }

        // Request song - always visible
        if (listRequestBtnEl) listRequestBtnEl.classList.remove('hidden');

        // Delete - owner only, not for favorites
        if (listDeleteBtnEl) {
            if (ownership.isOwner && viewingListId !== FAVORITES_LIST_ID && viewingListId !== 'favorites') {
                listDeleteBtnEl.classList.remove('hidden');
            } else {
                listDeleteBtnEl.classList.add('hidden');
            }
        }
    }

    // Hide old search-stats-row buttons (keeping them in HTML for backwards compat)
    if (searchStatsEl) {
        searchStatsEl.textContent = '';  // Clear the old status text
    }
    // Hide old action buttons in search-stats-row
    if (printListBtnEl) printListBtnEl.classList.add('hidden');
    if (shareListBtnEl) shareListBtnEl.classList.add('hidden');
    const duplicateListBtn = document.getElementById('duplicate-list-btn');
    if (duplicateListBtn) duplicateListBtn.classList.add('hidden');
    const followListBtn = document.getElementById('follow-list-btn');
    if (followListBtn) followListBtn.classList.add('hidden');
    const claimListBtn = document.getElementById('claim-list-btn');
    if (claimListBtn) claimListBtn.classList.add('hidden');
    const deleteListBtn = document.getElementById('delete-list-btn');
    if (deleteListBtn) deleteListBtn.classList.add('hidden');
    const copyListBtn = document.getElementById('copy-list-btn');
    if (copyListBtn) copyListBtn.classList.add('hidden');

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

    // Hide the new list header (use fallback getElementById if module var not set)
    const header = listHeaderEl || document.getElementById('list-header');
    if (header) {
        header.classList.add('hidden');
    }

    // Hide list action buttons (old search-stats-row buttons)
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
    // Clear selections when leaving list view
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

// ============================================
// SONG LISTS PAGE (formerly Manage Lists)
// ============================================

// DOM element for manage lists container
let manageListsContainerEl = null;

// Current folder being viewed (null = root level)
let currentFolderId = null;

// State for creating a new list in Song Lists view
let creatingListInView = false;

// DOM elements for song lists view
let songListsViewEl = null;
let songListsBackBtnEl = null;
let songListsBreadcrumbEl = null;

/**
 * Navigate to a folder and update history
 */
export function navigateToFolder(folderId) {
    currentFolderId = folderId;
    updateBreadcrumb();
    renderManageListsView();

    if (pushHistoryStateFn) {
        pushHistoryStateFn('song-lists', { folderId });
    }
}

/**
 * Show the Song Lists view, optionally at a specific folder
 */
export function showSongListsView(folderId = null) {
    currentFolderId = folderId;

    // Initialize DOM references if needed
    if (!songListsViewEl) {
        songListsViewEl = document.getElementById('song-lists-view');
    }
    if (!songListsBackBtnEl) {
        songListsBackBtnEl = document.getElementById('song-lists-back-btn');
    }
    if (!songListsBreadcrumbEl) {
        songListsBreadcrumbEl = document.getElementById('song-lists-breadcrumb');
    }

    updateBreadcrumb();
    renderManageListsView();
    setCurrentView('song-lists');
}

/**
 * Start inline list creation in Song Lists view
 */
export function startCreateListInView() {
    creatingListInView = true;
    renderManageListsView();
    // Focus the input after render
    setTimeout(() => {
        const input = manageListsContainerEl?.querySelector('.new-list-input');
        input?.focus();
    }, 0);
}

/**
 * Commit new list creation from inline input
 */
function commitNewListInView(name) {
    if (name && name.trim()) {
        const list = createList(name.trim());
        // If we're inside a folder, put the list in that folder
        if (list && currentFolderId) {
            setListFolder(list.id, currentFolderId);
        }
    }
    creatingListInView = false;
    renderManageListsView();
}

/**
 * Cancel inline list creation
 */
function cancelNewListInView() {
    creatingListInView = false;
    renderManageListsView();
}

/**
 * Update the breadcrumb display based on current folder
 */
function updateBreadcrumb() {
    if (!songListsBreadcrumbEl) {
        songListsBreadcrumbEl = document.getElementById('song-lists-breadcrumb');
    }
    if (!songListsBackBtnEl) {
        songListsBackBtnEl = document.getElementById('song-lists-back-btn');
    }

    if (!currentFolderId) {
        // At root level
        if (songListsBreadcrumbEl) {
            songListsBreadcrumbEl.innerHTML = 'Song Lists';
        }
        if (songListsBackBtnEl) {
            songListsBackBtnEl.classList.add('hidden');
        }
    } else {
        // Inside a folder
        const allFolders = getFolders();
        const folder = allFolders.find(f => f.id === currentFolderId);
        const folderName = folder ? escapeHtml(folder.name) : 'Folder';

        if (songListsBreadcrumbEl) {
            songListsBreadcrumbEl.innerHTML = `
                <a href="#" class="breadcrumb-link" data-folder-id="">Song Lists</a>
                <span class="breadcrumb-separator">/</span>
                <span class="breadcrumb-current">${folderName}</span>
            `;

            // Wire up breadcrumb link click
            const rootLink = songListsBreadcrumbEl.querySelector('.breadcrumb-link');
            if (rootLink) {
                rootLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    navigateToFolder(null);
                });
            }
        }
        if (songListsBackBtnEl) {
            songListsBackBtnEl.classList.remove('hidden');
        }
    }
}

// Subscribe to allSongs changes to re-render when songs load
subscribe('allSongs', () => {
    // If we're on the song-lists view, re-render to show actual song titles
    if (currentView === 'song-lists') {
        renderManageListsView();
    }
});

/**
 * Get song title preview for a list
 */
function getListPreview(list, maxChars = 50) {
    if (!list.songs || list.songs.length === 0) return '';
    const titles = list.songs.slice(0, 3).map(id => {
        const song = allSongs.find(s => s.id === id);
        return song?.title || 'Unknown';
    });
    let preview = titles.join(', ');
    if (preview.length > maxChars) {
        preview = preview.substring(0, maxChars).replace(/,?\s*[^,]*$/, '...');
    }
    return preview;
}

/**
 * Render the Song Lists page with folders and lists as cards
 */
export function renderManageListsView() {
    if (!manageListsContainerEl) {
        manageListsContainerEl = document.getElementById('manage-lists-container');
    }
    if (!manageListsContainerEl) return;

    const html = [];

    // Get folders and lists at the current level
    const currentFolders = getFoldersAtLevel(currentFolderId);
    const currentLists = currentFolderId
        ? getListsInFolder(currentFolderId)
        : getListsAtRoot();

    // Show inline input card if creating a new list
    if (creatingListInView) {
        html.push(`
            <div class="list-card new-list-card">
                <div class="list-card-header">
                    <span class="list-card-icon">☰</span>
                    <div class="list-card-info">
                        <input type="text" class="new-list-input" placeholder="List name" autofocus>
                    </div>
                    <div class="list-card-actions">
                        <button class="list-card-btn cancel-new-list-btn" title="Cancel">×</button>
                    </div>
                </div>
            </div>
        `);
    }

    // No content message (only show if not creating and empty)
    if (!creatingListInView && currentFolders.length === 0 && currentLists.length === 0) {
        const emptyMessage = currentFolderId
            ? '<p>This folder is empty.</p><p>Add lists by moving them here from the root level.</p>'
            : '<p>No lists yet!</p><p>Click <strong>+ New List</strong> above to create your first list.</p>';
        manageListsContainerEl.innerHTML = `
            <div class="manage-lists-empty">
                ${emptyMessage}
            </div>
        `;
        return;
    }

    // Render folders first (only at root level - we support one level of nesting)
    if (!currentFolderId) {
        currentFolders.forEach(folder => {
            const listsInFolder = getListsInFolder(folder.id);
            const listCount = listsInFolder.length;
            html.push(`
                <div class="list-card folder-card" data-folder-id="${folder.id}">
                    <div class="list-card-header">
                        <span class="list-card-icon">📁</span>
                        <div class="list-card-info">
                            <span class="list-card-name">${escapeHtml(folder.name)}</span>
                            <span class="list-card-meta">${listCount} list${listCount !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="list-card-actions">
                            <button class="list-card-btn rename-folder-btn" data-folder-id="${folder.id}" title="Rename folder">✏️</button>
                            <button class="list-card-btn delete-folder-btn" data-folder-id="${folder.id}" title="Delete folder">🗑️</button>
                        </div>
                    </div>
                </div>
            `);
        });
    }

    // Render lists at current level
    const isLoggedIn = typeof SupabaseAuth !== 'undefined' && SupabaseAuth.isLoggedIn?.();
    currentLists.forEach((list, index) => {
        const isFavorites = list.id === FAVORITES_LIST_ID;
        const songCount = list.songs?.length || 0;
        const preview = getListPreview(list);
        const isFirst = index === 0;
        const isLast = index === currentLists.length - 1;

        // Determine if list can be shared
        const canShare = isLoggedIn && list.cloudId;
        const shareTitle = !isLoggedIn ? 'Sign in to share' : !list.cloudId ? 'Sync to share' : 'Share list';

        html.push(`
            <div class="list-card clickable${isFavorites ? ' favorites-card' : ''}" data-list-id="${list.id}">
                <div class="list-card-header">
                    <span class="list-card-icon">${isFavorites ? '⭐' : '☰'}</span>
                    <div class="list-card-info">
                        <span class="list-card-name">${escapeHtml(list.name)}</span>
                        <span class="list-card-meta">${songCount} song${songCount !== 1 ? 's' : ''}${preview ? ' • ' + escapeHtml(preview) : ''}</span>
                    </div>
                    <div class="list-card-actions">
                        <button class="list-card-btn share-list-btn" data-list-id="${list.id}" title="${shareTitle}"${!canShare ? ' disabled' : ''}>🔗</button>
                        <button class="list-card-btn move-list-up-btn" data-list-id="${list.id}" title="Move up"${isFirst ? ' disabled' : ''}>▲</button>
                        <button class="list-card-btn move-list-down-btn" data-list-id="${list.id}" title="Move down"${isLast ? ' disabled' : ''}>▼</button>
                        ${!isFavorites ? `
                            <button class="list-card-btn rename-list-btn" data-list-id="${list.id}" title="Rename list">✏️</button>
                            <button class="list-card-btn delete-list-btn" data-list-id="${list.id}" title="Delete list">🗑️</button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `);
    });

    manageListsContainerEl.innerHTML = html.join('');

    // Wire up event handlers
    wireManageListsEvents();
}

/**
 * Wire up event handlers for manage lists page
 */
function wireManageListsEvents() {
    if (!manageListsContainerEl) return;

    // New list inline input handlers
    const newListInput = manageListsContainerEl.querySelector('.new-list-input');
    if (newListInput) {
        newListInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitNewListInView(newListInput.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelNewListInView();
            }
        });
        newListInput.addEventListener('blur', () => {
            // Commit if has value, cancel if empty
            setTimeout(() => {
                if (creatingListInView) {
                    if (newListInput.value.trim()) {
                        commitNewListInView(newListInput.value);
                    } else {
                        cancelNewListInView();
                    }
                }
            }, 100);
        });
    }

    // Cancel new list button
    manageListsContainerEl.querySelector('.cancel-new-list-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelNewListInView();
    });

    // Click on list card to open in rich view
    manageListsContainerEl.querySelectorAll('.list-card.clickable[data-list-id]').forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't navigate if clicking on action buttons
            if (e.target.closest('.list-card-actions')) return;

            e.stopPropagation();
            const listId = card.dataset.listId;
            showListView(listId);
        });
    });

    // Folder card click - navigate into folder
    manageListsContainerEl.querySelectorAll('.folder-card').forEach(card => {
        const header = card.querySelector('.list-card-header');
        if (header) {
            header.addEventListener('click', (e) => {
                // Don't navigate if clicking on buttons
                if (e.target.closest('button')) return;

                e.stopPropagation();
                const folderId = card.dataset.folderId;
                if (folderId) {
                    navigateToFolder(folderId);
                }
            });
            header.style.cursor = 'pointer';
        }
    });

    // Rename list
    manageListsContainerEl.querySelectorAll('.rename-list-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const listId = btn.dataset.listId;
            const list = userLists.find(l => l.id === listId);
            if (list) {
                const newName = prompt('Enter new name:', list.name);
                if (newName && renameList(listId, newName)) {
                    renderManageListsView();
                    renderSidebarLists();
                }
            }
        });
    });

    // Delete list
    manageListsContainerEl.querySelectorAll('.delete-list-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const listId = btn.dataset.listId;
            const list = userLists.find(l => l.id === listId);
            if (list && confirm(`Delete "${list.name}"? Songs won't be deleted from the songbook.`)) {
                await deleteList(listId);
                renderManageListsView();
                renderSidebarLists();
            }
        });
    });

    // Rename folder
    manageListsContainerEl.querySelectorAll('.rename-folder-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const folderId = btn.dataset.folderId;
            const folder = getFolders().find(f => f.id === folderId);
            if (folder) {
                const newName = prompt('Enter new folder name:', folder.name);
                if (newName) {
                    renameFolder(folderId, newName);
                    renderManageListsView();
                    renderSidebarLists();
                }
            }
        });
    });

    // Delete folder
    manageListsContainerEl.querySelectorAll('.delete-folder-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const folderId = btn.dataset.folderId;
            const folder = getFolders().find(f => f.id === folderId);
            if (folder && confirm(`Delete folder "${folder.name}"? Lists inside will be moved to the root level.`)) {
                deleteFolder(folderId);
                renderManageListsView();
                renderSidebarLists();
            }
        });
    });

    // Move list up
    manageListsContainerEl.querySelectorAll('.move-list-up-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const listId = btn.dataset.listId;
            if (reorderList(listId, 'up')) {
                renderManageListsView();
            }
        });
    });

    // Move list down
    manageListsContainerEl.querySelectorAll('.move-list-down-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const listId = btn.dataset.listId;
            if (reorderList(listId, 'down')) {
                renderManageListsView();
            }
        });
    });

    // Share list button - opens share modal (button is disabled when sharing isn't available)
    manageListsContainerEl.querySelectorAll('.share-list-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.disabled) return; // Extra safety check

            const listId = btn.dataset.listId;
            let shareId = null;

            if (listId === FAVORITES_LIST_ID) {
                const favList = getFavoritesList();
                shareId = favList?.cloudId;
            } else {
                const list = userLists.find(l => l.id === listId);
                shareId = list?.cloudId;
            }

            if (shareId) {
                openShareModal(shareId);
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

    // Initialize new list header elements
    listHeaderEl = document.getElementById('list-header');
    listHeaderNameEl = document.getElementById('list-header-name');
    listHeaderCountEl = document.getElementById('list-header-count');
    listHeaderBadgeEl = document.getElementById('list-header-badge');
    listPrintBtnEl = document.getElementById('list-print-btn');
    listShareBtnEl = document.getElementById('list-share-btn');
    listDuplicateBtnEl = document.getElementById('list-duplicate-btn');
    listFollowBtnEl = document.getElementById('list-follow-btn');
    listClaimBtnEl = document.getElementById('list-claim-btn');
    listDeleteBtnEl = document.getElementById('list-delete-btn');
    listRequestBtnEl = document.getElementById('list-request-btn');

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
            shareId = list?.cloudId;
        }

        // If no cloudId, show local share modal explaining they need to sign in
        if (!shareId || shareId === 'favorites' || isLocalListId(viewingListId)) {
            openLocalShareModal(viewingListId);
            return;
        }

        openShareModal(shareId);
    });

    // Initialize share modal handlers
    initShareModal();
    initLocalShareModal();

    // Initialize notes bottom sheet
    initNotesSheet();

    // Duplicate/Import list button (stats row)
    const duplicateListBtn = document.getElementById('duplicate-list-btn');
    duplicateListBtn?.addEventListener('click', handleDuplicateOrImportList);

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

    // ============================================
    // NEW LIST HEADER BUTTON HANDLERS
    // ============================================

    // List header: Print button
    listPrintBtnEl?.addEventListener('click', () => {
        // Delegate to existing print functionality
        printListBtnEl?.click();
    });

    // List header: Share button
    listShareBtnEl?.addEventListener('click', async () => {
        let shareId = null;

        if (viewingListId === 'favorites' || viewingListId === FAVORITES_LIST_ID) {
            const favList = getFavoritesList();
            shareId = favList?.cloudId;
        } else if (viewingListId) {
            const list = userLists.find(l => l.id === viewingListId);
            shareId = list?.cloudId;
        }

        // If no cloudId, show local share modal explaining they need to sign in
        if (!shareId || shareId === 'favorites' || isLocalListId(viewingListId)) {
            openLocalShareModal(viewingListId);
            return;
        }

        openShareModal(shareId);
    });

    // List header: Request song button
    listRequestBtnEl?.addEventListener('click', () => {
        if (!requireLogin('request songs')) return;
        openAddSongPicker({ mode: 'request' });
    });

    // List header: Duplicate button
    listDuplicateBtnEl?.addEventListener('click', handleDuplicateOrImportList);

    // List header: Follow button
    listFollowBtnEl?.addEventListener('click', async () => {
        if (!viewingListId || typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
            alert('Please sign in to follow lists');
            return;
        }

        const isCurrentlyFollowing = viewingPublicList?.isFollower || followedLists.some(l => l.id === viewingListId);

        if (isCurrentlyFollowing) {
            const { error } = await SupabaseAuth.unfollowList(viewingListId);
            if (error) {
                alert('Failed to unfollow list');
                return;
            }
            followedLists = followedLists.filter(l => l.id !== viewingListId);
            renderSidebarLists();
            if (listFollowBtnEl) listFollowBtnEl.innerHTML = '👁️ Follow';
            if (viewingPublicList) {
                viewingPublicList.isFollower = false;
            }
        } else {
            const { error } = await SupabaseAuth.followList(viewingListId);
            if (error) {
                alert('Failed to follow list');
                return;
            }
            await loadFollowedLists();
            if (listFollowBtnEl) listFollowBtnEl.innerHTML = '👁️ Unfollow';
            if (viewingPublicList) {
                viewingPublicList.isFollower = true;
            }
        }
    });

    // List header: Claim button
    listClaimBtnEl?.addEventListener('click', async () => {
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

        await performFullListsSync();
        showListView(viewingListId);
    });

    // List header: Delete button
    listDeleteBtnEl?.addEventListener('click', async () => {
        if (!viewingListId || viewingListId === 'favorites' || viewingListId === FAVORITES_LIST_ID) {
            return;
        }

        const list = userLists.find(l => l.id === viewingListId);
        const listName = list?.name || 'this list';

        if (!confirm(`Delete "${listName}"? Songs won't be deleted from the songbook.`)) {
            return;
        }

        await deleteList(viewingListId);

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

    // Clean up legacy song IDs (async, runs in background)
    cleanupLegacySongIds().then(() => {
        renderSidebarLists();
        updateFavoritesCount();
    });

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

    // Initialize undo/redo keyboard shortcuts
    initUndoKeyboardShortcuts();
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
                const errorMsg = typeof result.error === 'string'
                    ? result.error
                    : (result.error.message || JSON.stringify(result.error));
                alert('Failed to generate invite: ' + errorMsg);
                generateInviteBtn.disabled = false;
                generateInviteBtn.textContent = 'Generate Invite Link';
                return;
            }

            // Build invite URL (data contains { status, token, invite_id, expires_at })
            const inviteUrl = `${window.location.origin}${window.location.pathname}#invite/${result.data.token}`;

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

// ============================================
// LOCAL SHARE MODAL (for non-synced lists)
// ============================================

let localShareListId = null;

/**
 * Check if a list ID is a local (non-synced) ID
 */
function isLocalListId(listId) {
    if (!listId) return false;
    if (listId === 'favorites' || listId === FAVORITES_LIST_ID) return false;
    // Local IDs start with 'local_' prefix
    return typeof listId === 'string' && listId.startsWith('local_');
}

/**
 * Open the local share modal for non-synced lists
 */
function openLocalShareModal(listId) {
    localShareListId = listId;

    const modal = document.getElementById('local-share-modal');
    const backdrop = document.getElementById('local-share-modal-backdrop');

    if (!modal || !backdrop) return;

    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
}

/**
 * Close the local share modal
 */
function closeLocalShareModal() {
    const modal = document.getElementById('local-share-modal');
    const backdrop = document.getElementById('local-share-modal-backdrop');

    if (modal) modal.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
    localShareListId = null;
}

/**
 * Get the song list as plain text for copying
 */
function getListAsText(listId) {
    let songIds = [];
    let listName = '';

    if (listId === 'favorites' || listId === FAVORITES_LIST_ID) {
        const favList = getFavoritesList();
        songIds = favList?.songs || [];
        listName = FAVORITES_LIST_NAME;
    } else {
        const list = userLists.find(l => l.id === listId);
        if (list) {
            songIds = list.songs || [];
            listName = list.name;
        }
    }

    if (songIds.length === 0) {
        return `${listName}\n(empty list)`;
    }

    // Look up song titles
    const lines = songIds.map((songId, index) => {
        const song = allSongs.find(s => s.id === songId);
        if (song) {
            const artist = song.artist ? ` - ${song.artist}` : '';
            return `${index + 1}. ${song.title}${artist}`;
        }
        return `${index + 1}. (unknown song)`;
    });

    return `${listName}\n${'─'.repeat(listName.length)}\n${lines.join('\n')}`;
}

/**
 * Initialize the local share modal event handlers
 */
function initLocalShareModal() {
    const backdrop = document.getElementById('local-share-modal-backdrop');
    const closeBtn = document.getElementById('local-share-modal-close');
    const signInBtn = document.getElementById('local-share-sign-in');
    const copyTextBtn = document.getElementById('local-share-copy-text');

    // Close on backdrop click or close button
    backdrop?.addEventListener('click', closeLocalShareModal);
    closeBtn?.addEventListener('click', closeLocalShareModal);

    // Sign in button - dispatch event to open auth modal (supports email + Google)
    signInBtn?.addEventListener('click', () => {
        closeLocalShareModal();
        window.dispatchEvent(new CustomEvent('open-auth-modal'));
    });

    // Copy as text button
    copyTextBtn?.addEventListener('click', async () => {
        const text = getListAsText(localShareListId || viewingListId);

        try {
            await navigator.clipboard.writeText(text);
            copyTextBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyTextBtn.textContent = 'Copy Song List';
            }, 2000);
        } catch (err) {
            prompt('Copy this list:', text);
        }
    });
}
