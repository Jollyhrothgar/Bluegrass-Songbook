// User lists management for Bluegrass Songbook

import {
    userLists, setUserLists,
    allSongs, currentSong,
    isCloudSyncEnabled,
    showingFavorites, setShowingFavorites
} from './state.js';
import { escapeHtml, generateLocalId } from './utils.js';
import { isFavorite, toggleFavorite, updateSyncUI } from './favorites.js';
import { trackListAction } from './analytics.js';

// Module-level state
let viewingListId = null;

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

// Callbacks (set by init)
let renderResultsFn = null;
let closeSidebarFn = null;

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
        btn.addEventListener('click', () => showListView(list.id));
        navListsContainerEl.appendChild(btn);
    });
}

/**
 * Show songs in a specific list
 */
export function showListView(listId) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return;

    viewingListId = listId;
    setShowingFavorites(false);
    if (closeSidebarFn) closeSidebarFn();

    // Update nav active states
    if (navSearchEl) navSearchEl.classList.remove('active');
    if (navFavoritesEl) navFavoritesEl.classList.remove('active');
    if (navAddSongEl) navAddSongEl.classList.remove('active');

    // Update sidebar list buttons
    if (navListsContainerEl) {
        navListsContainerEl.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.listId === listId);
        });
    }

    // Show the list songs
    const listSongs = allSongs.filter(s => list.songs.includes(s.id));
    if (searchStatsEl) {
        searchStatsEl.textContent = `${list.name}: ${listSongs.length} song${listSongs.length !== 1 ? 's' : ''}`;
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
}

/**
 * Clear list view state
 */
export function clearListView() {
    viewingListId = null;
    if (navListsContainerEl) {
        navListsContainerEl.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
        });
    }
}

/**
 * Get current viewing list ID
 */
export function getViewingListId() {
    return viewingListId;
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
        renderResults,
        closeSidebar
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
    renderResultsFn = renderResults;
    closeSidebarFn = closeSidebar;

    // Load from localStorage
    loadLists();
    renderSidebarLists();

    // Close result picker when clicking outside
    document.addEventListener('click', (e) => {
        if (activeResultPicker) {
            if (!activeResultPicker.element.contains(e.target) && e.target !== activeResultPicker.btn) {
                closeResultListPicker();
            }
        }
    });
}
