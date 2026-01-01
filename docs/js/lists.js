// User lists management for Bluegrass Songbook

import {
    userLists, setUserLists,
    allSongs, currentSong,
    isCloudSyncEnabled,
    showingFavorites, setShowingFavorites,
    setListContext
} from './state.js';
import { escapeHtml, generateLocalId } from './utils.js';
import { isFavorite, toggleFavorite, updateSyncUI } from './favorites.js';
import { trackListAction } from './analytics.js';

// Module-level state
let viewingListId = null;
let viewingPublicList = null;  // { list, songs, isOwner } - null if viewing own list

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
export function deleteList(listId) {
    const index = userLists.findIndex(l => l.id === listId);
    if (index === -1) return false;

    const list = userLists[index];
    userLists.splice(index, 1);
    saveLists();
    trackListAction('delete', listId);

    // Sync to cloud
    if (list.cloudId) {
        syncListToCloud(list, 'delete');
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
        if (list.cloudId && isCloudSyncEnabled) {
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
        if (list.cloudId && isCloudSyncEnabled) {
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
    if (!isCloudSyncEnabled || typeof SupabaseAuth === 'undefined') return;

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
                if (list.cloudId) {
                    await SupabaseAuth.deleteCloudList(list.cloudId);
                }
                break;
        }
    } catch (err) {
        console.error('List sync error:', err);
    }
}

/**
 * Full sync: merge localStorage lists with cloud
 */
export async function performFullListsSync() {
    if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
        return;
    }

    try {
        const { data: merged, error } = await SupabaseAuth.syncListsToCloud(userLists);
        if (error) throw error;

        // Update local lists with merged data
        const mergedLists = merged.map(cloudList => ({
            id: cloudList.id,
            name: cloudList.name,
            songs: cloudList.songs || [],
            cloudId: cloudList.id
        }));
        setUserLists(mergedLists);
        saveLists();

        // Update sync UI to show lists count
        if (isCloudSyncEnabled) {
            updateSyncUI('synced');
        }
    } catch (err) {
        console.error('Lists sync failed:', err);
    }
}

/**
 * Render lists in sidebar
 */
export function renderSidebarLists() {
    if (!navListsContainerEl) return;

    navListsContainerEl.innerHTML = '';

    userLists.forEach(list => {
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
    if (listId === 'favorites') {
        // Import showFavorites dynamically to avoid circular dependency
        const { showFavorites } = await import('./favorites.js');
        showFavorites();
        return;
    }

    // First check if this is a local list
    const localList = userLists.find(l => l.id === listId);

    if (localList) {
        // It's a local list - show it normally
        viewingListId = listId;
        viewingPublicList = null;
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

    viewingListId = listId;
    viewingPublicList = {
        list: data.list,
        songs: data.songs,
        isOwner
    };

    renderListViewUI(data.list.name, data.songs, isOwner);
}

/**
 * Show "list not found" message
 */
function showListNotFound() {
    viewingListId = null;
    viewingPublicList = null;

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
    setShowingFavorites(false);
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

    // Show print list button
    if (printListBtnEl) printListBtnEl.classList.remove('hidden');

    // Show share list button (only for cloud lists with UUID)
    if (shareListBtnEl) {
        // Show share button if this is a cloud list (has UUID format)
        const isCloudList = viewingListId && viewingListId.includes('-');
        shareListBtnEl.classList.toggle('hidden', !isCloudList);
    }

    // Show/hide copy list button
    const copyListBtn = document.getElementById('copy-list-btn');
    if (copyListBtn) {
        copyListBtn.classList.toggle('hidden', isOwner || !viewingPublicList);
    }
}

/**
 * Clear list view state
 */
export function clearListView() {
    viewingListId = null;
    viewingPublicList = null;
    setListContext(null);
    if (navListsContainerEl) {
        navListsContainerEl.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
        });
    }
    // Hide print list button, share button, and copy list button
    if (printListBtnEl) printListBtnEl.classList.add('hidden');
    if (shareListBtnEl) shareListBtnEl.classList.add('hidden');
    const copyListBtn = document.getElementById('copy-list-btn');
    if (copyListBtn) copyListBtn.classList.add('hidden');
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
 * Copy current public list to user's own lists
 */
export async function copyCurrentList() {
    if (!viewingPublicList || !viewingListId) {
        return { error: { message: 'No public list to copy' } };
    }

    if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
        return { error: { message: 'Please sign in to copy lists' } };
    }

    const listName = viewingPublicList.list.name;
    const { data, error } = await SupabaseAuth.copyListToOwn(viewingListId, listName);

    if (error) {
        return { error };
    }

    // Add to local userLists
    const newLocalList = {
        id: data.id,
        name: data.name,
        songs: data.songs,
        cloudId: data.id
    };
    userLists.push(newLocalList);
    saveLists();

    return { data: newLocalList, error: null };
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

    userLists.forEach(list => {
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
            ${userLists.map(list => `
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

    if (userLists.length === 0) {
        listsContainerEl.innerHTML = '<p class="lists-empty">No lists yet. Create one above!</p>';
        return;
    }

    listsContainerEl.innerHTML = '';

    userLists.forEach(list => {
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
        btn.addEventListener('click', () => {
            const listId = btn.dataset.listId;
            const list = userLists.find(l => l.id === listId);
            if (list && confirm(`Delete "${list.name}"? Songs won't be deleted from the songbook.`)) {
                deleteList(listId);
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
        // Get shareable ID from viewingListId or listContext (for favorites)
        const { listContext, favoritesCloudId } = await import('./state.js');
        let shareId = viewingListId;

        // If viewing favorites, use the cloud ID
        if (!shareId && listContext && listContext.listId) {
            shareId = listContext.listId;
        }
        // Fallback to favorites cloud ID if we're showing favorites
        if (!shareId || shareId === 'favorites') {
            shareId = favoritesCloudId;
        }

        if (!shareId) return;

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

    // Load from localStorage
    loadLists();
    renderSidebarLists();

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
