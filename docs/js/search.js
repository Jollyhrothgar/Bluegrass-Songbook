// Bluegrass Songbook Search

let allSongs = [];
let songGroups = {};  // Map of group_id -> array of songs
let currentSong = null;
let currentChordpro = null;
let compactMode = false;
let showingFavorites = false;
let nashvilleMode = false;
let twoColumnMode = false;
let chordDisplayMode = 'all';  // 'all' | 'first' | 'none'
let seenChordPatterns = new Set();  // Track section chord patterns in 'first' mode
let showSectionLabels = true;
let showChordProSource = false;
let fontSizeLevel = 0;              // -2 to +2, 0 is default
let currentDetectedKey = null;      // User's chosen key (or detected if not changed)
let originalDetectedKey = null;     // The auto-detected key for current song
let originalDetectedMode = null;    // The auto-detected mode for current song

// Auth state
let isCloudSyncEnabled = false;
let syncInProgress = false;

// Font size multipliers for each level
const FONT_SIZES = {
    '-2': 0.7,
    '-1': 0.85,
    '0': 1,
    '1': 1.2,
    '2': 1.5
};

// GitHub repo for issue submissions
const GITHUB_REPO = 'Jollyhrothgar/Bluegrass-Songbook';

// Browser history management
let historyInitialized = false;

function pushHistoryState(view, data = {}) {
    if (!historyInitialized) return;

    let hash = '';
    const state = { view, ...data };

    switch (view) {
        case 'song':
            hash = `#song/${data.songId}`;
            break;
        case 'add-song':
            hash = '#add';
            break;
        case 'favorites':
            hash = '#favorites';
            break;
        case 'about':
            hash = '#about';
            break;
        case 'search':
        default:
            hash = data.query ? `#search/${encodeURIComponent(data.query)}` : '';
            break;
    }

    history.pushState(state, '', hash || window.location.pathname);
}

function handleHistoryNavigation(state) {
    if (!state) {
        // No state = initial page or cleared hash, go to search
        showView('search');
        return;
    }

    switch (state.view) {
        case 'song':
            if (state.songId) {
                openSongFromHistory(state.songId);
            }
            break;
        case 'add-song':
            showView('add-song');
            break;
        case 'favorites':
            showView('favorites');
            break;
        case 'about':
            showView('about');
            break;
        case 'search':
        default:
            showView('search');
            if (state.query) {
                searchInput.value = state.query;
                search(state.query);
            }
            break;
    }
}

// Show a view without pushing to history (used by popstate handler)
function showView(mode) {
    closeSidebar();

    const searchContainer = document.querySelector('.search-container');
    const editorPanel = document.getElementById('editor-panel');

    // Clear active states
    if (navSearch) navSearch.classList.remove('active');
    if (navAddSong) navAddSong.classList.remove('active');
    if (navFavorites) navFavorites.classList.remove('active');

    // Clear list view state when navigating away
    viewingListId = null;
    if (navListsContainer) {
        navListsContainer.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
        });
    }

    switch (mode) {
        case 'search':
            if (navSearch) navSearch.classList.add('active');
            showingFavorites = false;
            searchContainer.classList.remove('hidden');
            resultsDiv.classList.remove('hidden');
            if (editorPanel) editorPanel.classList.add('hidden');
            songView.classList.add('hidden');
            if (aboutView) aboutView.classList.add('hidden');
            exitEditMode();
            break;

        case 'add-song':
            if (navAddSong) navAddSong.classList.add('active');
            searchContainer.classList.add('hidden');
            resultsDiv.classList.add('hidden');
            songView.classList.add('hidden');
            if (editorPanel) editorPanel.classList.remove('hidden');
            if (aboutView) aboutView.classList.add('hidden');
            exitEditMode();
            break;

        case 'favorites':
            if (navFavorites) navFavorites.classList.add('active');
            searchContainer.classList.remove('hidden');
            resultsDiv.classList.remove('hidden');
            if (editorPanel) editorPanel.classList.add('hidden');
            songView.classList.add('hidden');
            if (aboutView) aboutView.classList.add('hidden');
            showFavorites();
            break;

        case 'about':
            searchContainer.classList.add('hidden');
            resultsDiv.classList.add('hidden');
            if (editorPanel) editorPanel.classList.add('hidden');
            songView.classList.add('hidden');
            if (aboutView) aboutView.classList.remove('hidden');
            break;
    }
}

// Open song without pushing to history (used by popstate handler)
async function openSongFromHistory(songId) {
    const song = allSongs.find(s => s.id === songId);
    if (!song) {
        showView('search');
        return;
    }

    songView.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    document.querySelector('.search-container').classList.add('hidden');

    currentSong = song;
    currentChordpro = song.content;
    originalDetectedKey = song.key || null;
    originalDetectedMode = song.mode || 'major';
    currentDetectedKey = originalDetectedKey;

    renderSong(song, song.content, true);
    updateFavoriteButton();
    updateListPickerButton();
}

// Handle deep links on page load
function handleDeepLink() {
    const hash = window.location.hash;
    if (!hash) return false;

    if (hash.startsWith('#song/')) {
        const songId = hash.slice(6);
        if (songId) {
            openSongFromHistory(songId);
            return true;
        }
    } else if (hash === '#add') {
        showView('add-song');
        return true;
    } else if (hash === '#favorites') {
        showView('favorites');
        return true;
    } else if (hash === '#about') {
        showView('about');
        return true;
    } else if (hash.startsWith('#search/')) {
        const query = decodeURIComponent(hash.slice(8));
        if (query) {
            searchInput.value = query;
            search(query);
            return true;
        }
    }

    return false;
}

// Listen for back/forward navigation
window.addEventListener('popstate', (event) => {
    handleHistoryNavigation(event.state);
});

// Favorites stored in localStorage
let favorites = new Set(JSON.parse(localStorage.getItem('songbook-favorites') || '[]'));

// User lists stored in localStorage (synced to cloud when logged in)
let userLists = JSON.parse(localStorage.getItem('songbook-lists') || '[]');
let viewingListId = null;  // ID of list being viewed (null = not viewing a list)

// DOM elements
const searchInput = document.getElementById('search-input');
const resultsDiv = document.getElementById('results');
const searchStats = document.getElementById('search-stats');
const songView = document.getElementById('song-view');
const songContent = document.getElementById('song-content');
const backBtn = document.getElementById('back-btn');
const themeToggle = document.getElementById('theme-toggle');
const favoriteBtn = document.getElementById('favorite-btn');

// Sidebar elements
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const hamburgerBtn = document.getElementById('hamburger-btn');
const sidebarClose = document.getElementById('sidebar-close');
const navSearch = document.getElementById('nav-search');
const navAddSong = document.getElementById('nav-add-song');
const navFavorites = document.getElementById('nav-favorites');
const navFavoritesCount = document.getElementById('nav-favorites-count');
const navFeedback = document.getElementById('nav-feedback');
const navAbout = document.getElementById('nav-about');
const navListsContainer = document.getElementById('nav-lists-container');
const navManageLists = document.getElementById('nav-manage-lists');

// About view elements
const aboutView = document.getElementById('about-view');
const aboutBackBtn = document.getElementById('about-back-btn');

// List picker elements
const listPickerBtn = document.getElementById('list-picker-btn');
const listPickerDropdown = document.getElementById('list-picker-dropdown');
const favoritesCheckbox = document.getElementById('favorites-checkbox');
const customListsContainer = document.getElementById('custom-lists-container');
const createListBtn = document.getElementById('create-list-btn');

// Export elements
const printBtn = document.getElementById('print-btn');
const copyBtn = document.getElementById('copy-btn');
const copyDropdown = document.getElementById('copy-dropdown');
const downloadBtn = document.getElementById('download-btn');
const downloadDropdown = document.getElementById('download-dropdown');

// Manage lists modal elements
const listsModal = document.getElementById('lists-modal');
const listsModalClose = document.getElementById('lists-modal-close');
const newListNameInput = document.getElementById('new-list-name');
const createListSubmit = document.getElementById('create-list-submit');
const listsContainer = document.getElementById('lists-container');

// Theme management
function initTheme() {
    const saved = localStorage.getItem('songbook-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    setTheme(theme);
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('songbook-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
}

// Favorites management
function saveFavorites() {
    localStorage.setItem('songbook-favorites', JSON.stringify([...favorites]));
    updateFavoritesCount();
}

function updateFavoritesCount() {
    // Update sidebar favorites count
    if (navFavoritesCount) {
        if (favorites.size > 0) {
            navFavoritesCount.textContent = favorites.size;
            navFavoritesCount.classList.remove('hidden');
        } else {
            navFavoritesCount.classList.add('hidden');
        }
    }
}

function isFavorite(songId) {
    return favorites.has(songId);
}

function toggleFavorite(songId) {
    const isAdding = !favorites.has(songId);

    if (isAdding) {
        favorites.add(songId);
    } else {
        favorites.delete(songId);
    }

    // Save locally immediately
    saveFavorites();
    updateFavoriteButton();

    // Sync to cloud in background (optimistic UI)
    syncFavoriteToCloud(songId, isAdding);

    // Update result list if visible
    if (!resultsDiv.classList.contains('hidden')) {
        const item = resultsDiv.querySelector(`[data-id="${songId}"]`);
        if (item) {
            item.classList.toggle('is-favorite', favorites.has(songId));
        }
    }
}

// Sync a single favorite change to cloud (non-blocking)
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

// Full sync: merge localStorage with cloud
async function performFullSync() {
    if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
        isCloudSyncEnabled = false;
        return;
    }

    syncInProgress = true;
    updateSyncUI('syncing');

    try {
        const localFavs = [...favorites];
        const { data: merged, error } = await SupabaseAuth.syncFavoritesToCloud(localFavs);

        if (error) {
            throw error;
        }

        // Update local favorites with merged set
        favorites = new Set(merged);
        saveFavorites();

        isCloudSyncEnabled = true;
        updateSyncUI('synced');

    } catch (err) {
        console.error('Full sync failed:', err);
        updateSyncUI('error');
        // Keep using local favorites
    } finally {
        syncInProgress = false;
    }
}

// Update sync indicator in UI
function updateSyncUI(status) {
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

function updateFavoriteButton() {
    // Legacy function - favoriteBtn no longer exists
    // Favorites checkbox in list picker is updated by renderListPickerDropdown()
}

function showFavorites() {
    showingFavorites = true;
    if (navFavorites) navFavorites.classList.add('active');
    if (navSearch) navSearch.classList.remove('active');
    const favSongs = allSongs.filter(s => favorites.has(s.id));
    searchStats.textContent = `${favSongs.length} favorite${favSongs.length !== 1 ? 's' : ''}`;
    searchInput.value = '';
    renderResults(favSongs, '');
}

function hideFavorites() {
    showingFavorites = false;
    if (navFavorites) navFavorites.classList.remove('active');
    if (navSearch) navSearch.classList.add('active');
    showRandomSongs();
}

// ============================================
// USER LISTS MANAGEMENT
// ============================================

function saveLists() {
    localStorage.setItem('songbook-lists', JSON.stringify(userLists));
    renderSidebarLists();
}

function generateLocalId() {
    return 'local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function createList(name) {
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

    // Sync to cloud if logged in
    syncListToCloud(newList, 'create');

    return newList;
}

function renameList(listId, newName) {
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

function deleteList(listId) {
    const index = userLists.findIndex(l => l.id === listId);
    if (index === -1) return false;

    const list = userLists[index];
    userLists.splice(index, 1);
    saveLists();

    // Sync to cloud
    if (list.cloudId) {
        syncListToCloud(list, 'delete');
    }

    return true;
}

function addSongToList(listId, songId) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return false;

    if (!list.songs.includes(songId)) {
        list.songs.push(songId);
        saveLists();

        // Sync to cloud
        if (list.cloudId && isCloudSyncEnabled) {
            SupabaseAuth.addToCloudList(list.cloudId, songId).catch(console.error);
        }
    }

    return true;
}

function removeSongFromList(listId, songId) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return false;

    const index = list.songs.indexOf(songId);
    if (index !== -1) {
        list.songs.splice(index, 1);
        saveLists();

        // Sync to cloud
        if (list.cloudId && isCloudSyncEnabled) {
            SupabaseAuth.removeFromCloudList(list.cloudId, songId).catch(console.error);
        }
    }

    return true;
}

function isSongInList(listId, songId) {
    const list = userLists.find(l => l.id === listId);
    return list ? list.songs.includes(songId) : false;
}

function isSongInAnyList(songId) {
    return userLists.some(l => l.songs.includes(songId));
}

// Sync a single list change to cloud
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

// Full sync: merge localStorage lists with cloud
async function performFullListsSync() {
    if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
        return;
    }

    try {
        const { data: merged, error } = await SupabaseAuth.syncListsToCloud(userLists);
        if (error) throw error;

        // Update local lists with merged data
        userLists = merged.map(cloudList => ({
            id: cloudList.id,
            name: cloudList.name,
            songs: cloudList.songs || [],
            cloudId: cloudList.id
        }));
        saveLists();

        // Update sync UI to show lists count
        if (isCloudSyncEnabled) {
            updateSyncUI('synced');
        }
    } catch (err) {
        console.error('Lists sync failed:', err);
    }
}

// Render lists in sidebar
function renderSidebarLists() {
    if (!navListsContainer) return;

    navListsContainer.innerHTML = '';

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
        navListsContainer.appendChild(btn);
    });
}

// Show songs in a specific list
function showListView(listId) {
    const list = userLists.find(l => l.id === listId);
    if (!list) return;

    viewingListId = listId;
    showingFavorites = false;
    closeSidebar();

    // Update nav active states
    if (navSearch) navSearch.classList.remove('active');
    if (navFavorites) navFavorites.classList.remove('active');
    if (navAddSong) navAddSong.classList.remove('active');

    // Update sidebar list buttons
    navListsContainer.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.listId === listId);
    });

    // Show the list songs
    const listSongs = allSongs.filter(s => list.songs.includes(s.id));
    searchStats.textContent = `${list.name}: ${listSongs.length} song${listSongs.length !== 1 ? 's' : ''}`;
    searchInput.value = '';
    renderResults(listSongs, '');

    // Show search container/results
    const searchContainer = document.querySelector('.search-container');
    const editorPanel = document.getElementById('editor-panel');
    searchContainer.classList.remove('hidden');
    resultsDiv.classList.remove('hidden');
    if (editorPanel) editorPanel.classList.add('hidden');
    songView.classList.add('hidden');
}

// Clear list view state
function clearListView() {
    viewingListId = null;
    navListsContainer.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
}

// Render list picker dropdown
function renderListPickerDropdown() {
    if (!customListsContainer || !currentSong) return;

    customListsContainer.innerHTML = '';

    userLists.forEach(list => {
        const label = document.createElement('label');
        label.className = 'list-option';
        const isInList = list.songs.includes(currentSong.id);
        label.innerHTML = `
            <input type="checkbox" data-list-id="${list.id}" ${isInList ? 'checked' : ''}>
            <span>&#9776;</span>
            <span>${escapeHtml(list.name)}</span>
        `;
        customListsContainer.appendChild(label);
    });

    // Update favorites checkbox
    if (favoritesCheckbox) {
        favoritesCheckbox.checked = isFavorite(currentSong.id);
    }

    // Update picker button state
    updateListPickerButton();
}

function updateListPickerButton() {
    if (!listPickerBtn || !currentSong) return;

    const inFavorites = isFavorite(currentSong.id);
    const inAnyList = isSongInAnyList(currentSong.id);

    listPickerBtn.classList.toggle('has-lists', inFavorites || inAnyList);
}

// Floating list picker for search results
let activeResultPicker = null;

function showResultListPicker(btn, songId) {
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

function closeResultListPicker() {
    if (activeResultPicker) {
        activeResultPicker.element.remove();
        activeResultPicker = null;
    }
}

function updateResultListButton(btn, songId) {
    const inFavorites = isFavorite(songId);
    const inAnyList = isSongInAnyList(songId);
    btn.classList.toggle('has-lists', inFavorites || inAnyList);

    // Also update the result item's favorite class
    const resultItem = btn.closest('.result-item');
    if (resultItem) {
        resultItem.classList.toggle('is-favorite', inFavorites);
    }
}

// Close result picker when clicking outside
document.addEventListener('click', (e) => {
    if (activeResultPicker) {
        if (!activeResultPicker.element.contains(e.target) && e.target !== activeResultPicker.btn) {
            closeResultListPicker();
        }
    }
});

// Render manage lists modal
function renderListsModal() {
    if (!listsContainer) return;

    if (userLists.length === 0) {
        listsContainer.innerHTML = '<p class="lists-empty">No lists yet. Create one above!</p>';
        return;
    }

    listsContainer.innerHTML = '';

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
        listsContainer.appendChild(div);
    });

    // Add event listeners
    listsContainer.querySelectorAll('.rename-list-btn').forEach(btn => {
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

    listsContainer.querySelectorAll('.delete-list-btn').forEach(btn => {
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

// Load the song index
async function loadIndex() {
    resultsDiv.innerHTML = '<div class="loading">Loading songbook...</div>';

    try {
        const response = await fetch('data/index.jsonl');
        const text = await response.text();
        allSongs = text.trim().split('\n').map(line => JSON.parse(line));

        // Build song groups for version detection
        songGroups = {};
        allSongs.forEach(song => {
            const groupId = song.group_id;
            if (groupId) {
                if (!songGroups[groupId]) {
                    songGroups[groupId] = [];
                }
                songGroups[groupId].push(song);
            }
        });

        // Update subtitle with distinct song count
        const distinctTitles = new Set(allSongs.map(s => s.title?.toLowerCase())).size;
        const subtitle = document.getElementById('subtitle');
        if (subtitle) {
            subtitle.textContent = `${distinctTitles.toLocaleString()} songs with chords`;
        }

        resultsDiv.innerHTML = '';
        searchStats.textContent = `${allSongs.length.toLocaleString()} songs loaded`;

        // Enable browser history navigation
        historyInitialized = true;

        // Handle deep links or show default view
        if (!handleDeepLink()) {
            showRandomSongs();
            searchInput.focus();
            // Set initial history state
            history.replaceState({ view: 'search' }, '', window.location.pathname);
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="loading">Error loading songbook: ${error.message}</div>`;
    }
}

// Show random songs on initial load
function showRandomSongs() {
    const shuffled = [...allSongs].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, 20);
    searchStats.textContent = `${allSongs.length.toLocaleString()} songs`;
    renderResults(sample, '');
}

// Parse search query for special modifiers
function parseSearchQuery(query) {
    const result = {
        textTerms: [],
        chordFilters: [],      // e.g., ['VII', 'II']
        progressionFilter: null // e.g., ['ii', 'V', 'I']
    };

    const tokens = query.split(/\s+/);

    for (const token of tokens) {
        if (token.startsWith('chord:') || token.startsWith('c:')) {
            const chords = token.replace(/^(chord:|c:)/, '').split(',');
            result.chordFilters.push(...chords.filter(c => c));
        } else if (token.startsWith('prog:') || token.startsWith('p:')) {
            const prog = token.replace(/^(prog:|p:)/, '').split('-');
            result.progressionFilter = prog.filter(c => c);
        } else if (token) {
            result.textTerms.push(token.toLowerCase());
        }
    }

    return result;
}

// Check if song contains all required Nashville chords (uses precomputed data)
// Case-sensitive: ii (minor) != II (major)
function songHasChords(song, requiredChords) {
    if (!requiredChords.length) return true;

    // Use precomputed nashville array from index
    const chords = song.nashville || [];
    if (!chords.length) return false;

    return requiredChords.every(req => chords.includes(req));
}

// Check if song contains progression (uses precomputed data)
// Case-sensitive: ii-V-I != II-v-i
function songHasProgression(song, progression) {
    if (!progression || !progression.length) return true;

    // Use precomputed progression array from index
    const sequence = song.progression || [];
    if (!sequence.length) return false;

    // Look for exact progression anywhere in sequence
    for (let i = 0; i <= sequence.length - progression.length; i++) {
        let match = true;
        for (let j = 0; j < progression.length; j++) {
            if (sequence[i + j] !== progression[j]) {
                match = false;
                break;
            }
        }
        if (match) return true;
    }

    return false;
}

// Search songs
function search(query) {
    showingFavorites = false;
    if (navFavorites) navFavorites.classList.remove('active');
    if (navSearch) navSearch.classList.add('active');

    if (!query.trim()) {
        showRandomSongs();
        return;
    }

    const { textTerms, chordFilters, progressionFilter } = parseSearchQuery(query);

    const results = allSongs.filter(song => {
        // Text search
        if (textTerms.length > 0) {
            const searchText = [
                song.title || '',
                song.artist || '',
                song.composer || '',
                song.lyrics || '',
                song.first_line || ''
            ].join(' ').toLowerCase();

            if (!textTerms.every(term => searchText.includes(term))) {
                return false;
            }
        }

        // Chord search
        if (chordFilters.length > 0) {
            if (!songHasChords(song, chordFilters)) return false;
        }

        // Progression search
        if (progressionFilter && progressionFilter.length > 0) {
            if (!songHasProgression(song, progressionFilter)) return false;
        }

        return true;
    });

    // Sort by relevance (for text searches)
    const textQuery = textTerms.join(' ');
    results.sort((a, b) => {
        const aTitle = (a.title || '').toLowerCase();
        const bTitle = (b.title || '').toLowerCase();
        const aArtist = (a.artist || '').toLowerCase();
        const bArtist = (b.artist || '').toLowerCase();

        if (textQuery) {
            if (aTitle === textQuery && bTitle !== textQuery) return -1;
            if (bTitle === textQuery && aTitle !== textQuery) return 1;
            if (aTitle.startsWith(textQuery) && !bTitle.startsWith(textQuery)) return -1;
            if (bTitle.startsWith(textQuery) && !aTitle.startsWith(textQuery)) return 1;
            if (aTitle.includes(textQuery) && !bTitle.includes(textQuery)) return -1;
            if (bTitle.includes(textQuery) && !aTitle.includes(textQuery)) return 1;
            if (aArtist.includes(textQuery) && !bArtist.includes(textQuery)) return -1;
            if (bArtist.includes(textQuery) && !aArtist.includes(textQuery)) return 1;
        }

        return 0;
    });

    // Update stats with search info
    let statsText = `${results.length.toLocaleString()} songs`;
    if (chordFilters.length > 0) {
        statsText += ` with ${chordFilters.join(', ')}`;
    }
    if (progressionFilter && progressionFilter.length > 0) {
        statsText += ` with ${progressionFilter.join('-')} progression`;
    }
    searchStats.textContent = statsText;

    renderResults(results.slice(0, 50), textQuery);
}

// Render search results
function renderResults(songs, query) {
    if (songs.length === 0) {
        resultsDiv.innerHTML = '<div class="loading">No songs found</div>';
        return;
    }

    // Group songs and dedupe by group_id (show one representative per group)
    const seenGroups = new Set();
    const dedupedSongs = [];

    for (const song of songs) {
        const groupId = song.group_id;
        if (groupId && seenGroups.has(groupId)) {
            continue;  // Skip, we already have a song from this group
        }
        if (groupId) {
            seenGroups.add(groupId);
        }
        dedupedSongs.push(song);
    }

    resultsDiv.innerHTML = dedupedSongs.map(song => {
        const favClass = isFavorite(song.id) ? 'is-favorite' : '';
        const inList = isSongInAnyList(song.id);
        const btnClass = (isFavorite(song.id) || inList) ? 'has-lists' : '';

        // Check for multiple versions
        const groupId = song.group_id;
        const versions = groupId ? (songGroups[groupId] || []) : [];
        const versionCount = versions.length;
        const versionBadge = versionCount > 1
            ? `<span class="version-badge" data-group-id="${groupId}">${versionCount} versions</span>`
            : '';

        return `
            <div class="result-item ${favClass}" data-id="${song.id}" data-group-id="${groupId || ''}">
                <div class="result-main">
                    <div class="result-title">${highlightMatch(song.title || 'Unknown', query)}${versionBadge}</div>
                    <div class="result-artist">${highlightMatch(song.artist || 'Unknown artist', query)}</div>
                    <div class="result-preview">${song.first_line || ''}</div>
                </div>
                <button class="result-list-btn ${btnClass}" data-song-id="${song.id}" title="Add to list">+</button>
            </div>
        `;
    }).join('');

    // Click on result item opens song (or version picker if multiple versions)
    resultsDiv.querySelectorAll('.result-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't open song if clicking the list button
            if (e.target.classList.contains('result-list-btn')) return;

            const groupId = item.dataset.groupId;
            const versions = groupId ? (songGroups[groupId] || []) : [];

            if (versions.length > 1) {
                // Show version picker
                showVersionPicker(groupId);
            } else {
                // Open song directly
                openSong(item.dataset.id);
            }
        });
    });

    // Click on list button shows picker
    resultsDiv.querySelectorAll('.result-list-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showResultListPicker(btn, btn.dataset.songId);
        });
    });
}

// Version picker modal
const versionModal = document.getElementById('version-modal');
const versionModalClose = document.getElementById('version-modal-close');
const versionModalTitle = document.getElementById('version-modal-title');
const versionList = document.getElementById('version-list');

// Show version picker for a song group
async function showVersionPicker(groupId) {
    const versions = songGroups[groupId] || [];
    if (versions.length === 0) return;

    // Get vote counts for this group
    let voteCounts = {};
    let userVotes = {};

    if (typeof SupabaseAuth !== 'undefined') {
        const { data } = await SupabaseAuth.fetchGroupVotes(groupId);
        voteCounts = data || {};

        if (SupabaseAuth.isLoggedIn()) {
            const songIds = versions.map(v => v.id);
            const { data: uv } = await SupabaseAuth.fetchUserVotes(songIds);
            userVotes = uv || {};
        }
    }

    // Sort versions by vote count (highest first)
    const sortedVersions = [...versions].sort((a, b) => {
        return (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0);
    });

    // Update modal title
    versionModalTitle.textContent = versions[0].title || 'Select Version';

    // Render version list
    const currentSongId = currentSong?.id;
    versionList.innerHTML = sortedVersions.map(song => {
        const voteCount = voteCounts[song.id] || 0;
        const hasVoted = userVotes[song.id] ? 'voted' : '';
        const isCurrent = song.id === currentSongId;
        const versionLabel = song.version_label || (song.key ? `Key of ${song.key}` : 'Original');
        const versionMeta = [
            song.arrangement_by ? `by ${song.arrangement_by}` : '',
            song.key ? `Key: ${song.key}` : '',
            song.version_type ? song.version_type : '',
            song.nashville ? `${song.nashville.length} chords` : ''
        ].filter(Boolean).join(' • ');

        // Show first line to help distinguish versions
        const firstLine = song.first_line ? song.first_line.substring(0, 60) + (song.first_line.length > 60 ? '...' : '') : '';

        return `
            <div class="version-item ${isCurrent ? 'current' : ''}" data-song-id="${song.id}" data-group-id="${groupId}">
                <div class="version-info">
                    <div class="version-label">${escapeHtml(versionLabel)}${isCurrent ? '<span class="current-badge">viewing</span>' : ''}</div>
                    <div class="version-meta">${escapeHtml(versionMeta)}</div>
                    ${firstLine ? `<div class="version-first-line">"${escapeHtml(firstLine)}"</div>` : ''}
                    ${song.version_notes ? `<div class="version-notes">${escapeHtml(song.version_notes)}</div>` : ''}
                </div>
                <div class="version-votes">
                    <button class="vote-btn ${hasVoted}" data-song-id="${song.id}" data-group-id="${groupId}" title="Vote for this version">
                        <span class="vote-arrow">▲</span>
                    </button>
                    <span class="vote-count">${voteCount}</span>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers for version items
    versionList.querySelectorAll('.version-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't open song if clicking vote button
            if (e.target.closest('.vote-btn')) return;
            closeVersionPicker();
            openSong(item.dataset.songId);
        });
    });

    // Add click handlers for vote buttons
    versionList.querySelectorAll('.vote-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();

            if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
                alert('Please sign in to vote');
                return;
            }

            const songId = btn.dataset.songId;
            const groupId = btn.dataset.groupId;
            const hasVoted = btn.classList.contains('voted');

            if (hasVoted) {
                // Remove vote
                await SupabaseAuth.removeVote(songId);
                btn.classList.remove('voted');
                const countEl = btn.nextElementSibling;
                countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1);
            } else {
                // Cast vote
                await SupabaseAuth.castVote(songId, groupId);
                btn.classList.add('voted');
                const countEl = btn.nextElementSibling;
                countEl.textContent = parseInt(countEl.textContent) + 1;
            }
        });
    });

    // Show modal
    versionModal.classList.remove('hidden');
}

function closeVersionPicker() {
    versionModal.classList.add('hidden');
}

// Version modal close handlers
if (versionModalClose) {
    versionModalClose.addEventListener('click', closeVersionPicker);
}
if (versionModal) {
    versionModal.addEventListener('click', (e) => {
        if (e.target === versionModal) closeVersionPicker();
    });
}

// Highlight matching text
function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);

    const escaped = escapeHtml(text);
    const terms = query.toLowerCase().split(/\s+/);

    let result = escaped;
    terms.forEach(term => {
        if (term) {
            const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
            result = result.replace(regex, '<mark>$1</mark>');
        }
    });

    return result;
}

// Open a song
async function openSong(songId) {
    pushHistoryState('song', { songId });

    songView.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    document.querySelector('.search-container').classList.add('hidden');

    // Reset key tracking for new song
    originalDetectedKey = null;
    originalDetectedMode = null;
    currentDetectedKey = null;

    const song = allSongs.find(s => s.id === songId);
    currentSong = song;

    // Track song view in Google Analytics
    if (typeof gtag === 'function' && song) {
        gtag('event', 'page_view', {
            page_title: `${song.title} - ${song.artist || 'Unknown'}`,
            page_location: `${window.location.origin}/song/${songId}`,
            page_path: `/song/${songId}`
        });
    }
    updateFavoriteButton();
    updateListPickerButton();

    if (song && song.content) {
        currentChordpro = song.content;
        renderSong(song, song.content, true);
        return;
    }

    songContent.innerHTML = '<div class="loading">Loading song...</div>';

    try {
        let response = await fetch(`data/sources/${songId}.pro`);
        if (!response.ok) {
            response = await fetch(`../sources/classic-country/parsed/${songId}.pro`);
        }
        const chordpro = await response.text();
        currentChordpro = chordpro;
        renderSong(song, chordpro, true);
    } catch (error) {
        songContent.innerHTML = `<div class="loading">Error loading song: ${error.message}</div>`;
    }
}

// Parse ChordPro content into structured sections
function parseChordPro(chordpro) {
    const lines = chordpro.split('\n');
    const metadata = {};
    const sections = [];
    let currentSection = null;

    for (const line of lines) {
        const metaMatch = line.match(/\{meta:\s*(\w+)\s+([^}]+)\}/);
        if (metaMatch) {
            const [, key, value] = metaMatch;
            metadata[key.toLowerCase()] = value;
            continue;
        }

        const sectionMatch = line.match(/\{start_of_(verse|chorus|bridge)(?::\s*([^}]+))?\}/);
        if (sectionMatch) {
            const [, type, label] = sectionMatch;
            currentSection = {
                type: type,
                label: label || type.charAt(0).toUpperCase() + type.slice(1),
                lines: []
            };
            sections.push(currentSection);
            continue;
        }

        if (line.match(/\{end_of_(verse|chorus|bridge)\}/)) {
            currentSection = null;
            continue;
        }

        if (line.match(/^\{.*\}$/)) {
            continue;
        }

        if (currentSection && line.trim()) {
            currentSection.lines.push(line);
        }
    }

    return { metadata, sections };
}

// Key detection using diatonic chord analysis
// Major keys: I, ii, iii, IV, V, vi, vii°
// Minor keys (natural): i, ii°, III, iv, v, VI, VII
const KEYS = {
    // Major keys
    'C':  { scale: ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'], tonic: 'C', mode: 'major', relative: 'Am' },
    'G':  { scale: ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'], tonic: 'G', mode: 'major', relative: 'Em' },
    'D':  { scale: ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim'], tonic: 'D', mode: 'major', relative: 'Bm' },
    'A':  { scale: ['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim'], tonic: 'A', mode: 'major', relative: 'F#m' },
    'E':  { scale: ['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim'], tonic: 'E', mode: 'major', relative: 'C#m' },
    'B':  { scale: ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m', 'A#dim'], tonic: 'B', mode: 'major', relative: 'G#m' },
    'F#': { scale: ['F#', 'G#m', 'A#m', 'B', 'C#', 'D#m', 'E#dim'], tonic: 'F#', mode: 'major', relative: 'D#m' },
    'F':  { scale: ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim'], tonic: 'F', mode: 'major', relative: 'Dm' },
    'Bb': { scale: ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim'], tonic: 'Bb', mode: 'major', relative: 'Gm' },
    'Eb': { scale: ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim'], tonic: 'Eb', mode: 'major', relative: 'Cm' },
    'Ab': { scale: ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm', 'Gdim'], tonic: 'Ab', mode: 'major', relative: 'Fm' },
    'Db': { scale: ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm', 'Cdim'], tonic: 'Db', mode: 'major', relative: 'Bbm' },
    // Minor keys (natural minor - same chords as relative major, different tonic)
    'Am':  { scale: ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G'], tonic: 'Am', mode: 'minor', relative: 'C' },
    'Em':  { scale: ['Em', 'F#dim', 'G', 'Am', 'Bm', 'C', 'D'], tonic: 'Em', mode: 'minor', relative: 'G' },
    'Bm':  { scale: ['Bm', 'C#dim', 'D', 'Em', 'F#m', 'G', 'A'], tonic: 'Bm', mode: 'minor', relative: 'D' },
    'F#m': { scale: ['F#m', 'G#dim', 'A', 'Bm', 'C#m', 'D', 'E'], tonic: 'F#m', mode: 'minor', relative: 'A' },
    'C#m': { scale: ['C#m', 'D#dim', 'E', 'F#m', 'G#m', 'A', 'B'], tonic: 'C#m', mode: 'minor', relative: 'E' },
    'G#m': { scale: ['G#m', 'A#dim', 'B', 'C#m', 'D#m', 'E', 'F#'], tonic: 'G#m', mode: 'minor', relative: 'B' },
    'D#m': { scale: ['D#m', 'E#dim', 'F#', 'G#m', 'A#m', 'B', 'C#'], tonic: 'D#m', mode: 'minor', relative: 'F#' },
    'Dm':  { scale: ['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C'], tonic: 'Dm', mode: 'minor', relative: 'F' },
    'Gm':  { scale: ['Gm', 'Adim', 'Bb', 'Cm', 'Dm', 'Eb', 'F'], tonic: 'Gm', mode: 'minor', relative: 'Bb' },
    'Cm':  { scale: ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb'], tonic: 'Cm', mode: 'minor', relative: 'Eb' },
    'Fm':  { scale: ['Fm', 'Gdim', 'Ab', 'Bbm', 'Cm', 'Db', 'Eb'], tonic: 'Fm', mode: 'minor', relative: 'Ab' },
    'Bbm': { scale: ['Bbm', 'Cdim', 'Db', 'Ebm', 'Fm', 'Gb', 'Ab'], tonic: 'Bbm', mode: 'minor', relative: 'Db' },
};

// Nashville numbers for major keys (I, ii, iii, IV, V, vi, vii°)
const NASHVILLE_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
// Nashville numbers for minor keys (i, ii°, III, iv, v, VI, VII)
const NASHVILLE_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

// Chromatic scale for interval calculation
const CHROMATIC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Normalize enharmonic equivalents
const ENHARMONIC = {
    'C#': 'Db', 'D#': 'Eb', 'E#': 'F', 'Fb': 'E',
    'G#': 'Ab', 'A#': 'Bb', 'B#': 'C', 'Cb': 'B',
    'F#': 'Gb', // For chromatic lookup
};

// Normalize a chord to root + basic quality (major, minor, dim)
function normalizeChord(chord) {
    if (!chord) return null;

    const rootMatch = chord.match(/^([A-G][#b]?)/);
    if (!rootMatch) return null;

    let root = rootMatch[1];
    const rest = chord.slice(root.length).toLowerCase();

    // Normalize enharmonics (except F# which we keep for key names)
    if (ENHARMONIC[root] && root !== 'F#') {
        root = ENHARMONIC[root];
    }

    let quality = '';
    if (rest.startsWith('m') && !rest.startsWith('maj')) {
        quality = 'm';
    } else if (rest.includes('dim') || rest === 'o' || rest.startsWith('o7')) {
        quality = 'dim';
    }

    return root + quality;
}

// Get just the root of a chord
function getChordRoot(chord) {
    if (!chord) return null;
    const match = chord.match(/^([A-G][#b]?)/);
    if (!match) return null;
    let root = match[1];
    if (ENHARMONIC[root] && root !== 'F#') {
        root = ENHARMONIC[root];
    }
    return root;
}

// Get chord quality (major, minor, dim)
function getChordQuality(chord) {
    if (!chord) return 'major';
    const root = chord.match(/^[A-G][#b]?/);
    if (!root) return 'major';
    const rest = chord.slice(root[0].length);
    if (rest === 'm' || rest.startsWith('m')) return 'minor';
    if (rest === 'dim' || rest.includes('dim')) return 'dim';
    return 'major';
}

// Extract all chords from chordpro content
function extractChords(chordpro) {
    const chordRegex = /\[([^\]]+)\]/g;
    const chords = [];
    let match;

    while ((match = chordRegex.exec(chordpro)) !== null) {
        chords.push(match[1]); // Keep original for Nashville conversion
    }

    return chords;
}

// Detect key from chord list
function detectKey(chords) {
    if (!chords || chords.length === 0) {
        return { key: null, mode: null, confidence: 0 };
    }

    // Normalize and count chords
    const chordCounts = {};
    for (const chord of chords) {
        const normalized = normalizeChord(chord);
        if (normalized) {
            chordCounts[normalized] = (chordCounts[normalized] || 0) + 1;
        }
    }

    const totalChords = chords.length;

    // Score each possible key
    const scores = {};

    for (const [keyName, keyInfo] of Object.entries(KEYS)) {
        const normalizedScale = new Set(keyInfo.scale.map(c => normalizeChord(c)));
        const normalizedTonic = normalizeChord(keyInfo.tonic);

        let matchWeight = 0;
        let tonicWeight = 0;

        for (const [chord, count] of Object.entries(chordCounts)) {
            if (normalizedScale.has(chord)) {
                matchWeight += count;
                // Extra weight for tonic chord
                if (chord === normalizedTonic) {
                    tonicWeight += count * 0.5; // 50% bonus for tonic
                }
            }
        }

        scores[keyName] = (matchWeight + tonicWeight) / totalChords;
    }

    // Find best key
    let bestKey = null;
    let bestScore = 0;

    for (const [key, score] of Object.entries(scores)) {
        if (score > bestScore) {
            bestScore = score;
            bestKey = key;
        }
    }

    // For relative major/minor pairs with similar scores, check tonic frequency
    if (bestKey && KEYS[bestKey]) {
        const relative = KEYS[bestKey].relative;
        if (relative && scores[relative]) {
            const scoreDiff = Math.abs(scores[bestKey] - scores[relative]);
            // If scores are close, prefer the one with more tonic occurrences
            if (scoreDiff < 0.1) {
                const bestTonic = normalizeChord(KEYS[bestKey].tonic);
                const relativeTonic = normalizeChord(KEYS[relative].tonic);
                const bestTonicCount = chordCounts[bestTonic] || 0;
                const relativeTonicCount = chordCounts[relativeTonic] || 0;

                if (relativeTonicCount > bestTonicCount) {
                    bestKey = relative;
                    bestScore = scores[relative];
                }
            }
        }
    }

    // Prefer common keys when scores are very close
    const preferredOrder = ['G', 'C', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'F', 'Bm', 'Bb', 'Eb'];
    for (const key of preferredOrder) {
        if (scores[key] && scores[key] >= bestScore - 0.03) {
            bestKey = key;
            bestScore = scores[key];
            break;
        }
    }

    return {
        key: bestKey,
        mode: bestKey ? KEYS[bestKey].mode : null,
        confidence: Math.round((bestScore / 1.5) * 100) // Normalize since we added tonic bonus
    };
}

// Convert a chord to Nashville number given a key
function toNashville(chord, keyName) {
    if (!chord || !keyName || !KEYS[keyName]) return chord;

    const keyInfo = KEYS[keyName];
    const chordRoot = getChordRoot(chord);
    const chordQuality = getChordQuality(chord);

    if (!chordRoot) return chord;

    // Extract extension (7, maj7, sus4, etc.) to preserve it
    const rootMatch = chord.match(/^[A-G][#b]?/);
    const afterRoot = rootMatch ? chord.slice(rootMatch[0].length) : '';
    // Get extension after quality indicator (m, dim, etc.)
    let extension = '';
    if (afterRoot.startsWith('m') && !afterRoot.startsWith('maj')) {
        extension = afterRoot.slice(1); // After 'm'
    } else if (afterRoot.includes('dim')) {
        extension = afterRoot.replace(/dim/, '');
    } else {
        extension = afterRoot; // No quality prefix, rest is extension
    }
    // Clean up extension - remove leading quality markers that might remain
    extension = extension.replace(/^(aj|in)/, '');

    // Get the key's tonic root
    const tonicRoot = getChordRoot(keyInfo.tonic);
    if (!tonicRoot) return chord;

    // Find interval (semitones from tonic)
    let tonicIndex = CHROMATIC.indexOf(tonicRoot);
    let chordIndex = CHROMATIC.indexOf(chordRoot);

    // Handle F# specially
    if (tonicRoot === 'F#' || tonicRoot === 'Gb') tonicIndex = 6;
    if (chordRoot === 'F#' || chordRoot === 'Gb') chordIndex = 6;

    if (tonicIndex === -1 || chordIndex === -1) return chord;

    const interval = (chordIndex - tonicIndex + 12) % 12;

    // Map interval to scale degree
    const intervalToScaleDegree = {
        0: 0,   // I/i
        2: 1,   // ii/ii°
        3: 2,   // iii (minor) or bIII (from minor key)
        4: 2,   // iii (major)
        5: 3,   // IV/iv
        7: 4,   // V/v
        8: 5,   // vi (minor) or bVI
        9: 5,   // vi (major)
        10: 6,  // bVII
        11: 6,  // vii°
    };

    const scaleDegree = intervalToScaleDegree[interval];
    if (scaleDegree === undefined) {
        // Non-diatonic - just show the interval
        const symbols = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
        let num = symbols[interval];
        if (chordQuality === 'minor') num = num.toLowerCase();
        if (chordQuality === 'dim') num = num.toLowerCase() + '°';
        return num + extension;
    }

    // Get the Nashville number based on key mode
    const nashville = keyInfo.mode === 'minor' ? NASHVILLE_MINOR : NASHVILLE_MAJOR;
    let num = nashville[scaleDegree];

    // Adjust for actual chord quality vs expected
    const expectedQuality = num === num.toLowerCase() ? 'minor' : 'major';
    if (num.includes('°')) {
        // Expected diminished
        if (chordQuality === 'major') num = num.replace('°', '').toUpperCase();
        if (chordQuality === 'minor') num = num.replace('°', '');
    } else if (chordQuality === 'dim') {
        num = num.toLowerCase() + '°';
    } else if (chordQuality === 'minor' && expectedQuality === 'major') {
        num = num.toLowerCase();
    } else if (chordQuality === 'major' && expectedQuality === 'minor') {
        num = num.toUpperCase();
    }

    return num + extension;
}

// Transpose a chord by a number of semitones
function transposeChord(chord, semitones) {
    if (!chord || semitones === 0) return chord;

    // Normalize semitones to 0-11
    semitones = ((semitones % 12) + 12) % 12;
    if (semitones === 0) return chord;

    // Parse the chord: root, quality, bass note
    const match = chord.match(/^([A-G][#b]?)(.*)$/);
    if (!match) return chord;

    let [, root, rest] = match;

    // Check for slash chord
    let bassNote = null;
    const slashMatch = rest.match(/^(.*)\/([A-G][#b]?)$/);
    if (slashMatch) {
        rest = slashMatch[1];
        bassNote = slashMatch[2];
    }

    // Transpose root
    const transposedRoot = transposeNote(root, semitones);

    // Transpose bass note if present
    const transposedBass = bassNote ? transposeNote(bassNote, semitones) : null;

    // Rebuild chord
    let result = transposedRoot + rest;
    if (transposedBass) {
        result += '/' + transposedBass;
    }

    return result;
}

// Transpose a single note by semitones
function transposeNote(note, semitones) {
    // Use sharps for upward transposition, flats for keys that prefer flats
    const sharpNotes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const flatNotes = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

    // Normalize the input note
    let normalized = note;
    const noteMap = {
        'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
        'E': 4, 'Fb': 4, 'E#': 5, 'F': 5, 'F#': 6, 'Gb': 6,
        'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10,
        'B': 11, 'Cb': 11, 'B#': 0
    };

    const noteIndex = noteMap[normalized];
    if (noteIndex === undefined) return note;

    const newIndex = (noteIndex + semitones) % 12;

    // Use flats for flat keys, sharps otherwise
    const flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm'];
    const useFlats = flatKeys.includes(currentDetectedKey);

    return useFlats ? flatNotes[newIndex] : sharpNotes[newIndex];
}

// Calculate semitones between two keys
function getSemitonesBetweenKeys(fromKey, toKey) {
    if (!fromKey || !toKey) return 0;

    // Extract root from key (handle minor keys like "Am")
    const fromRoot = fromKey.replace('m', '');
    const toRoot = toKey.replace('m', '');

    const noteMap = {
        'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
        'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
        'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
    };

    const fromIndex = noteMap[fromRoot];
    const toIndex = noteMap[toRoot];

    if (fromIndex === undefined || toIndex === undefined) return 0;

    return ((toIndex - fromIndex) + 12) % 12;
}

// Parse a line with chords into chord positions and lyrics
function parseLineWithChords(line) {
    const chords = [];
    let lyrics = '';

    const regex = /\[([^\]]+)\]/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(line)) !== null) {
        lyrics += line.slice(lastIndex, match.index);
        chords.push({
            chord: match[1],
            position: lyrics.length
        });
        lastIndex = regex.lastIndex;
    }

    lyrics += line.slice(lastIndex);
    return { chords, lyrics };
}

// Render a single line with chords above lyrics
// hideChords: force hide chords for this line (used in 'first' mode for repeated sections)
function renderLine(line, hideChords = false) {
    const { chords, lyrics } = parseLineWithChords(line);

    // No chords mode or hideChords flag - just show lyrics
    if (chords.length === 0 || chordDisplayMode === 'none' || hideChords) {
        return `<div class="song-line"><div class="lyrics-line">${escapeHtml(lyrics)}</div></div>`;
    }

    // Calculate transposition if key was changed
    const semitones = getSemitonesBetweenKeys(originalDetectedKey, currentDetectedKey);

    let chordLine = '';
    let lastPos = 0;

    for (const { chord, position } of chords) {
        // First transpose if needed
        const transposedChord = semitones !== 0 ? transposeChord(chord, semitones) : chord;

        // Then convert to Nashville if enabled
        const displayChord = nashvilleMode && currentDetectedKey
            ? toNashville(transposedChord, currentDetectedKey)
            : transposedChord;

        const spaces = Math.max(0, position - lastPos);
        chordLine += ' '.repeat(spaces) + displayChord;
        lastPos = position + displayChord.length;
    }

    return `
        <div class="song-line">
            <div class="chord-line">${escapeHtml(chordLine)}</div>
            <div class="lyrics-line">${escapeHtml(lyrics)}</div>
        </div>
    `;
}

// Extract chord pattern from a section (sequence of all chords)
function getSectionChordPattern(section) {
    const chords = [];
    for (const line of section.lines) {
        const { chords: lineChords } = parseLineWithChords(line);
        for (const { chord } of lineChords) {
            chords.push(chord);
        }
    }
    return chords.join('-');
}

// Render a section (verse, chorus, etc.)
// hideChords: if true, render without chord lines (for repeated patterns in 'first' mode)
function renderSection(section, isRepeatedSection = false, hideChords = false) {
    const lines = section.lines.map(line => renderLine(line, hideChords)).join('');
    const shouldIndent = section.type === 'chorus' || isRepeatedSection;
    const indentClass = shouldIndent ? 'section-indent' : '';
    const labelHtml = showSectionLabels ? `<div class="section-label">${escapeHtml(section.label)}</div>` : '';

    return `
        <div class="song-section ${indentClass}">
            ${labelHtml}
            <div class="section-content">${lines}</div>
        </div>
    `;
}

// Render a repeat indicator (for compact mode)
function renderRepeatIndicator(label, count, shouldIndent) {
    const indentClass = shouldIndent ? 'section-indent' : '';
    const repeatText = count > 1 ? `(Repeat ${label} ×${count})` : `(Repeat ${label})`;
    return `<div class="section-repeat ${indentClass}">${repeatText}</div>`;
}

// Render song with chords above lyrics
function renderSong(song, chordpro, isInitialRender = false) {
    // Reset seen chord patterns for 'first' mode
    seenChordPatterns.clear();

    const { metadata, sections } = parseChordPro(chordpro);

    // Use precomputed key from index if available, otherwise detect
    let detectedKey, detectedMode;
    if (song && song.key) {
        detectedKey = song.key;
        detectedMode = song.mode;
    } else {
        const chords = extractChords(chordpro);
        const detected = detectKey(chords);
        detectedKey = detected.key;
        detectedMode = detected.mode;
    }

    // Determine mode - default to major if not set
    if (!detectedMode) {
        detectedMode = detectedKey && detectedKey.endsWith('m') ? 'minor' : 'major';
    }

    // On initial render, set both original and current to detected
    // On re-render (e.g., after toggling Nashville), preserve user's key choice
    if (isInitialRender || originalDetectedKey === null) {
        originalDetectedKey = detectedKey;
        originalDetectedMode = detectedMode;
        currentDetectedKey = detectedKey;
    }

    // Ensure currentDetectedKey is valid for the available keys
    const majorKeys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'];
    const minorKeys = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm'];
    const availableKeys = originalDetectedMode === 'minor' ? minorKeys : majorKeys;

    if (!availableKeys.includes(currentDetectedKey)) {
        currentDetectedKey = originalDetectedKey || detectedKey || availableKeys[0];
    }

    const totalCounts = {};
    for (const section of sections) {
        totalCounts[section.label] = (totalCounts[section.label] || 0) + 1;
    }

    const seenSections = new Set();
    let sectionsHtml = '';
    let i = 0;

    while (i < sections.length) {
        const section = sections[i];
        const sectionKey = section.label;
        const isRepeatedSection = totalCounts[sectionKey] > 1;
        const shouldIndent = section.type === 'chorus' || isRepeatedSection;

        // In 'first' mode, check if we've seen this chord pattern before
        let hideChords = false;
        if (chordDisplayMode === 'first') {
            const chordPattern = getSectionChordPattern(section);
            if (chordPattern) {  // Only track non-empty patterns
                if (seenChordPatterns.has(chordPattern)) {
                    hideChords = true;
                } else {
                    seenChordPatterns.add(chordPattern);
                }
            }
        }

        if (!seenSections.has(sectionKey)) {
            seenSections.add(sectionKey);
            sectionsHtml += renderSection(section, isRepeatedSection, hideChords);
            i++;
        } else if (compactMode) {
            let consecutiveCount = 0;
            while (i < sections.length && sections[i].label === sectionKey) {
                consecutiveCount++;
                i++;
            }
            sectionsHtml += renderRepeatIndicator(sectionKey, consecutiveCount, shouldIndent);
        } else {
            sectionsHtml += renderSection(section, isRepeatedSection, hideChords);
            i++;
        }
    }

    const title = metadata.title || song?.title || 'Unknown Title';
    const artist = metadata.artist || song?.artist || '';
    const composer = metadata.writer || metadata.composer || song?.composer || '';
    // Only show source link for classic-country songs (they have external source URLs)
    const sourceUrl = song?.source === 'classic-country' && song?.id
        ? `https://www.classic-country-song-lyrics.com/${song.id}.html`
        : null;

    // Build key dropdown options (availableKeys already defined above)
    const keyOptions = availableKeys.map(k => {
        const isDetected = k === originalDetectedKey;
        const label = isDetected ? `${k} (detected)` : k;
        const selected = k === currentDetectedKey ? 'selected' : '';
        return `<option value="${k}" ${selected}>${label}</option>`;
    }).join('');

    // Check for multiple versions
    const groupId = song?.group_id;
    const versions = groupId ? (songGroups[groupId] || []) : [];
    const otherVersionCount = versions.length - 1;
    const versionHtml = otherVersionCount > 0
        ? `<button class="see-versions-btn" data-group-id="${groupId}">See ${otherVersionCount} other version${otherVersionCount > 1 ? 's' : ''}</button>`
        : '';

    let metaHtml = '';
    if (artist) {
        metaHtml += `<div class="meta-item"><span class="meta-label">Artist:</span> ${escapeHtml(artist)}</div>`;
    }
    if (composer) {
        metaHtml += `<div class="meta-item"><span class="meta-label">Written by:</span> ${escapeHtml(composer)}</div>`;
    }
    if (sourceUrl) {
        metaHtml += `<div class="meta-item"><span class="meta-label">Source:</span> <a href="${sourceUrl}" target="_blank" rel="noopener">${escapeHtml(song.id)}</a></div>`;
    }

    songContent.innerHTML = `
        <div class="song-header">
            <div class="song-title">${escapeHtml(title)}${versionHtml}</div>
            <div class="song-meta">${metaHtml}</div>
        </div>
        <div class="render-options">
            <div class="control-group">
                <span class="control-label">Key:</span>
                <select id="key-select" class="key-select">${keyOptions}</select>
            </div>
            <div class="font-size-control">
                <span class="control-label">Size:</span>
                <button id="font-decrease" class="font-btn" ${fontSizeLevel <= -2 ? 'disabled' : ''}>−</button>
                <button id="font-increase" class="font-btn" ${fontSizeLevel >= 2 ? 'disabled' : ''}>+</button>
            </div>
            <div class="checkbox-group">
                <span class="control-label">Show:</span>
                <label>
                    <select id="chord-mode-select" class="chord-mode-select">
                        <option value="all" ${chordDisplayMode === 'all' ? 'selected' : ''}>All Chords</option>
                        <option value="first" ${chordDisplayMode === 'first' ? 'selected' : ''}>First Only</option>
                        <option value="none" ${chordDisplayMode === 'none' ? 'selected' : ''}>No Chords</option>
                    </select>
                </label>
                <label>
                    <input type="checkbox" id="compact-checkbox" ${compactMode ? 'checked' : ''}>
                    <span>Compact</span>
                </label>
                <label>
                    <input type="checkbox" id="nashville-checkbox" ${nashvilleMode ? 'checked' : ''}>
                    <span>Nashville</span>
                </label>
                <label>
                    <input type="checkbox" id="twocol-checkbox" ${twoColumnMode ? 'checked' : ''}>
                    <span>2-Col</span>
                </label>
                <label>
                    <input type="checkbox" id="labels-checkbox" ${showSectionLabels ? 'checked' : ''}>
                    <span>Labels</span>
                </label>
                <label>
                    <input type="checkbox" id="source-checkbox" ${showChordProSource ? 'checked' : ''}>
                    <span>Source</span>
                </label>
            </div>
        </div>
        ${showChordProSource ? `
        <div class="source-view">
            <div class="source-pane">
                <div class="source-header">ChordPro Source</div>
                <pre class="chordpro-source">${escapeHtml(chordpro)}</pre>
            </div>
            <div class="rendered-pane">
                <div class="source-header">Rendered</div>
                <div class="song-body" style="font-size: ${FONT_SIZES[fontSizeLevel]}em">${sectionsHtml}</div>
            </div>
        </div>
        ` : `
        <div class="song-body ${twoColumnMode ? 'two-column' : ''}" style="font-size: ${FONT_SIZES[fontSizeLevel]}em">${sectionsHtml}</div>
        `}
    `;

    const keySelect = document.getElementById('key-select');
    if (keySelect) {
        keySelect.addEventListener('change', (e) => {
            currentDetectedKey = e.target.value;
            renderSong(song, chordpro);
        });
    }

    // Version picker button
    const seeVersionsBtn = songContent.querySelector('.see-versions-btn');
    if (seeVersionsBtn) {
        seeVersionsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showVersionPicker(seeVersionsBtn.dataset.groupId);
        });
    }

    const chordModeSelect = document.getElementById('chord-mode-select');
    if (chordModeSelect) {
        chordModeSelect.addEventListener('change', (e) => {
            chordDisplayMode = e.target.value;
            if (chordDisplayMode === 'none') showChordProSource = false;  // Mutually exclusive with Source
            renderSong(song, chordpro);
        });
    }

    const compactCheckbox = document.getElementById('compact-checkbox');
    if (compactCheckbox) {
        compactCheckbox.addEventListener('change', (e) => {
            compactMode = e.target.checked;
            if (compactMode) showChordProSource = false;  // Mutually exclusive with Source
            renderSong(song, chordpro);
        });
    }

    const nashvilleCheckbox = document.getElementById('nashville-checkbox');
    if (nashvilleCheckbox) {
        nashvilleCheckbox.addEventListener('change', (e) => {
            nashvilleMode = e.target.checked;
            if (nashvilleMode) showChordProSource = false;  // Mutually exclusive with Source
            renderSong(song, chordpro);
        });
    }

    const twocolCheckbox = document.getElementById('twocol-checkbox');
    if (twocolCheckbox) {
        twocolCheckbox.addEventListener('change', (e) => {
            twoColumnMode = e.target.checked;
            if (twoColumnMode) showChordProSource = false;  // Mutually exclusive with Source
            renderSong(song, chordpro);
        });
    }

    const labelsCheckbox = document.getElementById('labels-checkbox');
    if (labelsCheckbox) {
        labelsCheckbox.addEventListener('change', (e) => {
            showSectionLabels = e.target.checked;
            if (!showSectionLabels) showChordProSource = false;  // Mutually exclusive with Source
            renderSong(song, chordpro);
        });
    }

    const sourceCheckbox = document.getElementById('source-checkbox');
    if (sourceCheckbox) {
        sourceCheckbox.addEventListener('change', (e) => {
            showChordProSource = e.target.checked;
            // Source view shows pure render - reset all view options to defaults
            if (showChordProSource) {
                chordDisplayMode = 'all';
                showSectionLabels = true;
                compactMode = false;
                nashvilleMode = false;
                twoColumnMode = false;
            }
            renderSong(song, chordpro);
        });
    }

    const fontDecrease = document.getElementById('font-decrease');
    if (fontDecrease) {
        fontDecrease.addEventListener('click', () => {
            if (fontSizeLevel > -2) {
                fontSizeLevel--;
                renderSong(song, chordpro);
            }
        });
    }

    const fontIncrease = document.getElementById('font-increase');
    if (fontIncrease) {
        fontIncrease.addEventListener('click', () => {
            if (fontSizeLevel < 2) {
                fontSizeLevel++;
                renderSong(song, chordpro);
            }
        });
    }
}

// Go back to results
function goBack() {
    // Close list picker dropdown when navigating away
    if (listPickerDropdown) listPickerDropdown.classList.add('hidden');

    if (historyInitialized && history.state) {
        history.back();
    } else {
        // Fallback for when there's no history
        showView('search');
        pushHistoryState('search');
    }
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Track search in GA (debounced to avoid excessive events)
let searchTrackingTimeout = null;
function trackSearch(query) {
    if (searchTrackingTimeout) clearTimeout(searchTrackingTimeout);
    searchTrackingTimeout = setTimeout(() => {
        if (typeof gtag === 'function' && query.trim()) {
            gtag('event', 'search', { search_term: query.trim() });
        }
    }, 1000);
}

// Event listeners
searchInput.addEventListener('input', (e) => {
    search(e.target.value);
    trackSearch(e.target.value);
});

// Search hints click to populate
document.querySelectorAll('.search-hint').forEach(hint => {
    hint.addEventListener('click', () => {
        const current = searchInput.value.trim();
        const hintText = hint.textContent;
        searchInput.value = current ? `${current} ${hintText}` : hintText;
        searchInput.focus();
        search(searchInput.value);
    });
});

backBtn.addEventListener('click', goBack);

themeToggle.addEventListener('click', toggleTheme);

// Note: favoriteBtn removed - favorites now handled via list picker checkbox

// ============================================
// SIDEBAR NAVIGATION
// ============================================

function openSidebar() {
    if (sidebar) {
        sidebar.classList.add('open');
        sidebarBackdrop.classList.remove('hidden');
        sidebarBackdrop.classList.add('visible');
    }
}

function closeSidebar() {
    if (sidebar) {
        sidebar.classList.remove('open');
        sidebarBackdrop.classList.remove('visible');
        setTimeout(() => {
            sidebarBackdrop.classList.add('hidden');
        }, 300); // Match transition duration
    }
}

function navigateTo(mode) {
    closeSidebar();
    pushHistoryState(mode);

    // Update active nav item
    [navSearch, navAddSong, navFavorites].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });

    const searchContainer = document.querySelector('.search-container');
    const editorPanel = document.getElementById('editor-panel');

    switch (mode) {
        case 'search':
            if (navSearch) navSearch.classList.add('active');
            showingFavorites = false;
            searchContainer.classList.remove('hidden');
            resultsDiv.classList.remove('hidden');
            if (editorPanel) editorPanel.classList.add('hidden');
            songView.classList.add('hidden');
            if (aboutView) aboutView.classList.add('hidden');
            exitEditMode();
            showRandomSongs();
            searchInput.focus();
            break;

        case 'add-song':
            if (navAddSong) navAddSong.classList.add('active');
            searchContainer.classList.add('hidden');
            resultsDiv.classList.add('hidden');
            songView.classList.add('hidden');
            if (editorPanel) editorPanel.classList.remove('hidden');
            if (aboutView) aboutView.classList.add('hidden');
            exitEditMode();
            break;

        case 'favorites':
            if (navFavorites) navFavorites.classList.add('active');
            searchContainer.classList.remove('hidden');
            resultsDiv.classList.remove('hidden');
            if (editorPanel) editorPanel.classList.add('hidden');
            songView.classList.add('hidden');
            if (aboutView) aboutView.classList.add('hidden');
            showFavorites();
            break;

        case 'about':
            searchContainer.classList.add('hidden');
            resultsDiv.classList.add('hidden');
            if (editorPanel) editorPanel.classList.add('hidden');
            songView.classList.add('hidden');
            if (aboutView) aboutView.classList.remove('hidden');
            break;
    }
}

// Sidebar event listeners
if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', openSidebar);
}

if (sidebarClose) {
    sidebarClose.addEventListener('click', closeSidebar);
}

if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeSidebar);
}

if (navSearch) {
    navSearch.addEventListener('click', () => navigateTo('search'));
}

if (navAddSong) {
    navAddSong.addEventListener('click', () => navigateTo('add-song'));
}

if (navFavorites) {
    navFavorites.addEventListener('click', () => navigateTo('favorites'));
}

if (navAbout) {
    navAbout.addEventListener('click', () => navigateTo('about'));
}

if (aboutBackBtn) {
    aboutBackBtn.addEventListener('click', () => navigateTo('search'));
}

// Bug report modal elements
const bugBtn = document.getElementById('bug-btn');
const bugModal = document.getElementById('bug-modal');
const modalClose = document.getElementById('modal-close');
const bugFeedback = document.getElementById('bug-feedback');
const submitBugBtn = document.getElementById('submit-bug-btn');
const bugStatus = document.getElementById('bug-status');

function closeBugModal() {
    bugModal.classList.add('hidden');
}

// Escape key handler is defined after contact modal setup

bugBtn.addEventListener('click', () => {
    bugModal.classList.remove('hidden');
    bugFeedback.value = '';
    bugStatus.textContent = '';
    bugFeedback.focus();
});

modalClose.addEventListener('click', closeBugModal);

bugModal.addEventListener('click', (e) => {
    if (e.target === bugModal) {
        closeBugModal();
    }
});

submitBugBtn.addEventListener('click', () => {
    const feedback = bugFeedback.value.trim();
    if (!feedback) {
        bugStatus.textContent = 'Please describe the issue first';
        bugStatus.style.color = 'var(--danger)';
        return;
    }

    const song = currentSong || {};
    const songId = song.id || 'unknown';
    const title = `Bug: ${song.title || 'Unknown Song'}`;
    const body = formatBugReport(feedback);

    const params = new URLSearchParams({
        title: title,
        body: body,
        labels: 'bug'
    });

    const issueUrl = `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
    window.open(issueUrl, '_blank');
    closeBugModal();
});

function formatBugReport(feedback) {
    const song = currentSong || {};
    const songId = song.id || 'unknown';
    const source = song.source || 'unknown';

    const lines = [
        `**Song ID:** ${songId}`,
        `**Artist:** ${song.artist || 'Unknown'}`,
        `**Source:** ${source}`,
    ];

    // Add source-specific file paths
    if (source === 'classic-country') {
        lines.push(`**Parsed File:** sources/classic-country/parsed/${songId}.pro`);
        lines.push(`**Raw HTML:** sources/classic-country/raw/${songId}.html`);
    } else if (source === 'manual') {
        lines.push(`**Parsed File:** sources/manual/parsed/${songId}.pro`);
    } else {
        lines.push(`**Parsed File:** sources/${source}/parsed/${songId}.pro`);
    }

    lines.push(
        '',
        '## Issue',
        feedback,
        '',
        '## Current ChordPro Output',
        '```chordpro',
        currentChordpro || '(content not available)',
        '```',
    );

    return lines.join('\n');
}

// ============================================
// FEEDBACK DROPDOWN
// ============================================

const feedbackBtn = document.getElementById('feedback-btn');
const feedbackDropdown = document.getElementById('feedback-dropdown');

function toggleFeedbackDropdown() {
    feedbackDropdown.classList.toggle('hidden');
}

function closeFeedbackDropdown() {
    feedbackDropdown.classList.add('hidden');
}

// Toggle dropdown on button click
if (feedbackBtn) {
    feedbackBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFeedbackDropdown();
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (feedbackDropdown && !feedbackDropdown.contains(e.target) && e.target !== feedbackBtn) {
        closeFeedbackDropdown();
    }
});

// Handle feedback option clicks
document.querySelectorAll('.feedback-option[data-type]').forEach(option => {
    option.addEventListener('click', (e) => {
        const type = option.dataset.type;
        closeFeedbackDropdown();
        handleFeedbackType(type);
    });
});

function handleFeedbackType(type) {
    const feedbackConfig = {
        'song-issue': {
            title: '[Song Issue] ',
            label: 'bug',
            prompt: 'Describe the display issue you\'re seeing:\n\n',
            includeSong: true
        },
        'search-problem': {
            title: '[Search Issue] ',
            label: 'bug',
            prompt: 'Describe what you searched for and what went wrong:\n\n'
        },
        'app-issue': {
            title: '[App Issue] ',
            label: 'bug',
            prompt: 'Describe the problem you encountered:\n\n'
        },
        'request-song': {
            action: 'add-song',
            message: 'You can add songs yourself! Use the "Add Song" feature in the menu to paste chord sheets and submit them to the songbook.'
        },
        'song-correction': {
            action: 'edit-song',
            message: 'You can correct songs yourself! Click "Edit" when viewing a song to fix chords, lyrics, or metadata.'
        },
        'copyright': {
            title: '[Copyright] ',
            label: 'copyright',
            prompt: 'Please identify the song and describe the copyright concern:\n\n'
        },
        'feature-idea': {
            title: '[Feature Request] ',
            label: 'feature-request',
            prompt: 'Describe your feature idea:\n\n'
        },
        'general': {
            title: '[Feedback] ',
            label: 'feature-request',
            prompt: ''
        }
    };

    const config = feedbackConfig[type];
    if (!config) return;

    // Handle special actions
    if (config.action === 'add-song') {
        if (confirm(config.message + '\n\nWould you like to open the Add Song editor?')) {
            navigateTo('add-song');
        }
        return;
    }

    if (config.action === 'edit-song') {
        if (currentSong && !songView.classList.contains('hidden')) {
            if (confirm(config.message + '\n\nWould you like to edit the current song?')) {
                enterEditMode(currentSong);
            }
        } else {
            alert(config.message + '\n\nFirst, search for and open the song you want to correct, then click "Edit".');
        }
        return;
    }

    // Build GitHub issue URL
    let body = config.prompt;

    // Include song context if relevant
    if (config.includeSong && currentSong) {
        body += `\n\n---\n**Song:** ${currentSong.title || 'Unknown'}\n**Artist:** ${currentSong.artist || 'Unknown'}\n**Song ID:** ${currentSong.id || 'Unknown'}\n**Source:** ${currentSong.source || 'Unknown'}`;
    }

    openContactModalWithConfig(config.title, body, config.label);
}

// Contact modal elements
const contactModal = document.getElementById('contact-modal');
const contactModalClose = document.getElementById('contact-modal-close');
const contactFeedback = document.getElementById('contact-feedback');
const submitContactBtn = document.getElementById('submit-contact-btn');
const contactStatus = document.getElementById('contact-status');

// Store current feedback config for submission
let currentFeedbackConfig = { title: '', label: 'feature-request' };

function closeContactModal() {
    contactModal.classList.add('hidden');
    currentFeedbackConfig = { title: '', label: 'feature-request' };
}

function openContactModal() {
    closeSidebar();
    contactModal.classList.remove('hidden');
    contactFeedback.value = '';
    contactStatus.textContent = '';
    contactFeedback.focus();
}

function openContactModalWithConfig(titlePrefix, bodyPrefix, label) {
    closeSidebar();
    currentFeedbackConfig = { title: titlePrefix, label: label };

    // Update modal title based on feedback type
    const modalTitle = document.getElementById('contact-modal-title');
    if (modalTitle) {
        const titleMap = {
            '[Song Issue] ': 'Report Song Issue',
            '[Search Issue] ': 'Report Search Problem',
            '[App Issue] ': 'Report App Issue',
            '[Copyright] ': 'Report Copyright Concern',
            '[Feature Request] ': 'Suggest a Feature',
            '[Feedback] ': 'Send Feedback'
        };
        modalTitle.textContent = titleMap[titlePrefix] || 'Send Feedback';
    }

    contactModal.classList.remove('hidden');
    contactFeedback.value = bodyPrefix;
    contactStatus.textContent = '';
    contactFeedback.focus();
    // Move cursor to end
    contactFeedback.setSelectionRange(contactFeedback.value.length, contactFeedback.value.length);
}

if (navFeedback) {
    navFeedback.addEventListener('click', () => {
        closeSidebar();
        toggleFeedbackDropdown();
    });
}

contactModalClose.addEventListener('click', closeContactModal);

contactModal.addEventListener('click', (e) => {
    if (e.target === contactModal) {
        closeContactModal();
    }
});

submitContactBtn.addEventListener('click', () => {
    const feedback = contactFeedback.value.trim();
    if (!feedback) {
        contactStatus.textContent = 'Please enter a message';
        contactStatus.style.color = 'var(--danger)';
        return;
    }

    // Build title with prefix from feedback config
    const titlePrefix = currentFeedbackConfig.title || '';
    const titleContent = feedback.split('\n')[0]; // First line for title
    const title = titlePrefix + (titleContent.length > 50 ? titleContent.substring(0, 50) + '...' : titleContent);
    const body = feedback;

    const params = new URLSearchParams({
        title: title,
        body: body,
        labels: currentFeedbackConfig.label || 'feature-request'
    });

    const issueUrl = `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
    window.open(issueUrl, '_blank');
    closeContactModal();
});

// Global Escape key handler for all modals and sidebar
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (feedbackDropdown && !feedbackDropdown.classList.contains('hidden')) {
            closeFeedbackDropdown();
        } else if (sidebar && sidebar.classList.contains('open')) {
            closeSidebar();
        } else if (accountModal && !accountModal.classList.contains('hidden')) {
            closeAccountModal();
        } else if (!contactModal.classList.contains('hidden')) {
            closeContactModal();
        } else if (!bugModal.classList.contains('hidden')) {
            closeBugModal();
        } else if (!songView.classList.contains('hidden')) {
            goBack();
        }
    }
});

// Initialize
initTheme();
updateFavoritesCount();
loadIndex();

// ============================================
// AUTH UI HANDLERS
// ============================================

const signInBtn = document.getElementById('sign-in-btn');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const accountModal = document.getElementById('account-modal');
const accountModalClose = document.getElementById('account-modal-close');
const forceSyncBtn = document.getElementById('force-sync-btn');
const accountSignOutBtn = document.getElementById('account-sign-out-btn');

function updateAuthUI(user) {
    if (user) {
        // Show logged-in state
        if (signInBtn) signInBtn.classList.add('hidden');
        if (userInfo) userInfo.classList.remove('hidden');
        if (userAvatar) {
            userAvatar.src = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
            userAvatar.alt = user.user_metadata?.full_name || 'User';
            userAvatar.onerror = () => { userAvatar.style.visibility = 'hidden'; };
        }
        if (userName) {
            userName.textContent = user.user_metadata?.full_name || '';
        }

        // Update account modal
        const accountAvatar = document.getElementById('account-avatar');
        const accountName = document.getElementById('account-name');
        const accountEmail = document.getElementById('account-email');

        if (accountAvatar) {
            accountAvatar.src = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
            accountAvatar.onerror = () => { accountAvatar.style.display = 'none'; };
        }
        if (accountName) accountName.textContent = user.user_metadata?.full_name || 'User';
        if (accountEmail) accountEmail.textContent = user.email || '';

    } else {
        // Show logged-out state
        if (signInBtn) signInBtn.classList.remove('hidden');
        if (userInfo) userInfo.classList.add('hidden');
        isCloudSyncEnabled = false;
        updateSyncUI('offline');
    }
}

function closeAccountModal() {
    if (accountModal) accountModal.classList.add('hidden');
}

// Auth event handlers
if (signInBtn) {
    signInBtn.addEventListener('click', async () => {
        const { error } = await SupabaseAuth.signInWithGoogle();
        if (error) {
            console.error('Sign in error:', error);
        }
    });
}

if (userInfo) {
    userInfo.addEventListener('click', () => {
        if (accountModal) accountModal.classList.remove('hidden');
    });
}

if (accountModalClose) {
    accountModalClose.addEventListener('click', closeAccountModal);
}

if (accountModal) {
    accountModal.addEventListener('click', (e) => {
        if (e.target === accountModal) closeAccountModal();
    });
}

if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', () => {
        performFullSync();
        performFullListsSync();
    });
}

if (accountSignOutBtn) {
    accountSignOutBtn.addEventListener('click', async () => {
        await SupabaseAuth.signOut();
        closeAccountModal();
    });
}

// Initialize Supabase auth
if (typeof SupabaseAuth !== 'undefined') {
    SupabaseAuth.init();

    SupabaseAuth.onAuthChange((event, user) => {
        updateAuthUI(user);

        if (event === 'SIGNED_IN' || (event === 'INITIAL' && user)) {
            // User just signed in or page loaded with active session
            performFullSync();
            performFullListsSync();
        } else if (event === 'SIGNED_OUT') {
            isCloudSyncEnabled = false;
            updateSyncUI('offline');
        }
    });
} else {
    // Supabase not available, hide auth UI
    if (signInBtn) signInBtn.classList.add('hidden');
}

// ============================================
// LIST PICKER & MANAGE LISTS EVENT HANDLERS
// ============================================

// Toggle list picker dropdown
if (listPickerBtn) {
    listPickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderListPickerDropdown();
        listPickerDropdown.classList.toggle('hidden');
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (listPickerDropdown && !listPickerDropdown.contains(e.target) && e.target !== listPickerBtn) {
        listPickerDropdown.classList.add('hidden');
    }
    if (copyDropdown && !copyDropdown.contains(e.target) && e.target !== copyBtn) {
        copyDropdown.classList.add('hidden');
    }
    if (downloadDropdown && !downloadDropdown.contains(e.target) && e.target !== downloadBtn) {
        downloadDropdown.classList.add('hidden');
    }
});

// Print button - opens print view directly
if (printBtn) {
    printBtn.addEventListener('click', () => {
        openPrintView();
    });
}

// Toggle copy dropdown
if (copyBtn) {
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyDropdown.classList.toggle('hidden');
        downloadDropdown.classList.add('hidden');
    });
}

// Toggle download dropdown
if (downloadBtn) {
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadDropdown.classList.toggle('hidden');
        copyDropdown.classList.add('hidden');
    });
}

// Convert ChordPro to ASCII text (chords above lyrics)
function chordproToAscii(chordpro) {
    const lines = chordpro.split('\n');
    const result = [];
    let title = '';
    let artist = '';

    for (const line of lines) {
        // Extract metadata for header
        const metaMatch = line.match(/\{meta:\s*(\w+)\s+([^}]+)\}/);
        if (metaMatch) {
            const [, key, value] = metaMatch;
            if (key === 'title') title = value;
            if (key === 'artist') artist = value;
            continue;
        }

        // Skip directives
        if (line.match(/^\{.*\}$/)) {
            // Include section labels as text
            const sectionMatch = line.match(/\{start_of_(verse|chorus|bridge)(?::\s*([^}]+))?\}/);
            if (sectionMatch) {
                const [, type, label] = sectionMatch;
                result.push('');
                result.push(`[${label || type.charAt(0).toUpperCase() + type.slice(1)}]`);
            }
            continue;
        }

        // Skip empty lines but preserve them
        if (!line.trim()) {
            result.push('');
            continue;
        }

        // Convert chord line to chords-above-lyrics format
        const chordRegex = /\[([^\]]+)\]/g;
        const chords = [];
        let match;
        let lastIndex = 0;
        let lyricsOnly = '';

        while ((match = chordRegex.exec(line)) !== null) {
            // Add lyrics before this chord
            lyricsOnly += line.substring(lastIndex, match.index);
            // Record chord position (in the lyrics-only string)
            chords.push({ chord: match[1], position: lyricsOnly.length });
            lastIndex = match.index + match[0].length;
        }
        // Add remaining lyrics
        lyricsOnly += line.substring(lastIndex);

        if (chords.length > 0) {
            // Build chord line
            let chordLine = '';
            let pos = 0;
            for (const { chord, position } of chords) {
                // Pad to reach position
                while (chordLine.length < position) {
                    chordLine += ' ';
                }
                chordLine += chord;
            }
            result.push(chordLine);
        }
        result.push(lyricsOnly);
    }

    // Add header
    let header = [];
    if (title) header.push(title);
    if (artist) header.push(`by ${artist}`);
    if (header.length > 0) {
        return header.join(' - ') + '\n\n' + result.join('\n').trim();
    }

    return result.join('\n').trim();
}

// Export handlers
function handleExport(action) {
    if (!currentChordpro || !currentSong) return;

    const title = currentSong.title || 'song';
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    switch (action) {
        case 'copy-chordpro':
            navigator.clipboard.writeText(currentChordpro).then(() => {
                showExportFeedback('ChordPro copied!');
            });
            break;
        case 'copy-text':
            const ascii = chordproToAscii(currentChordpro);
            navigator.clipboard.writeText(ascii).then(() => {
                showExportFeedback('Text copied!');
            });
            break;
        case 'download-chordpro':
            downloadFile(`${safeTitle}.pro`, currentChordpro, 'text/plain');
            break;
        case 'download-text':
            const asciiContent = chordproToAscii(currentChordpro);
            downloadFile(`${safeTitle}.txt`, asciiContent, 'text/plain');
            break;
    }
    copyDropdown.classList.add('hidden');
    downloadDropdown.classList.add('hidden');
}

// Open printable view in new tab
function openPrintView() {
    if (!currentChordpro || !currentSong) return;

    const title = currentSong.title || 'Song';
    const artist = currentSong.artist || '';
    const key = currentDetectedKey || currentSong.key || 'C';

    // Generate the print page HTML
    const printHtml = generatePrintPage(title, artist, key, currentChordpro);

    // Open in new tab
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printHtml);
    printWindow.document.close();
}

function generatePrintPage(title, artist, key, chordpro) {
    // Get current transposition state
    const originalKey = originalDetectedKey || currentSong.key || 'C';
    const semitones = getSemitonesBetweenKeys(originalKey, currentDetectedKey || originalKey);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} - Bluegrass Book</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: 'Courier New', Courier, monospace;
            background: white;
            color: black;
            padding: 1rem;
            max-width: 1200px;
            margin: 0 auto;
        }

        .controls {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            align-items: center;
            padding: 1rem;
            background: #f5f5f5;
            border-radius: 8px;
            margin-bottom: 1.5rem;
        }

        @media print {
            .controls { display: none; }
            body { padding: 0; max-width: none; }
        }

        .control-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        select, button {
            padding: 0.4rem 0.6rem;
            font-size: 0.85rem;
            border: 1px solid #ccc;
            border-radius: 4px;
            background: white;
            cursor: pointer;
        }

        button:hover { background: #eee; }

        .control-label {
            font-size: 0.9rem;
            font-family: system-ui, sans-serif;
            font-weight: 600;
            color: #444;
            white-space: nowrap;
        }

        .font-size-control {
            display: flex;
            align-items: center;
            gap: 4px;
            background: #f0f0f0;
            border-radius: 4px;
            padding: 4px 8px;
            margin-left: 12px;
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-left: 16px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 6px 12px;
        }

        .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 0.85rem;
            font-family: system-ui, sans-serif;
            cursor: pointer;
        }

        .size-btn {
            width: 28px;
            height: 28px;
            padding: 0;
            font-size: 1.1rem;
            font-weight: bold;
            border: none;
            background: white;
            border-radius: 3px;
        }

        #font-size-input {
            width: 45px;
            height: 24px;
            text-align: center;
            border: none;
            border-radius: 3px;
            font-size: 0.85rem;
            -moz-appearance: textfield;
        }

        #font-size-input::-webkit-outer-spin-button,
        #font-size-input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        .print-btn {
            background: #2563eb;
            color: white;
            border: none;
            margin-left: auto;
        }
        .print-btn:hover { background: #1d4ed8; }

        .header {
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid black;
        }

        .two-columns .header {
            column-span: all;
        }

        .title {
            font-size: 1.5rem;
            font-weight: bold;
            font-family: system-ui, sans-serif;
        }

        .artist {
            font-size: 1.1rem;
            color: #444;
            font-family: system-ui, sans-serif;
        }

        .key-info {
            font-size: 0.9rem;
            color: #666;
            margin-top: 0.25rem;
            font-family: system-ui, sans-serif;
        }

        #song-content {
            /* Default single column */
        }

        .two-columns #song-content {
            column-count: 2;
            column-gap: 2rem;
        }

        .section {
            margin-bottom: 1rem;
            break-inside: avoid;
        }

        .section-label {
            font-weight: bold;
            margin-bottom: 0.25rem;
            font-family: system-ui, sans-serif;
        }

        .hide-labels .section-label {
            display: none;
        }

        .line-group {
            margin-bottom: 0.25rem;
        }

        .chord-line {
            font-weight: bold;
            color: black;
            white-space: pre;
            line-height: 1.2;
        }

        .chord-line.nashville {
            color: #444;
        }

        .lyric-line {
            white-space: pre;
            line-height: 1.3;
        }

        .hide-chords .chord-line { display: none; }

        .repeat-instruction {
            font-style: italic;
            color: #666;
            margin: 0.5rem 0;
            font-family: system-ui, sans-serif;
        }

        #song-content {
            font-size: var(--font-size, 14px);
        }
    </style>
</head>
<body>
    <div class="controls">
        <div class="control-group">
            <span class="control-label">Key:</span>
            <select id="key-select">
                ${generateKeyOptions(key)}
            </select>
        </div>
        <div class="font-size-control">
            <span class="control-label">Size:</span>
            <button id="font-decrease" class="size-btn">−</button>
            <input type="number" id="font-size-input" value="14" min="8" max="32">
            <button id="font-increase" class="size-btn">+</button>
        </div>
        <div class="checkbox-group">
            <span class="control-label">Show:</span>
            <label>
                <select id="chord-mode-select">
                    <option value="all" selected>All Chords</option>
                    <option value="first">First Only</option>
                    <option value="none">No Chords</option>
                </select>
            </label>
            <label><input type="checkbox" id="compact-toggle"> Compact</label>
            <label><input type="checkbox" id="nashville-toggle"> Nashville</label>
            <label><input type="checkbox" id="columns-toggle"> 2 Columns</label>
            <label><input type="checkbox" id="labels-toggle" checked> Labels</label>
        </div>
        <button class="print-btn" onclick="window.print()">Print</button>
    </div>

    <div class="header">
        <div class="title">${escapeHtml(title)}</div>
        ${artist ? `<div class="artist">${escapeHtml(artist)}</div>` : ''}
        <div class="key-info">Key: <span id="current-key">${escapeHtml(key)}</span></div>
    </div>

    <div id="song-content"></div>

    <script>
        const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
        const originalChordpro = ${JSON.stringify(chordpro)};
        const originalKey = ${JSON.stringify(key)};
        let currentKey = originalKey;
        let nashvilleMode = false;
        let compactMode = false;
        let chordMode = 'all'; // 'all', 'first', 'none'

        function normalizeKey(key) {
            const map = { 'Db': 'C#', 'D#': 'Eb', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb' };
            return map[key] || key;
        }

        function getSemitones(from, to) {
            const fromIdx = KEYS.indexOf(normalizeKey(from));
            const toIdx = KEYS.indexOf(normalizeKey(to));
            if (fromIdx === -1 || toIdx === -1) return 0;
            return (toIdx - fromIdx + 12) % 12;
        }

        function transposeChord(chord, semitones) {
            if (semitones === 0) return chord;
            const match = chord.match(/^([A-G][#b]?)(.*)$/);
            if (!match) return chord;
            const [, root, suffix] = match;
            const idx = KEYS.indexOf(normalizeKey(root));
            if (idx === -1) return chord;
            const newIdx = (idx + semitones + 12) % 12;
            return KEYS[newIdx] + suffix;
        }

        function toNashville(chord, key) {
            const degrees = { 0: 'I', 1: '#I', 2: 'II', 3: 'bIII', 4: 'III', 5: 'IV',
                            6: '#IV', 7: 'V', 8: 'bVI', 9: 'VI', 10: 'bVII', 11: 'VII' };
            const match = chord.match(/^([A-G][#b]?)(.*)$/);
            if (!match) return chord;
            const [, root, suffix] = match;
            const keyIdx = KEYS.indexOf(normalizeKey(key));
            const chordIdx = KEYS.indexOf(normalizeKey(root));
            if (keyIdx === -1 || chordIdx === -1) return chord;
            const interval = (chordIdx - keyIdx + 12) % 12;
            let degree = degrees[interval] || interval.toString();
            if (suffix.startsWith('m') && !suffix.startsWith('maj')) {
                degree = degree.toLowerCase();
            }
            return degree + suffix.replace(/^m(?!aj)/, '');
        }

        // Convert a ChordPro line to chords-above-lyrics format
        function lineToAscii(line, semitones) {
            const chordRegex = new RegExp('\\\\[([^\\\\]]+)\\\\]', 'g');
            const chords = [];
            let match;
            let lastIndex = 0;
            let lyricsOnly = '';

            while ((match = chordRegex.exec(line)) !== null) {
                lyricsOnly += line.substring(lastIndex, match.index);
                let chord = transposeChord(match[1], semitones);
                if (nashvilleMode) {
                    chord = toNashville(chord, currentKey);
                }
                chords.push({ chord, position: lyricsOnly.length });
                lastIndex = match.index + match[0].length;
            }
            lyricsOnly += line.substring(lastIndex);

            // Build chord line with proper spacing
            let chordLine = '';
            for (const { chord, position } of chords) {
                // Ensure minimum spacing between chords
                const minPos = chordLine.length > 0 ? chordLine.length + 1 : 0;
                const targetPos = Math.max(position, minPos);
                while (chordLine.length < targetPos) {
                    chordLine += ' ';
                }
                chordLine += chord;
            }

            return { chordLine: chordLine.trimEnd(), lyricLine: lyricsOnly };
        }

        function renderContent() {
            const semitones = getSemitones(originalKey, currentKey);
            const NL = String.fromCharCode(10);
            const lines = originalChordpro.split(NL);
            console.log('Number of lines:', lines.length);
            console.log('First 3 lines:', lines.slice(0, 3));
            let html = '';
            let inSection = false;
            let currentSectionType = '';
            let currentSectionLabel = '';
            let currentSectionLines = [];
            const seenSections = {}; // Track section content by type

            function renderSection(sectionLines, hideChords) {
                let sectionHtml = '';
                for (const line of sectionLines) {
                    if (!line.trim()) {
                        sectionHtml += '<div class="line-group"><div class="lyric-line">&nbsp;</div></div>';
                        continue;
                    }
                    const { chordLine, lyricLine } = lineToAscii(line, semitones);
                    sectionHtml += '<div class="line-group">';
                    if (chordLine && !hideChords) {
                        sectionHtml += '<div class="chord-line' + (nashvilleMode ? ' nashville' : '') + '">' +
                                escapeHtmlInline(chordLine) + '</div>';
                    }
                    sectionHtml += '<div class="lyric-line">' + escapeHtmlInline(lyricLine || ' ') + '</div>';
                    sectionHtml += '</div>';
                }
                return sectionHtml;
            }

            function flushSection() {
                if (!currentSectionType) return;

                const contentKey = currentSectionLines.join(NL).trim();
                const label = currentSectionLabel || currentSectionType.charAt(0).toUpperCase() + currentSectionType.slice(1);

                // Check if we've seen this exact content before (regardless of label)
                let foundMatch = null;
                if (compactMode || chordMode === 'first') {
                    for (const key in seenSections) {
                        if (seenSections[key].content === contentKey) {
                            foundMatch = seenSections[key];
                            break;
                        }
                    }
                }

                // Determine whether to hide chords for this section
                const hideChords = chordMode === 'none' || (chordMode === 'first' && foundMatch);

                if (compactMode && foundMatch) {
                    // Show repeat instruction
                    html += '<div class="repeat-instruction">[Repeat ' + foundMatch.label + ']</div>';
                } else {
                    // Render full section
                    html += '<div class="section"><div class="section-label">' + label + '</div>';
                    html += renderSection(currentSectionLines, hideChords);
                    html += '</div>';

                    // Store for future reference using unique key
                    if (!foundMatch) {
                        const uniqueKey = currentSectionType + '_' + Object.keys(seenSections).length;
                        seenSections[uniqueKey] = { content: contentKey, label: label };
                    }
                }

                currentSectionType = '';
                currentSectionLabel = '';
                currentSectionLines = [];
            }

            for (const line of lines) {
                // Skip metadata
                if (line.indexOf('{meta:') === 0) continue;

                // Section start - check for {start_of_verse}, {start_of_chorus}, {start_of_bridge}
                if (line.indexOf('{start_of_') === 0) {
                    flushSection();
                    const typeMatch = line.match(/start_of_(verse|chorus|bridge)/);
                    if (typeMatch) {
                        currentSectionType = typeMatch[1];
                        // Extract label after colon if present
                        const colonIdx = line.indexOf(':');
                        if (colonIdx > 0) {
                            currentSectionLabel = line.substring(colonIdx + 1, line.length - 1).trim();
                        } else {
                            currentSectionLabel = '';
                        }
                        inSection = true;
                        continue;
                    }
                }

                // Section end
                if (line.indexOf('{end_of_') === 0) {
                    flushSection();
                    inSection = false;
                    continue;
                }

                // Skip other directives
                if (line.charAt(0) === '{' && line.charAt(line.length - 1) === '}') continue;

                // Collect lines
                if (inSection) {
                    currentSectionLines.push(line);
                } else {
                    // Lines outside sections
                    if (!line.trim()) {
                        html += '<div class="line-group"><div class="lyric-line">&nbsp;</div></div>';
                        continue;
                    }
                    const { chordLine, lyricLine } = lineToAscii(line, semitones);
                    html += '<div class="line-group">';
                    if (chordLine) {
                        html += '<div class="chord-line' + (nashvilleMode ? ' nashville' : '') + '">' +
                                escapeHtmlInline(chordLine) + '</div>';
                    }
                    html += '<div class="lyric-line">' + escapeHtmlInline(lyricLine || ' ') + '</div>';
                    html += '</div>';
                }
            }

            flushSection();
            document.getElementById('song-content').innerHTML = html;
            document.getElementById('current-key').textContent = currentKey;
        }

        function escapeHtmlInline(text) {
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        document.getElementById('key-select').addEventListener('change', (e) => {
            currentKey = e.target.value;
            renderContent();
        });

        let currentFontSize = 14;
        const minFontSize = 8;
        const maxFontSize = 32;
        const fontSizeInput = document.getElementById('font-size-input');

        function updateFontSize() {
            currentFontSize = Math.max(minFontSize, Math.min(maxFontSize, currentFontSize));
            document.documentElement.style.setProperty('--font-size', currentFontSize + 'px');
            fontSizeInput.value = currentFontSize;
        }

        document.getElementById('font-decrease').addEventListener('click', () => {
            currentFontSize -= 2;
            updateFontSize();
        });

        document.getElementById('font-increase').addEventListener('click', () => {
            currentFontSize += 2;
            updateFontSize();
        });

        fontSizeInput.addEventListener('change', (e) => {
            currentFontSize = parseInt(e.target.value, 10) || 14;
            updateFontSize();
        });

        document.getElementById('nashville-toggle').addEventListener('change', (e) => {
            nashvilleMode = e.target.checked;
            renderContent();
        });

        document.getElementById('chord-mode-select').addEventListener('change', (e) => {
            chordMode = e.target.value;
            renderContent();
        });

        document.getElementById('labels-toggle').addEventListener('change', (e) => {
            document.body.classList.toggle('hide-labels', !e.target.checked);
        });

        document.getElementById('columns-toggle').addEventListener('change', (e) => {
            document.body.classList.toggle('two-columns', e.target.checked);
        });

        document.getElementById('compact-toggle').addEventListener('change', (e) => {
            compactMode = e.target.checked;
            renderContent();
        });

        // Initial render
        try {
            console.log('ChordPro length:', originalChordpro.length);
            console.log('First 200 chars:', originalChordpro.substring(0, 200));
            renderContent();
        } catch (e) {
            console.error('Render error:', e);
            document.getElementById('song-content').innerHTML = '<pre style="color:red">' + e.message + '</pre>';
        }
    </script>
</body>
</html>`;
}

function generateKeyOptions(currentKey) {
    const keys = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return keys.map(k =>
        `<option value="${k}"${k === currentKey ? ' selected' : ''}>${k}</option>`
    ).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showExportFeedback(message) {
    // Brief visual feedback - change button icon temporarily
    const icon = exportBtn.querySelector('.export-icon');
    const originalContent = icon.textContent;
    icon.textContent = '✓';
    setTimeout(() => {
        icon.textContent = originalContent;
    }, 1500);
}

// Handle export option clicks
if (copyDropdown) {
    copyDropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.export-option');
        if (option) {
            handleExport(option.dataset.action);
        }
    });
}
if (downloadDropdown) {
    downloadDropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.export-option');
        if (option) {
            handleExport(option.dataset.action);
        }
    });
}

// Handle favorites checkbox change
if (favoritesCheckbox) {
    favoritesCheckbox.addEventListener('change', (e) => {
        if (currentSong) {
            toggleFavorite(currentSong.id);
            updateListPickerButton();
        }
    });
}

// Handle custom list checkbox changes
if (customListsContainer) {
    customListsContainer.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox' && currentSong) {
            const listId = e.target.dataset.listId;
            if (e.target.checked) {
                addSongToList(listId, currentSong.id);
            } else {
                removeSongFromList(listId, currentSong.id);
            }
            updateListPickerButton();
        }
    });
}

// Create new list from dropdown
if (createListBtn) {
    createListBtn.addEventListener('click', () => {
        const name = prompt('Enter list name:');
        if (name) {
            const newList = createList(name);
            if (newList && currentSong) {
                addSongToList(newList.id, currentSong.id);
                renderListPickerDropdown();
            } else if (!newList) {
                alert('A list with that name already exists.');
            }
        }
    });
}

// Open manage lists modal
if (navManageLists) {
    navManageLists.addEventListener('click', () => {
        closeSidebar();
        renderListsModal();
        if (listsModal) listsModal.classList.remove('hidden');
    });
}

// Close manage lists modal
if (listsModalClose) {
    listsModalClose.addEventListener('click', () => {
        if (listsModal) listsModal.classList.add('hidden');
    });
}

if (listsModal) {
    listsModal.addEventListener('click', (e) => {
        if (e.target === listsModal) {
            listsModal.classList.add('hidden');
        }
    });
}

// Create list from modal
if (createListSubmit && newListNameInput) {
    createListSubmit.addEventListener('click', () => {
        const name = newListNameInput.value;
        if (name) {
            const newList = createList(name);
            if (newList) {
                newListNameInput.value = '';
                renderListsModal();
            } else {
                alert('A list with that name already exists.');
            }
        }
    });

    newListNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            createListSubmit.click();
        }
    });
}

// Initialize sidebar lists on load
renderSidebarLists();

// ============================================
// EDITOR FUNCTIONALITY
// ============================================

// Editor DOM elements
const editorPanel = document.getElementById('editor-panel');
const editorTitle = document.getElementById('editor-title');
const editorArtist = document.getElementById('editor-artist');
const editorWriter = document.getElementById('editor-writer');
const editorContent = document.getElementById('editor-content');
const editorPreviewContent = document.getElementById('editor-preview-content');
const editorCopyBtn = document.getElementById('editor-copy');
const editorSaveBtn = document.getElementById('editor-save');
const editorSubmitBtn = document.getElementById('editor-submit');
const editorStatus = document.getElementById('editor-status');
const editorNashville = document.getElementById('editor-nashville');
const editorComment = document.getElementById('editor-comment');
const editCommentRow = document.getElementById('edit-comment-row');
const editSongBtn = document.getElementById('edit-song-btn');

// ChordPro hints elements
const hintsBtn = document.getElementById('chordpro-hints-btn');
const hintsPanel = document.getElementById('chordpro-hints-panel');
const hintsBackdrop = document.getElementById('chordpro-hints-backdrop');
const hintsClose = document.getElementById('chordpro-hints-close');

let editorNashvilleMode = false;
let editorDetectedKey = null;
let editMode = false;        // true when editing existing song, false for new song
let editingSongId = null;    // song ID being edited

// Edit mode management
function enterEditMode(song) {
    editMode = true;
    editingSongId = song.id;

    // Populate editor with song data
    editorTitle.value = song.title || '';
    editorArtist.value = song.artist || '';
    editorWriter.value = song.composer || '';
    editorContent.value = song.content || '';
    editorComment.value = '';

    // Show comment field
    editCommentRow.classList.remove('hidden');

    // Update submit button text
    editorSubmitBtn.textContent = 'Submit Correction';

    // Switch to editor panel (update nav state)
    [navSearch, navAddSong, navFavorites].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    if (navAddSong) navAddSong.classList.add('active');

    const searchContainer = document.querySelector('.search-container');
    searchContainer.classList.add('hidden');
    resultsDiv.classList.add('hidden');
    songView.classList.add('hidden');
    editorPanel.classList.remove('hidden');

    // Trigger preview update
    updateEditorPreview();
}

function exitEditMode() {
    editMode = false;
    editingSongId = null;
    editCommentRow.classList.add('hidden');
    editorComment.value = '';
    editorSubmitBtn.textContent = 'Submit to Songbook';
}

// Edit song button handler
if (editSongBtn) {
    editSongBtn.addEventListener('click', () => {
        if (currentSong) {
            enterEditMode(currentSong);
        }
    });
}

// Editor chord detection
function editorIsChordLine(line) {
    if (!line.trim()) return false;
    const words = line.trim().split(/\s+/);
    if (words.length === 0) return false;
    const chordPattern = /^[A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?$/;
    const chordCount = words.filter(w => chordPattern.test(w)).length;
    return chordCount / words.length > 0.5;
}

function editorIsSectionMarker(line) {
    return /^\[.+\]$/.test(line.trim());
}

function editorIsInstrumentalLine(line) {
    return /^[—\-]?[A-G][#b]?---/.test(line.trim());
}

function editorExtractChordsWithPositions(chordLine) {
    const chords = [];
    const pattern = /([A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?)/g;
    let match;
    while ((match = pattern.exec(chordLine)) !== null) {
        chords.push({ chord: match[1], position: match.index });
    }
    return chords;
}

function editorAlignChordsToLyrics(chordLine, lyricLine, chordPositions) {
    if (!chordPositions.length) return lyricLine;
    const sorted = [...chordPositions].sort((a, b) => b.position - a.position);
    let result = lyricLine;
    for (const { chord, position } of sorted) {
        let lyricPos = Math.min(position, result.length);
        result = result.slice(0, lyricPos) + `[${chord}]` + result.slice(lyricPos);
    }
    return result;
}

function editorConvertToChordPro(text) {
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
            result.push('');
            i++;
            continue;
        }

        if (editorIsSectionMarker(trimmed)) {
            const sectionName = trimmed.slice(1, -1).trim();
            const lowerName = sectionName.toLowerCase();
            if (lowerName.includes('chorus')) {
                result.push('{soc}');
            } else if (lowerName.includes('verse')) {
                result.push(`{sov: ${sectionName}}`);
            } else if (lowerName.includes('instrumental') || lowerName.includes('break')) {
                result.push(`{comment: ${sectionName}}`);
            } else if (lowerName.includes('bridge')) {
                result.push('{sob}');
            } else {
                result.push(`{comment: ${sectionName}}`);
            }
            i++;
            continue;
        }

        if (editorIsInstrumentalLine(trimmed)) {
            result.push(`{comment: ${trimmed}}`);
            i++;
            continue;
        }

        if (editorIsChordLine(line)) {
            const chordPositions = editorExtractChordsWithPositions(line);
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                if (!nextLine.trim() || editorIsChordLine(nextLine) || editorIsSectionMarker(nextLine.trim())) {
                    const chords = chordPositions.map(c => c.chord).join(' ');
                    result.push(`{comment: ${chords}}`);
                    i++;
                    continue;
                }
                const chordproLine = editorAlignChordsToLyrics(line, nextLine, chordPositions);
                result.push(chordproLine);
                i += 2;
                continue;
            } else {
                const chords = chordPositions.map(c => c.chord).join(' ');
                result.push(`{comment: ${chords}}`);
                i++;
                continue;
            }
        }

        result.push(line);
        i++;
    }

    return result.join('\n');
}

// Detect and clean Ultimate Guitar paste format
function cleanUltimateGuitarPaste(text) {
    // Check if this looks like a UG paste (has their characteristic markers)
    const isUG = text.includes('ultimate-guitar') ||
                 text.includes('Ultimate-Guitar') ||
                 (text.includes('Chords by') && text.includes('views') && text.includes('saves')) ||
                 (text.includes('Tuning:') && text.includes('Key:') && text.includes('Capo:'));

    if (!isUG) {
        return { text, title: null, artist: null, cleaned: false };
    }

    const lines = text.split('\n');
    let title = null;
    let artist = null;
    let songStartIndex = -1;
    let songEndIndex = lines.length;

    // Find title and artist from "Title Chords by Artist" line
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const line = lines[i];
        const match = line.match(/^(.+?)\s+(?:Chords|Tab|Tabs)\s+by\s+(.+)$/i);
        if (match) {
            title = match[1].trim();
            artist = match[2].trim();
            break;
        }
    }

    // Find where the actual song content starts
    // Look for first section marker [Verse], [Chorus], [Intro], etc. or first chord line
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Section markers
        if (/^\[(Verse|Chorus|Intro|Bridge|Outro|Instrumental|Pre-Chorus|Hook|Interlude)/i.test(line)) {
            songStartIndex = i;
            break;
        }
        // Or a line that looks like chords followed by lyrics
        if (editorIsChordLine(line) && i + 1 < lines.length && lines[i + 1].trim() && !editorIsChordLine(lines[i + 1])) {
            songStartIndex = i;
            break;
        }
    }

    // Find where song content ends
    // Look for "Last update:", rating sections, "Welcome Offer", footer content
    for (let i = songStartIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('Last update:') ||
            line === 'Rating' ||
            line === 'Welcome Offer' ||
            line.startsWith('© ') ||
            line === 'Chords' ||
            (line === 'X' && i > songStartIndex + 10) ||
            line.includes('Please, rate this tab') ||
            line.match(/^\d+\.\d+$/) ||  // Rating like "4.8"
            line.match(/^\d+ rates$/)) {
            songEndIndex = i;
            break;
        }
    }

    if (songStartIndex === -1) {
        return { text, title, artist, cleaned: false };
    }

    // Extract just the song content
    const songLines = lines.slice(songStartIndex, songEndIndex);

    // Clean up the song content
    const cleanedLines = songLines
        .map(line => {
            // Remove any remaining UG artifacts
            return line;
        })
        .filter(line => {
            const trimmed = line.trim();
            // Filter out stray UG elements that might have snuck in
            if (trimmed === 'X') return false;
            if (trimmed.match(/^\d+\.\d+$/)) return false;  // Ratings
            if (trimmed.match(/^\(\d+,?\d*\)$/)) return false;  // (2,130)
            if (trimmed === 'Chords' || trimmed === 'Guitar' || trimmed === 'Ukulele' || trimmed === 'Piano') return false;
            return true;
        });

    return {
        text: cleanedLines.join('\n'),
        title,
        artist,
        cleaned: true
    };
}

function editorDetectAndConvert(text) {
    const lines = text.split('\n');
    let chordLineCount = 0;
    let consecutivePairs = 0;

    for (let i = 0; i < lines.length - 1; i++) {
        if (editorIsChordLine(lines[i]) && !editorIsChordLine(lines[i + 1]) && lines[i + 1].trim()) {
            consecutivePairs++;
        }
        if (editorIsChordLine(lines[i])) {
            chordLineCount++;
        }
    }

    if (consecutivePairs >= 2 || chordLineCount >= 3) {
        return editorConvertToChordPro(text);
    }

    return text;
}

// Editor preview parsing
function editorParseContent(content) {
    const lines = content.split('\n');
    const sections = [];
    let currentSection = { label: 'Verse 1', lines: [] };
    let verseCount = 1;

    for (const line of lines) {
        if (line.match(/^\{(sov|start_of_verse)/i)) {
            if (currentSection.lines.length > 0) sections.push(currentSection);
            const labelMatch = line.match(/:\s*(.+?)\s*\}/);
            currentSection = { label: labelMatch ? labelMatch[1] : `Verse ${++verseCount}`, lines: [] };
            continue;
        }
        if (line.match(/^\{(soc|start_of_chorus)/i)) {
            if (currentSection.lines.length > 0) sections.push(currentSection);
            currentSection = { label: 'Chorus', type: 'chorus', lines: [] };
            continue;
        }
        if (line.match(/^\{(eov|eoc|end_of)/i)) {
            if (currentSection.lines.length > 0) sections.push(currentSection);
            currentSection = { label: `Verse ${++verseCount}`, lines: [] };
            continue;
        }
        if (line.startsWith('{')) continue;

        if (!line.trim()) {
            if (currentSection.lines.length > 0) {
                sections.push(currentSection);
                currentSection = { label: `Verse ${++verseCount}`, lines: [] };
            }
            continue;
        }

        if (line.trim()) {
            currentSection.lines.push(line);
        }
    }

    if (currentSection.lines.length > 0) sections.push(currentSection);
    return sections;
}

function editorRenderLine(line) {
    const chords = [];
    let lyrics = '';
    const regex = /\[([^\]]+)\]/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(line)) !== null) {
        lyrics += line.slice(lastIndex, match.index);
        chords.push({ chord: match[1], position: lyrics.length });
        lastIndex = regex.lastIndex;
    }
    lyrics += line.slice(lastIndex);

    if (chords.length === 0) {
        return `<div class="song-line"><div class="lyrics-line">${escapeHtml(lyrics)}</div></div>`;
    }

    let chordLine = '';
    let lastPos = 0;

    for (const { chord, position } of chords) {
        const displayChord = editorNashvilleMode && editorDetectedKey
            ? toNashville(chord, editorDetectedKey)
            : chord;
        const spaces = Math.max(0, position - lastPos);
        chordLine += ' '.repeat(spaces) + displayChord;
        lastPos = position + displayChord.length;
    }

    return `
        <div class="song-line">
            <div class="chord-line">${escapeHtml(chordLine)}</div>
            <div class="lyrics-line">${escapeHtml(lyrics)}</div>
        </div>
    `;
}

function updateEditorPreview() {
    if (!editorContent || !editorPreviewContent) return;

    const title = editorTitle?.value.trim() || '';
    const artist = editorArtist?.value.trim() || '';
    const content = editorContent.value;

    if (!content.trim()) {
        editorPreviewContent.innerHTML = '<p class="preview-placeholder">Enter a song to see preview...</p>';
        return;
    }

    const chords = extractChords(content);
    const { key } = detectKey(chords);
    editorDetectedKey = key;

    const sections = editorParseContent(content);

    let html = '<div class="song-header">';
    if (title) html += `<h2 class="song-title">${escapeHtml(title)}</h2>`;
    const metaParts = [];
    if (artist) metaParts.push(artist);
    if (key) metaParts.push(`Key: ${key}`);
    if (metaParts.length) html += `<div class="song-meta">${escapeHtml(metaParts.join(' | '))}</div>`;
    html += '</div>';

    for (const section of sections) {
        const indentClass = section.type === 'chorus' ? 'section-indent' : '';
        html += `<div class="song-section ${indentClass}">`;
        html += `<div class="section-label">${escapeHtml(section.label)}</div>`;
        html += '<div class="section-content">';
        for (const line of section.lines) {
            html += editorRenderLine(line);
        }
        html += '</div></div>';
    }

    editorPreviewContent.innerHTML = html;
}

function editorGenerateChordPro() {
    const title = editorTitle?.value.trim() || '';
    const artist = editorArtist?.value.trim() || '';
    const writer = editorWriter?.value.trim() || '';
    const content = editorContent?.value.trim() || '';

    let output = '';

    if (title) output += `{meta: title ${title}}\n`;
    if (artist) output += `{meta: artist ${artist}}\n`;
    if (writer) output += `{meta: composer ${writer}}\n`;

    if (output) output += '\n';

    const sections = editorParseContent(content);

    for (const section of sections) {
        if (section.type === 'chorus') {
            output += '{start_of_chorus}\n';
        } else {
            output += `{start_of_verse: ${section.label}}\n`;
        }

        for (const line of section.lines) {
            output += line + '\n';
        }

        if (section.type === 'chorus') {
            output += '{end_of_chorus}\n\n';
        } else {
            output += '{end_of_verse}\n\n';
        }
    }

    return output.trim() + '\n';
}

function editorGenerateFilename(title) {
    if (!title) return 'untitled.pro';
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 50) + '.pro';
}

// Editor event handlers
if (editorContent) {
    editorContent.addEventListener('paste', () => {
        setTimeout(() => {
            let text = editorContent.value;
            let statusMessage = '';

            // First, try to clean Ultimate Guitar format
            const ugResult = cleanUltimateGuitarPaste(text);
            if (ugResult.cleaned) {
                text = ugResult.text;
                statusMessage = 'Imported from Ultimate Guitar';

                // Auto-fill title and artist if extracted and fields are empty
                if (ugResult.title && editorTitle && !editorTitle.value.trim()) {
                    editorTitle.value = ugResult.title;
                }
                if (ugResult.artist && editorArtist && !editorArtist.value.trim()) {
                    editorArtist.value = ugResult.artist;
                }
            }

            // Then convert chord sheet format to ChordPro
            const converted = editorDetectAndConvert(text);
            if (converted !== text || ugResult.cleaned) {
                editorContent.value = converted;
                updateEditorPreview();
                if (editorStatus) {
                    editorStatus.textContent = statusMessage || 'Converted from chord sheet format';
                    editorStatus.className = 'save-status success';
                    setTimeout(() => { editorStatus.textContent = ''; }, 3000);
                }
            }
        }, 0);
    });

    editorContent.addEventListener('input', updateEditorPreview);
}

if (editorTitle) editorTitle.addEventListener('input', updateEditorPreview);
if (editorArtist) editorArtist.addEventListener('input', updateEditorPreview);

if (editorNashville) {
    editorNashville.addEventListener('change', (e) => {
        editorNashvilleMode = e.target.checked;
        updateEditorPreview();
    });
}

// ChordPro hints toggle
function toggleHints() {
    const isHidden = hintsPanel.classList.contains('hidden');
    if (isHidden) {
        hintsPanel.classList.remove('hidden');
        hintsBackdrop.classList.remove('hidden');
    } else {
        closeHints();
    }
}

function closeHints() {
    hintsPanel.classList.add('hidden');
    hintsBackdrop.classList.add('hidden');
}

if (hintsBtn) {
    hintsBtn.addEventListener('click', toggleHints);
}

if (hintsClose) {
    hintsClose.addEventListener('click', closeHints);
}

if (hintsBackdrop) {
    hintsBackdrop.addEventListener('click', closeHints);
}

if (editorCopyBtn) {
    editorCopyBtn.addEventListener('click', async () => {
        const chordpro = editorGenerateChordPro();
        try {
            await navigator.clipboard.writeText(chordpro);
            editorStatus.textContent = 'Copied!';
            editorStatus.className = 'save-status success';
            setTimeout(() => { editorStatus.textContent = ''; }, 2000);
        } catch (err) {
            editorStatus.textContent = 'Copy failed';
            editorStatus.className = 'save-status error';
        }
    });
}

if (editorSaveBtn) {
    editorSaveBtn.addEventListener('click', () => {
        const title = editorTitle?.value.trim();
        if (!title) {
            editorStatus.textContent = 'Title required';
            editorStatus.className = 'save-status error';
            return;
        }

        const chordpro = editorGenerateChordPro();
        const filename = editorGenerateFilename(title);

        // Create download via Blob
        const blob = new Blob([chordpro], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        editorStatus.textContent = `Downloaded: ${filename}`;
        editorStatus.className = 'save-status success';
        setTimeout(() => { editorStatus.textContent = ''; }, 3000);
    });
}

if (editorSubmitBtn) {
    editorSubmitBtn.addEventListener('click', () => {
        const title = editorTitle?.value.trim();
        const artist = editorArtist?.value.trim();

        if (!title) {
            editorStatus.textContent = 'Title required';
            editorStatus.className = 'save-status error';
            return;
        }

        const chordpro = editorGenerateChordPro();
        const content = editorContent?.value.trim();

        if (!content) {
            editorStatus.textContent = 'Song content required';
            editorStatus.className = 'save-status error';
            return;
        }

        let issueTitle, issueBody, labels;

        if (editMode && editingSongId) {
            // Song correction mode
            const comment = editorComment?.value.trim();
            if (!comment) {
                editorStatus.textContent = 'Please describe your changes';
                editorStatus.className = 'save-status error';
                return;
            }

            issueTitle = `Correction: ${title}`;
            labels = 'song-correction';
            issueBody = `## Song Correction

**Song ID:** ${editingSongId}
**Title:** ${title}
**Artist:** ${artist || 'Unknown'}

### Changes Made
${comment}

### Updated ChordPro Content

\`\`\`chordpro
${chordpro}
\`\`\`

---
*Please review this correction. Add the \`approved\` label to process it automatically.*`;

        } else {
            // New song submission mode
            issueTitle = artist
                ? `Song: ${title} by ${artist}`
                : `Song: ${title}`;
            labels = 'song-submission';
            issueBody = `## Song Submission

**Title:** ${title}
**Artist:** ${artist || 'Unknown'}
**Submitted via:** Bluegrass Songbook Editor

### ChordPro Content

\`\`\`chordpro
${chordpro}
\`\`\`

---
*Please review this submission. Add the \`approved\` label to process it automatically.*`;
        }

        // Create GitHub issue URL
        const params = new URLSearchParams({
            title: issueTitle,
            body: issueBody,
            labels: labels
        });

        const issueUrl = `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;

        // Open in new tab
        window.open(issueUrl, '_blank');

        editorStatus.textContent = 'Opening GitHub...';
        editorStatus.className = 'save-status success';
        setTimeout(() => { editorStatus.textContent = ''; }, 3000);

        // Exit edit mode after submission
        if (editMode) {
            exitEditMode();
        }
    });
}
