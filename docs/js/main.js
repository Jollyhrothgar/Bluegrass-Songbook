// Main entry point for Bluegrass Songbook
// This module orchestrates all other modules and handles initialization

// Helper to get DOM elements with validation (warns in dev if missing)
function getEl(id, required = true) {
    const el = document.getElementById(id);
    if (!el && required && location.hostname === 'localhost') {
        console.warn(`Missing required element: #${id}`);
    }
    return el;
}

import {
    allSongs, setAllSongs,
    songGroups, setSongGroups,
    setHistoryInitialized,
    historyInitialized,
    currentDetectedKey, setCurrentDetectedKey,
    originalDetectedKey, originalDetectedMode,
    loadViewPrefs,
    userLists,
    compactMode, setCompactMode,
    nashvilleMode, setNashvilleMode,
    chordDisplayMode, setChordDisplayMode,
    showSectionLabels, setShowSectionLabels,
    twoColumnMode, setTwoColumnMode,
    fontSizeLevel, setFontSizeLevel, FONT_SIZES,
    setListContext,
    tablaturePlayer,
    setFullscreenMode,
    // Reactive state system
    subscribe, setCurrentView, currentView
} from './state.js';
import { initTagDropdown, syncTagCheckboxes } from './tags.js';
import {
    initLists, renderSidebarLists, renderListPickerDropdown, performFullListsSync,
    clearListView, renderListsModal, createList, addSongToList, getViewingListId,
    showListView, fetchListData, renderManageListsView, showSongListsView, startCreateListInView,
    // Favorites functions (favorites is now just a list)
    showFavorites, updateFavoritesCount, getFavoritesList, isFavorite, toggleFavorite,
    updateSyncUI, reorderFavoriteItem
} from './lists.js';
import { initSongView, openSong, openSongFromHistory, goBack, renderSong, getCurrentSong, getCurrentChordpro, toggleFullscreen, exitFullscreen, openSongControls, navigatePrev, navigateNext } from './song-view.js';
import { openWork, renderWorkView } from './work-view.js';
import { initSearch, search, showRandomSongs, renderResults, parseSearchQuery } from './search-core.js';
import { initEditor, updateEditorPreview, enterEditMode, exitEditMode, editorGenerateChordPro, closeHints } from './editor.js';
import { escapeHtml } from './utils.js';
import { showListPicker, closeListPicker, updateTriggerButton } from './list-picker.js';
import { extractChords, toNashville, transposeChord, getSemitonesBetweenKeys, generateKeyOptions, CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS } from './chords.js';
import { initAnalytics, track, trackNavigation, trackThemeToggle, trackDeepLink, trackExport, trackEditor, trackBottomSheet } from './analytics.js';
import { initFlags, openFlagModal } from './flags.js';
import { initSongRequest, openSongRequestModal } from './song-request.js';
import { COLLECTIONS, COLLECTION_PINS } from './collections.js';

// ============================================
// DOM ELEMENTS
// ============================================

const searchInput = document.getElementById('search-input');
const searchStats = document.getElementById('search-stats');
const resultsDiv = document.getElementById('results');
const songView = document.getElementById('song-view');
const songContent = document.getElementById('song-content');
const backBtn = document.getElementById('back-btn');
const themeToggle = document.getElementById('theme-toggle');
const visitorStatsEl = document.getElementById('visitor-stats');

// Landing page elements
const landingPage = document.getElementById('landing-page');
const collectionsGrid = document.getElementById('collections-grid');
const landingSearchInput = document.getElementById('landing-search-input');

// Sidebar elements
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const sidebarClose = document.getElementById('sidebar-close');
const menuBtn = document.getElementById('hamburger-btn');
const logoLink = document.getElementById('logo-link');
const navHome = document.getElementById('nav-home');
const navSearch = document.getElementById('nav-search');
const navAddSong = document.getElementById('nav-add-song');
const navFavorites = document.getElementById('nav-favorites');
const navFavoritesCount = document.getElementById('nav-favorites-count');
const navListsContainer = document.getElementById('nav-lists-container');
const songListsBtn = document.getElementById('nav-song-lists');

// List picker elements
const listPickerBtn = document.getElementById('list-picker-btn');
const listPickerDropdown = document.getElementById('list-picker-dropdown');
const customListsContainer = document.getElementById('custom-lists-container');
const favoritesCheckbox = document.getElementById('favorites-checkbox');

// Version modal
const versionModal = document.getElementById('version-modal');
const versionModalClose = document.getElementById('version-modal-close');
const versionModalTitle = document.getElementById('version-modal-title');
const versionList = document.getElementById('version-list');

// Fullscreen / navigation elements
const fullscreenBtn = document.getElementById('fullscreen-btn');
const exitFullscreenBtn = document.getElementById('exit-fullscreen-btn');
const songViewBtn = document.getElementById('song-view-btn');
const navBar = document.getElementById('song-nav-bar');
const navPrevBtn = document.getElementById('nav-prev-btn');
const navNextBtn = document.getElementById('nav-next-btn');
const navPosition = document.getElementById('nav-position');
const navListName = document.getElementById('nav-list-name');

// Print list button
const printListBtn = document.getElementById('print-list-btn');

// Bottom sheet
const bottomSheet = document.getElementById('bottom-sheet');
const bottomSheetBackdrop = document.getElementById('bottom-sheet-backdrop');

// Lists modal
const listsModal = document.getElementById('lists-modal');
const listsModalClose = document.getElementById('lists-modal-close');
const listsContainer = document.getElementById('lists-container');
const modalCreateListBtn = document.getElementById('create-list-submit');
const modalNewListInput = document.getElementById('new-list-name');
// Old list picker elements no longer needed - using unified ListPicker component

// Song Lists page (formerly Manage Lists)
const songListsView = document.getElementById('song-lists-view');
const songListsBackBtn = document.getElementById('song-lists-back-btn');
const manageListsContainer = document.getElementById('manage-lists-container');
const createListBtn = document.getElementById('create-list-btn');

// Account modal
const accountModal = document.getElementById('account-modal');
const accountModalClose = document.getElementById('account-modal-close');
const signInBtn = document.getElementById('sign-in-btn');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');

// Song actions
const exportBtn = document.getElementById('export-btn');
const exportDropdown = document.getElementById('export-dropdown');
const editSongBtn = document.getElementById('edit-song-btn');

// Editor elements
const editorPanel = document.getElementById('editor-panel');
const editorBackBtn = document.getElementById('editor-back-btn');
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
const hintsBtn = document.getElementById('chordpro-hints-btn');
const hintsPanel = document.getElementById('chordpro-hints-panel');
const hintsBackdrop = document.getElementById('chordpro-hints-backdrop');
const hintsClose = document.getElementById('chordpro-hints-close');
const autoDetectCheckbox = document.getElementById('editor-auto-detect');

// Tag dropdown
const tagDropdownBtn = document.getElementById('tag-dropdown-btn');
const tagDropdownContent = document.getElementById('tag-dropdown-content');

// Search tips dropdown
const searchTipsBtn = document.getElementById('search-tips-btn');
const searchTipsDropdown = document.getElementById('search-tips-dropdown');

// Feedback elements
const navFeedback = document.getElementById('nav-feedback');

// Bug report modal
const bugModal = document.getElementById('bug-modal');
const bugModalClose = document.getElementById('bug-modal-close');
const bugFeedback = document.getElementById('bug-feedback');
const bugSubmitBtn = document.getElementById('submit-bug-btn');

// Song correction modal
const correctionModal = document.getElementById('correction-modal');
const correctionModalClose = document.getElementById('correction-modal-close');
const correctionEditBtn = document.getElementById('correction-edit-btn');
const correctionFeedbackBtn = document.getElementById('correction-feedback-btn');

// Contact modal
const contactModal = document.getElementById('contact-modal');
const contactModalClose = document.getElementById('contact-modal-close');
const contactModalTitle = document.getElementById('contact-modal-title');
const contactFeedback = document.getElementById('contact-feedback');
const contactSubmitBtn = document.getElementById('submit-contact-btn');

// ============================================
// THEME HANDLING
// ============================================

function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    trackThemeToggle(newTheme);
}

// ============================================
// HISTORY MANAGEMENT
// ============================================

function pushHistoryState(view, data = {}, replace = false) {
    if (!historyInitialized) return;

    let hash = '';
    const state = { view, ...data };

    switch (view) {
        case 'song':
            // If viewing song within a list context, include list ID in URL
            if (data.listId) {
                hash = `#list/${data.listId}/${data.songId}`;
            } else {
                hash = `#work/${data.songId}`;
            }
            break;
        case 'add-song':
            hash = '#add';
            break;
        case 'favorites':
            // Favorites is just a list with ID 'favorites'
            // Use 'list' view type for consistency
            state.view = 'list';
            state.listId = 'favorites';
            hash = '#list/favorites';
            break;
        case 'list':
            hash = `#list/${data.listId}`;
            break;
        case 'song-lists':
            hash = data.folderId ? `#lists/${data.folderId}` : '#lists';
            break;
        case 'search':
            hash = data.query ? `#search/${encodeURIComponent(data.query)}` : '#search';
            break;
        case 'home':
        default:
            hash = '';
            break;
    }

    const url = hash || window.location.pathname;
    if (replace) {
        history.replaceState(state, '', url);
    } else {
        history.pushState(state, '', url);
    }
}

function handleHistoryNavigation(state) {
    if (!state) {
        // If no state, we might be back at the initial page load state
        // Check if there's a hash we should respect (like #song/id)
        if (handleDeepLink()) {
            return;
        }
        showView('home');
        return;
    }

    switch (state.view) {
        case 'home':
            showView('home');
            break;
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
        case 'list':
            if (state.listId) {
                showListView(state.listId);
            }
            break;
        case 'song-lists':
            showSongListsView(state.folderId || null);
            break;
        case 'search':
        default:
            showView('search');
            if (state.query) {
                searchInput.value = state.query;
                search(state.query);
            } else if (searchInput?.value) {
                // Re-run search with current input value when navigating back
                search(searchInput.value);
            }
            break;
    }
}

function showView(mode) {
    // Update state - this will trigger the subscriber
    setCurrentView(mode);
}

// Subscribe to view changes and update DOM accordingly
function initViewSubscription() {
    const searchContainer = document.querySelector('.search-container');

    subscribe('currentView', (view) => {
        // Stop any playing tablature audio when leaving song view
        if (tablaturePlayer?.isPlaying) {
            tablaturePlayer.stop();
        }

        // Exit fullscreen mode when navigating away from song/work views
        if (view !== 'song' && view !== 'work') {
            document.body.classList.remove('fullscreen-mode');
            setFullscreenMode(false);
        }

        // Close any open editor hints panel
        closeHints();

        // Exit edit mode when navigating away from the editor
        if (view !== 'add-song') {
            exitEditMode();
        }

        // Close bottom sheet if open (it has position: fixed so stays visible)
        bottomSheet?.classList.add('hidden');
        bottomSheetBackdrop?.classList.add('hidden');

        // Reset all nav states
        [navHome, navSearch, navAddSong, navFavorites].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });

        // Clear list view state - but NOT when opening a song or viewing a list (preserve list context for navigation)
        if (view !== 'song' && view !== 'work' && view !== 'list') {
            clearListView();
        }

        // Hide landing page when not on home view
        const isHome = view === 'home';
        landingPage?.classList.toggle('hidden', !isHome);

        switch (view) {
            case 'home':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                navHome?.classList.add('active');
                break;
            case 'search':
                searchContainer?.classList.remove('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                navSearch?.classList.add('active');
                // Show empty state if no search query (don't show random songs)
                if (!searchInput?.value?.trim() && resultsDiv) {
                    resultsDiv.innerHTML = '<div class="search-prompt">Search for songs by title, artist, lyrics, or use filters like <code>tag:bluegrass</code></div>';
                }
                searchInput?.focus();
                break;
            case 'add-song':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.remove('hidden');
                songListsView?.classList.add('hidden');
                navAddSong?.classList.add('active');
                break;
            case 'favorites':
                searchContainer?.classList.remove('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                navFavorites?.classList.add('active');
                showFavorites();
                break;
            case 'song':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.remove('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                break;
            case 'list':
                searchContainer?.classList.remove('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                break;
            case 'song-lists':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.remove('hidden');
                // renderManageListsView is called by showSongListsView
                break;
        }
    });
}

// ============================================
// LANDING PAGE
// ============================================

// Collection images and fallback icons
const COLLECTION_IMAGES = {
    'bluegrass-standards': 'images/Scruggs.webp',
    'all-bluegrass': 'images/billy.png',
    'gospel': 'images/jimmy_martin_gospel.jpg',
    'fiddle-tunes': 'images/fiddle_tunes.png',
    'all-songs': 'images/jam_friendly.png',
    'waltz': 'images/waltz.png'
};

const COLLECTION_ICONS = {
    'bluegrass-standards': '🎸',
    'first-generation': '👴',
    'gospel': '⛪',
    'fiddle-tunes': '🎻',
    'jam-friendly': '🤝',
    'waltz': '💃',
    'classic-country': '🤠',
    'old-time': '🪕',
    'chord-explorer': '🎹'
};

/**
 * Render collection cards on the landing page
 */
function renderCollectionCards() {
    if (!collectionsGrid) return;

    const cards = COLLECTIONS.map(collection => {
        // Count songs matching the query (or total for "all songs", or skip for tools)
        const count = collection.isToolLink ? 0 : collection.isSearchLink ? allSongs.length : getCollectionSongCount(collection.query);
        const icon = COLLECTION_ICONS[collection.id] || '🎵';
        const imageSrc = COLLECTION_IMAGES[collection.id];

        // Use image if available, otherwise fall back to emoji icon
        const imageContent = imageSrc
            ? `<img src="${imageSrc}" alt="${escapeHtml(collection.title)}">`
            : icon;

        // Determine href based on collection type
        const href = collection.isToolLink
            ? collection.href
            : collection.isSearchLink
            ? '#search'
            : `#search/${encodeURIComponent(collection.query)}`;

        return `
            <a href="${href}"
               class="collection-card${imageSrc ? ' has-image' : ''}${collection.isSearchLink ? ' search-all' : ''}${collection.isToolLink ? ' tool-link' : ''}"
               data-collection="${collection.id}"
               style="--collection-color: ${collection.color}">
                <div class="collection-image">
                    ${imageContent}
                </div>
                <div class="collection-content">
                    <h3 class="collection-title">${escapeHtml(collection.title)}</h3>
                    <p class="collection-description">${escapeHtml(collection.description)}</p>
                    ${collection.isToolLink ? '' : `<span class="collection-count">${count.toLocaleString()} songs</span>`}
                </div>
            </a>
        `;
    }).join('');

    collectionsGrid.innerHTML = cards;

    // Add click handlers for collection cards
    collectionsGrid.querySelectorAll('.collection-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const href = card.getAttribute('href');
            const isSearchAll = card.classList.contains('search-all');
            const collectionId = card.dataset.collection;

            // Tool links navigate directly (don't prevent default)
            if (href && !href.startsWith('#')) {
                track('collection_click', { collection: collectionId, type: 'tool' });
                return; // Let the link navigate normally
            }

            e.preventDefault();

            if (isSearchAll) {
                // Navigate to search view without query
                searchInput.value = '';
                showView('search');
                pushHistoryState('search', { query: '' });
                track('collection_click', { collection: 'all-songs' });
            } else if (href && href.startsWith('#search/')) {
                const query = decodeURIComponent(href.slice(8));
                searchInput.value = query;

                // Search with pinned songs first
                searchWithPins(query, collectionId);

                showView('search');
                pushHistoryState('search', { query });
                track('collection_click', { collection: collectionId });
            }
        });
    });
}

/**
 * Search with pinned songs appearing first
 */
function searchWithPins(query, collectionId) {
    const pins = COLLECTION_PINS[collectionId] || [];

    // Get all matching songs from the query (skip auto-render, we'll handle it)
    const results = search(query, { skipRender: true });

    if (!results || results.length === 0) {
        renderResults([], '');
        return [];
    }

    if (pins.length === 0) {
        // No pinned songs, just render normally (already sorted by canonical_rank)
        renderResults(results.slice(0, 50), '');
        return results;
    }

    // Separate pinned and non-pinned songs
    const pinnedSongs = [];
    const otherSongs = [];

    for (const song of results) {
        if (pins.includes(song.id)) {
            pinnedSongs.push(song);
        } else {
            otherSongs.push(song);
        }
    }

    // Sort pinned songs by their position in the pins array
    pinnedSongs.sort((a, b) => pins.indexOf(a.id) - pins.indexOf(b.id));

    // Render with pinned songs first, then others sorted by canonical_rank
    const reordered = [...pinnedSongs, ...otherSongs];
    renderResults(reordered.slice(0, 50), '');

    return reordered;
}

/**
 * Get count of songs matching a collection query
 * Uses simplified tag matching for performance
 */
function getCollectionSongCount(query) {
    if (!allSongs.length) return 0;

    // Parse the query to extract tag filters
    const tagMatch = query.match(/tag:(\w+)/i);
    if (!tagMatch) return 0;

    const tag = tagMatch[1].toLowerCase();
    return allSongs.filter(song => {
        if (!song.tags || typeof song.tags !== 'object') return false;
        // Tags are stored as object keys (e.g., { Bluegrass: {score: 50}, ... })
        const tagKeys = Object.keys(song.tags);
        return tagKeys.some(t => t.toLowerCase() === tag);
    }).length;
}

/**
 * Show the landing page (home view)
 */
function showLandingPage() {
    showView('home');
    pushHistoryState('home');
}

function handleDeepLink() {
    const hash = window.location.hash;
    if (!hash) return false;

    // Use replace=true for deep links to avoid duplicate history entries
    // (the URL is already set from the initial page load)

    if (hash.startsWith('#work/')) {
        // Work view: #work/{id} or #work/{id}/parts/{partId}
        const pathParts = hash.slice(6).split('/');
        const workId = pathParts[0];
        const partId = pathParts[2]; // undefined if just #work/{id}
        trackDeepLink('work', hash);
        openWork(workId, { partId, fromDeepLink: true });
        return true;
    } else if (hash.startsWith('#song/')) {
        // Legacy route - redirect to #work/
        const songId = hash.slice(6);
        window.location.hash = `#work/${songId}`;
        return true;
    } else if (hash === '#add') {
        trackDeepLink('add', hash);
        showView('add-song');
        pushHistoryState('add-song', {}, true);
        return true;
    } else if (hash === '#request-song') {
        trackDeepLink('request-song', hash);
        // Clear the hash and open the modal
        window.location.hash = '';
        openSongRequestModal();
        return true;
    } else if (hash === '#favorites') {
        // Backward compatibility: redirect #favorites to #list/favorites
        trackDeepLink('favorites', hash);
        showView('favorites');
        pushHistoryState('favorites', {}, true);
        return true;
    } else if (hash.startsWith('#list/')) {
        const parts = hash.slice(6).split('/');
        const listId = parts[0];
        const songId = parts[1]; // undefined if just #list/{id}

        // Handle favorites as a special list
        if (listId === 'favorites') {
            if (songId) {
                // Deep link to song within favorites: #list/favorites/{songId}
                trackDeepLink('favorites-song', hash);
                openSongInFavorites(songId, true);
            } else {
                // Deep link to favorites: #list/favorites
                trackDeepLink('favorites', hash);
                showView('favorites');
                pushHistoryState('favorites', {}, true);
            }
            return true;
        }

        if (songId) {
            // Deep link to song within list: #list/{uuid}/{songId}
            trackDeepLink('list-song', hash);
            // First load the list to set up context, then open the song
            openSongInList(listId, songId, true);
        } else {
            // Deep link to list: #list/{uuid}
            trackDeepLink('list', hash);
            showListView(listId);
            pushHistoryState('list', { listId }, true);
        }
        return true;
    } else if (hash.startsWith('#invite/')) {
        // Invite link to become co-owner of a list
        const token = hash.slice(8);
        trackDeepLink('invite', hash);
        handleInviteLink(token);
        return true;
    } else if (hash === '#lists' || hash.startsWith('#lists/')) {
        // Song Lists view: #lists or #lists/{folderId}
        const folderId = hash.length > 7 ? hash.slice(7) : null;
        trackDeepLink('song-lists', hash);
        showSongListsView(folderId);
        pushHistoryState('song-lists', { folderId }, true);
        return true;
    } else if (hash === '#search') {
        // Search view without query
        trackDeepLink('search', hash);
        searchInput.value = '';
        showView('search');
        pushHistoryState('search', {}, true);
        return true;
    } else if (hash.startsWith('#search/')) {
        const query = decodeURIComponent(hash.slice(8));
        trackDeepLink('search', hash);
        searchInput.value = query;
        search(query);
        showView('search');
        pushHistoryState('search', { query }, true);
        return true;
    }

    return false;
}

/**
 * Open a song within the favorites context (for deep linking)
 */
function openSongInFavorites(songId, fromDeepLink = false) {
    // Get favorites song IDs that exist in allSongs
    const favList = getFavoritesList();
    const favSongIds = favList ? favList.songs.filter(id => allSongs.find(s => s.id === id)) : [];
    const songIndex = favSongIds.indexOf(songId);

    // Set up favorites context for prev/next navigation
    setListContext({
        listId: 'favorites',
        listName: 'Favorites',
        songIds: favSongIds,
        currentIndex: songIndex >= 0 ? songIndex : 0
    });

    // Open the song with favorites context
    openSong(songId, { fromList: true, listId: 'favorites', fromDeepLink });
}

/**
 * Open a song within a list context (for deep linking)
 */
async function openSongInList(listId, songId, fromDeepLink = false) {
    const listData = await fetchListData(listId);

    if (!listData) {
        // List not found - fall back to opening song without context
        openSong(songId, { fromDeepLink });
        return;
    }

    // Set up list context for prev/next navigation
    const songIndex = listData.songs.indexOf(songId);
    setListContext({
        listId,
        listName: listData.name,
        songIds: listData.songs,
        currentIndex: songIndex >= 0 ? songIndex : 0
    });

    // Open the song with list context
    openSong(songId, { fromList: true, listId, fromDeepLink });
}

/**
 * Handle an invite link token to become co-owner of a list
 */
async function handleInviteLink(token) {
    if (typeof SupabaseAuth === 'undefined') {
        alert('Unable to process invite - authentication not available');
        window.location.hash = '';
        return;
    }

    // Check if user is signed in
    if (!SupabaseAuth.isLoggedIn()) {
        // Store the invite token for after sign-in
        sessionStorage.setItem('pendingInviteToken', token);
        alert('Please sign in to accept this invite.');
        // Clear the hash but keep it stored
        window.location.hash = '';
        return;
    }

    // User is signed in, process the invite
    try {
        const result = await SupabaseAuth.claimListInvite(token);

        if (result.error) {
            alert('Could not accept invite: ' + result.error);
            window.location.hash = '';
            return;
        }

        // Success! Navigate to the list
        alert('You are now a co-owner of this list!');

        // Refresh lists to include the new one
        if (typeof performFullListsSync === 'function') {
            await performFullListsSync();
        }

        // Navigate to the list
        if (result.list_id) {
            window.location.hash = `#list/${result.list_id}`;
        } else {
            window.location.hash = '';
        }
    } catch (err) {
        console.error('Error claiming invite:', err);
        alert('Failed to accept invite. Please try again.');
        window.location.hash = '';
    }
}

/**
 * Check for pending invite token after sign-in
 */
function checkPendingInvite() {
    const pendingToken = sessionStorage.getItem('pendingInviteToken');
    if (pendingToken) {
        sessionStorage.removeItem('pendingInviteToken');
        handleInviteLink(pendingToken);
    }
}

// ============================================
// SIDEBAR NAVIGATION
// ============================================

function openSidebar() {
    sidebar?.classList.add('open');
    sidebarBackdrop?.classList.remove('hidden');
    sidebarBackdrop?.classList.add('visible');
}

function closeSidebar() {
    sidebar?.classList.remove('open');
    sidebarBackdrop?.classList.remove('visible');
    setTimeout(() => {
        sidebarBackdrop?.classList.add('hidden');
    }, 300);
}

function navigateTo(mode) {
    closeSidebar();
    trackNavigation(mode);
    showView(mode);
    pushHistoryState(mode);
}

// ============================================
// LOAD INDEX
// ============================================

/**
 * Transform a pending_songs entry to match the index.jsonl format
 */
function transformPendingToIndexFormat(pending) {
    // Extract first line of lyrics (skip chord brackets)
    const extractFirstLine = (content) => {
        if (!content) return '';
        const lines = content.split('\n');
        for (const line of lines) {
            // Skip directives and empty lines
            if (line.startsWith('{') || !line.trim()) continue;
            // Remove chord brackets and return first lyric line
            const lyricsOnly = line.replace(/\[[^\]]+\]/g, '').trim();
            if (lyricsOnly) return lyricsOnly;
        }
        return '';
    };

    // Extract all lyrics (for search)
    const extractLyrics = (content) => {
        if (!content) return '';
        return content
            .split('\n')
            .filter(line => !line.startsWith('{') && line.trim())
            .map(line => line.replace(/\[[^\]]+\]/g, ''))
            .join(' ')
            .trim();
    };

    return {
        id: pending.id,
        title: pending.title,
        artist: pending.artist || '',
        composer: pending.composer || '',
        content: pending.content,
        key: pending.key || '',
        mode: pending.mode || '',
        tags: pending.tags || {},
        source: 'pending',
        replaces_id: pending.replaces_id,
        first_line: extractFirstLine(pending.content),
        lyrics: extractLyrics(pending.content),
    };
}

async function loadIndex() {
    if (resultsDiv) {
        resultsDiv.innerHTML = '<div class="loading">Loading songbook...</div>';
    }

    try {
        const response = await fetch('data/index.jsonl');
        const text = await response.text();
        const staticSongs = text.trim().split('\n').map(line => JSON.parse(line));

        // Fetch pending songs from Supabase (graceful failure if offline/error)
        let pendingSongs = [];
        try {
            const supabase = window.SupabaseAuth?.supabase;
            if (supabase) {
                const { data, error } = await supabase
                    .from('pending_songs')
                    .select('*');
                if (data && !error) {
                    pendingSongs = data.map(transformPendingToIndexFormat);
                    if (pendingSongs.length > 0) {
                        console.log(`Merged ${pendingSongs.length} pending song(s)`);
                    }
                }
            }
        } catch (e) {
            console.warn('Could not fetch pending songs:', e);
            // Static index still works - graceful degradation
        }

        // Merge: pending corrections replace static songs with same ID
        const replacedIds = new Set(
            pendingSongs.filter(s => s.replaces_id).map(s => s.replaces_id)
        );
        const filteredStatic = staticSongs.filter(s => !replacedIds.has(s.id));
        const songs = [...filteredStatic, ...pendingSongs];

        setAllSongs(songs);

        // Build song groups for version detection
        const groups = {};
        songs.forEach(song => {
            const groupId = song.group_id;
            if (groupId) {
                if (!groups[groupId]) {
                    groups[groupId] = [];
                }
                groups[groupId].push(song);
            }
        });
        setSongGroups(groups);

        // Count distinct song titles (for stats display)
        const distinctTitles = new Set(songs.map(s => s.title?.toLowerCase())).size;

        if (resultsDiv) {
            resultsDiv.innerHTML = '';
        }
        if (searchStats) {
            searchStats.textContent = `${distinctTitles.toLocaleString()} songs`;
        }

        // Render collection cards on landing page
        renderCollectionCards();

        // Enable browser history navigation
        setHistoryInitialized(true);

        // Handle deep links or show landing page by default
        if (!handleDeepLink()) {
            showView('home');
            history.replaceState({ view: 'home' }, '', window.location.pathname);
        }
    } catch (error) {
        console.error('Failed to load index:', error);
        if (resultsDiv) {
            resultsDiv.innerHTML = `<div class="loading">Error loading songs: ${error.message}</div>`;
        }
    }
}

// ============================================
// AUTH UI
// ============================================

function updateAuthUI(user) {
    if (user) {
        // Hide sign-in button, show user info
        signInBtn?.classList.add('hidden');
        userInfo?.classList.remove('hidden');

        // Populate user info
        if (userAvatar) {
            userAvatar.src = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
        }
        if (userName) {
            userName.textContent = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
        }

        updateSyncUI('syncing');
        performFullListsSync();
    } else {
        // Show sign-in button, hide user info
        signInBtn?.classList.remove('hidden');
        userInfo?.classList.add('hidden');
        updateSyncUI('offline');
    }
}

function updateVisitorStats(totalViews, totalVisitors) {
    if (visitorStatsEl && totalViews !== undefined) {
        visitorStatsEl.textContent = `${totalViews.toLocaleString()} page views · ${totalVisitors.toLocaleString()} visitors`;
    }
}

// ============================================
// MODALS
// ============================================

function closeAccountModal() {
    accountModal?.classList.add('hidden');
}

function openAccountModal() {
    accountModal?.classList.remove('hidden');
}

function closeListsModal() {
    listsModal?.classList.add('hidden');
}

function openListsModal() {
    listsModal?.classList.remove('hidden');
    renderListsModal();
}


// ============================================
// FEEDBACK
// ============================================

function handleFeedbackOption(type) {
    closeSidebar();

    const song = getCurrentSong();

    switch (type) {
        case 'song-issue':
            // Open bug report modal for song display issues
            if (bugModal) {
                bugModal.classList.remove('hidden');
                if (bugFeedback) {
                    bugFeedback.value = song ? `Song: ${song.title} by ${song.artist}\n\n` : '';
                    bugFeedback.focus();
                }
            }
            break;
        case 'song-correction':
            // Show correction modal with edit option
            if (song) {
                correctionModal?.classList.remove('hidden');
            } else {
                // No song open, just show feedback form
                openContactModal('Song Correction', '');
            }
            break;
        case 'search-problem':
        case 'app-issue':
        case 'request-song':
        case 'feature-idea':
        case 'general':
        case 'copyright':
            // Open contact modal for general feedback
            const titles = {
                'search-problem': 'Report Search Problem',
                'app-issue': 'Report App Issue',
                'request-song': 'Request a Song',
                'feature-idea': 'Feature Idea',
                'general': 'General Feedback',
                'copyright': 'Copyright Concern'
            };
            openContactModal(titles[type] || 'Send Feedback', '');
            break;
    }
}

function openContactModal(title, prefill) {
    if (contactModal) {
        if (contactModalTitle) {
            contactModalTitle.textContent = title;
        }
        contactModal.classList.remove('hidden');
        if (contactFeedback) {
            contactFeedback.value = prefill;
            contactFeedback.focus();
        }
    }
}

function closeBugModal() {
    bugModal?.classList.add('hidden');
    if (bugFeedback) bugFeedback.value = '';
}

function closeCorrectionModal() {
    correctionModal?.classList.add('hidden');
}

function closeContactModal() {
    contactModal?.classList.add('hidden');
    if (contactFeedback) contactFeedback.value = '';
}

function submitBugReport() {
    const feedback = bugFeedback?.value.trim();
    if (!feedback) return;

    const subject = encodeURIComponent('Song Issue Report');
    const body = encodeURIComponent(feedback);
    window.location.href = `mailto:bluegrassbook.feedback@gmail.com?subject=${subject}&body=${body}`;
    closeBugModal();
}

function submitContactForm() {
    const feedback = contactFeedback?.value.trim();
    if (!feedback) return;

    const title = contactModalTitle?.textContent || 'Feedback';
    track('feedback_submit', { type: title });
    const subject = encodeURIComponent(title);
    const body = encodeURIComponent(feedback);
    window.location.href = `mailto:bluegrassbook.feedback@gmail.com?subject=${subject}&body=${body}`;
    closeContactModal();
}

// ============================================
// PRINT VIEW
// ============================================

function openPrintView() {
    // Simply trigger the browser's print dialog
    // CSS @media print handles the formatting
    window.print();
}

// ============================================
// PRINT LIST VIEW
// ============================================

function openPrintListView() {
    // Get the current list
    const listId = getViewingListId();
    if (!listId) return;

    // Find the list (favorites is now just a regular list)
    let list = userLists.find(l => l.id === listId || l.cloudId === listId);

    // Handle 'favorites' ID
    if (!list && listId === 'favorites') {
        list = getFavoritesList();
    }

    if (!list) return;

    // Get all songs in the list
    const listSongs = list.songs
        .map(id => allSongs.find(s => s.id === id))
        .filter(Boolean);

    if (listSongs.length === 0) {
        alert('No songs in this list to print.');
        return;
    }

    // Get current view preferences
    const prefs = {
        compactMode,
        nashvilleMode,
        chordDisplayMode,
        showSectionLabels,
        twoColumnMode,
        fontSizeLevel
    };

    const printHtml = generatePrintListPage(list.name, listSongs, prefs);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow popups for print view');
        return;
    }
    printWindow.document.write(printHtml);
    printWindow.document.close();
}

function generatePrintListPage(listName, songs, prefs) {
    // Build songs data for the print page
    const songsData = songs.map(song => ({
        id: song.id,
        title: song.title || 'Unknown',
        artist: song.artist || '',
        key: song.key || 'C',
        content: song.content || ''
    }));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(listName)} - Bluegrass Book</title>
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
            position: sticky;
            top: 0;
            z-index: 100;
        }
        @media print {
            .controls { display: none; }
            body { padding: 0; max-width: none; }
            .song-container { page-break-inside: avoid; }
            body.page-per-song .song-container:not(:last-child) { page-break-after: always; }
        }
        .control-group { display: flex; align-items: center; gap: 0.5rem; }
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
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 12px;
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
        .song-container {
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 1px dashed #ccc;
        }
        .song-container:last-child {
            border-bottom: none;
        }
        .song-header {
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid #999;
        }
        .two-columns .song-header { column-span: all; }
        .title {
            font-size: 1.25rem;
            font-weight: bold;
            font-family: system-ui, sans-serif;
        }
        .artist {
            font-size: 0.95rem;
            color: #444;
            font-family: system-ui, sans-serif;
        }
        .key-info {
            font-size: 0.85rem;
            color: #666;
            margin-top: 0.15rem;
            font-family: system-ui, sans-serif;
        }
        .two-columns .song-content {
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
        .hide-labels .section-label { display: none; }
        .line-group { margin-bottom: 0.25rem; }
        .chord-line {
            font-weight: bold;
            color: black;
            white-space: pre;
            line-height: 1.2;
        }
        .chord-line.nashville { color: #444; }
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
        .song-content { font-size: var(--font-size, 14px); }
    </style>
</head>
<body class="page-per-song${prefs.twoColumnMode ? ' two-columns' : ''}${!prefs.showSectionLabels ? ' hide-labels' : ''}">
    <div class="controls">
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
                    <option value="all"${prefs.chordDisplayMode === 'all' ? ' selected' : ''}>All Chords</option>
                    <option value="first"${prefs.chordDisplayMode === 'first' ? ' selected' : ''}>First Only</option>
                    <option value="none"${prefs.chordDisplayMode === 'none' ? ' selected' : ''}>No Chords</option>
                </select>
            </label>
            <label><input type="checkbox" id="compact-toggle"${prefs.compactMode ? ' checked' : ''}> Compact</label>
            <label><input type="checkbox" id="nashville-toggle"${prefs.nashvilleMode ? ' checked' : ''}> Nashville</label>
            <label><input type="checkbox" id="columns-toggle"${prefs.twoColumnMode ? ' checked' : ''}> 2 Columns</label>
            <label><input type="checkbox" id="labels-toggle"${prefs.showSectionLabels ? ' checked' : ''}> Labels</label>
            <label><input type="checkbox" id="page-per-song-toggle" checked> Page/Song</label>
        </div>
        <button class="print-btn" onclick="window.print()">Print</button>
    </div>

    <div id="songs-container"></div>

    <script>
        const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
        const songsData = ${JSON.stringify(songsData)};
        let nashvilleMode = ${prefs.nashvilleMode};
        let compactMode = ${prefs.compactMode};
        let chordMode = '${prefs.chordDisplayMode}';

        function normalizeKey(key) {
            const map = { 'Db': 'C#', 'D#': 'Eb', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb' };
            return map[key] || key;
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

        function lineToAscii(line, songKey) {
            const chordRegex = /\\[([^\\]]+)\\]/g;
            const chords = [];
            let match;
            let lastIndex = 0;
            let lyricsOnly = '';

            while ((match = chordRegex.exec(line)) !== null) {
                lyricsOnly += line.substring(lastIndex, match.index);
                let chord = match[1];
                if (nashvilleMode) {
                    chord = toNashville(chord, songKey);
                }
                chords.push({ chord, position: lyricsOnly.length });
                lastIndex = match.index + match[0].length;
            }
            lyricsOnly += line.substring(lastIndex);

            let chordLine = '';
            for (const { chord, position } of chords) {
                const minPos = chordLine.length > 0 ? chordLine.length + 1 : 0;
                const targetPos = Math.max(position, minPos);
                while (chordLine.length < targetPos) {
                    chordLine += ' ';
                }
                chordLine += chord;
            }

            return { chordLine: chordLine.trimEnd(), lyricLine: lyricsOnly };
        }

        function escapeHtmlInline(text) {
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function renderSong(song) {
            const NL = String.fromCharCode(10);
            const lines = song.content.split(NL);
            let html = '';
            let inSection = false;
            let currentSectionType = '';
            let currentSectionLabel = '';
            let currentSectionLines = [];
            const seenSections = {};

            function renderSection(sectionLines, hideChords) {
                let sectionHtml = '';
                for (const line of sectionLines) {
                    if (!line.trim()) {
                        sectionHtml += '<div class="line-group"><div class="lyric-line">&nbsp;</div></div>';
                        continue;
                    }
                    const { chordLine, lyricLine } = lineToAscii(line, song.key);
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

                let foundMatch = null;
                if (compactMode || chordMode === 'first') {
                    for (const key in seenSections) {
                        if (seenSections[key].content === contentKey) {
                            foundMatch = seenSections[key];
                            break;
                        }
                    }
                }

                const hideChords = chordMode === 'none' || (chordMode === 'first' && foundMatch);

                if (compactMode && foundMatch) {
                    html += '<div class="repeat-instruction">[Repeat ' + foundMatch.label + ']</div>';
                } else {
                    html += '<div class="section"><div class="section-label">' + label + '</div>';
                    html += renderSection(currentSectionLines, hideChords);
                    html += '</div>';

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
                if (line.indexOf('{meta:') === 0) continue;

                if (line.indexOf('{start_of_') === 0) {
                    flushSection();
                    const typeMatch = line.match(/start_of_(verse|chorus|bridge)/);
                    if (typeMatch) {
                        currentSectionType = typeMatch[1];
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

                if (line.indexOf('{end_of_') === 0) {
                    flushSection();
                    inSection = false;
                    continue;
                }

                if (line.charAt(0) === '{' && line.charAt(line.length - 1) === '}') continue;

                if (inSection) {
                    currentSectionLines.push(line);
                } else {
                    if (!line.trim()) {
                        html += '<div class="line-group"><div class="lyric-line">&nbsp;</div></div>';
                        continue;
                    }
                    const { chordLine, lyricLine } = lineToAscii(line, song.key);
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
            return html;
        }

        function renderAllSongs() {
            const container = document.getElementById('songs-container');
            container.innerHTML = songsData.map((song, idx) => {
                return '<div class="song-container">' +
                    '<div class="song-header">' +
                        '<div class="title">' + (idx + 1) + '. ' + escapeHtmlInline(song.title) + '</div>' +
                        (song.artist ? '<div class="artist">' + escapeHtmlInline(song.artist) + '</div>' : '') +
                        '<div class="key-info">Key: ' + escapeHtmlInline(song.key) + '</div>' +
                    '</div>' +
                    '<div class="song-content">' + renderSong(song) + '</div>' +
                '</div>';
            }).join('');
        }

        let currentFontSize = 14;
        const fontSizeInput = document.getElementById('font-size-input');

        function updateFontSize() {
            currentFontSize = Math.max(8, Math.min(32, currentFontSize));
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
            renderAllSongs();
        });

        document.getElementById('chord-mode-select').addEventListener('change', (e) => {
            chordMode = e.target.value;
            renderAllSongs();
        });

        document.getElementById('labels-toggle').addEventListener('change', (e) => {
            document.body.classList.toggle('hide-labels', !e.target.checked);
        });

        document.getElementById('columns-toggle').addEventListener('change', (e) => {
            document.body.classList.toggle('two-columns', e.target.checked);
        });

        document.getElementById('compact-toggle').addEventListener('change', (e) => {
            compactMode = e.target.checked;
            renderAllSongs();
        });

        document.getElementById('page-per-song-toggle').addEventListener('change', (e) => {
            document.body.classList.toggle('page-per-song', e.target.checked);
        });

        renderAllSongs();
    <\/script>
</body>
</html>`;
}

// ============================================
// EXPORT FUNCTIONS
// ============================================

function handleExport(action) {
    const song = getCurrentSong();
    const chordpro = getCurrentChordpro();
    if (!song || !chordpro) return;

    const title = song.title || 'song';
    trackExport(song.id, action);

    switch (action) {
        case 'copy-chordpro':
            navigator.clipboard.writeText(chordpro);
            break;
        case 'copy-text':
            const text = chordpro.replace(/\[[^\]]+\]/g, '').replace(/\{[^}]+\}/g, '');
            navigator.clipboard.writeText(text);
            break;
        case 'download-chordpro':
            downloadFile(`${title}.pro`, chordpro, 'text/plain');
            break;
        case 'download-text':
            const plainText = chordpro.replace(/\[[^\]]+\]/g, '').replace(/\{[^}]+\}/g, '');
            downloadFile(`${title}.txt`, plainText, 'text/plain');
            break;
    }
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

// ============================================
// INITIALIZATION
// ============================================

function init() {
    // Initialize theme
    initTheme();

    // Load saved view preferences (before rendering any songs)
    loadViewPrefs();

    // Initialize reactive view state subscription
    initViewSubscription();

    // Initialize analytics (early, before other modules)
    initAnalytics();

    // Initialize flags module
    initFlags();

    // Initialize song request module
    initSongRequest();

    // Initialize lists module (handles favorites as a special list)
    initLists({
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
    });

    initSongView({
        songView,
        songContent,
        resultsDiv,
        listPickerDropdown,
        versionModal,
        versionModalClose,
        versionModalTitle,
        versionList,
        pushHistoryState,
        showView,
        backBtn,
        // Navigation elements
        navBar,
        navPrevBtn,
        navNextBtn,
        navPosition,
        navListName,
        fullscreenBtn
    });

    initSearch({
        searchInput,
        searchStats,
        resultsDiv,
        navFavorites,
        navSearch
    });

    // Update URL when user types in search (debounced, uses replaceState to avoid history spam)
    let urlUpdateTimeout = null;
    searchInput?.addEventListener('input', (e) => {
        if (urlUpdateTimeout) clearTimeout(urlUpdateTimeout);
        urlUpdateTimeout = setTimeout(() => {
            const query = e.target.value.trim();
            // Use replaceState so back button goes to previous page, not previous keystroke
            pushHistoryState('search', { query }, true);
        }, 500);
    });

    initTagDropdown({
        searchInput,
        tagDropdownBtn,
        tagDropdownContent,
        search,
        parseSearchQuery
    });

    initEditor({
        editorPanel,
        editorTitle,
        editorArtist,
        editorWriter,
        editorContent,
        editorPreviewContent,
        editorCopyBtn,
        editorSaveBtn,
        editorSubmitBtn,
        editorStatus,
        editorNashville,
        editorComment,
        editCommentRow,
        editSongBtn,
        hintsBtn,
        hintsPanel,
        hintsBackdrop,
        hintsClose,
        autoDetectCheckbox,
        navSearch,
        navAddSong,
        navFavorites,
        resultsDiv,
        songView
    });

    // Setup event listeners

    // Theme toggle
    themeToggle?.addEventListener('click', toggleTheme);

    // Sidebar
    menuBtn?.addEventListener('click', openSidebar);
    sidebarBackdrop?.addEventListener('click', closeSidebar);
    sidebarClose?.addEventListener('click', closeSidebar);

    // Home buttons - go home
    const goHome = () => {
        closeSidebar();
        searchInput.value = '';
        showView('home');
        pushHistoryState('home');
    };

    logoLink?.addEventListener('click', (e) => {
        e.preventDefault();
        goHome();
    });

    // Report bug link
    const reportBugLink = document.getElementById('report-bug-link');
    reportBugLink?.addEventListener('click', (e) => {
        e.preventDefault();
        openContactModal('Report a Bug', '');
    });

    // Navigation
    navHome?.addEventListener('click', () => navigateTo('home'));
    navSearch?.addEventListener('click', () => navigateTo('search'));
    navAddSong?.addEventListener('click', () => navigateTo('add-song'));
    navFavorites?.addEventListener('click', () => navigateTo('favorites'));
    editorBackBtn?.addEventListener('click', () => navigateTo('search'));

    // Landing page search - switches to search view on input
    landingSearchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = landingSearchInput.value.trim();
            if (query) {
                searchInput.value = query;
                search(query);
                showView('search');
                pushHistoryState('search', { query });
                landingSearchInput.value = '';
            }
        }
    });

    // Account modal
    accountModalClose?.addEventListener('click', closeAccountModal);
    accountModal?.addEventListener('click', (e) => {
        if (e.target === accountModal) closeAccountModal();
    });

    // Sign out button
    const signOutBtn = document.getElementById('account-sign-out-btn');
    signOutBtn?.addEventListener('click', async () => {
        if (typeof SupabaseAuth !== 'undefined') {
            await SupabaseAuth.signOut();
            closeAccountModal();
            location.reload();
        }
    });

    // Manual sync button in account modal
    const forceSyncBtn = document.getElementById('force-sync-btn');
    forceSyncBtn?.addEventListener('click', async () => {
        updateSyncUI('syncing');
        await performFullListsSync();
    });

    // Song Lists page
    songListsBtn?.addEventListener('click', () => {
        closeSidebar();
        showSongListsView();
        pushHistoryState('song-lists', {});
    });
    songListsBackBtn?.addEventListener('click', () => {
        // Use browser back to return to previous view
        history.back();
    });
    createListBtn?.addEventListener('click', () => {
        startCreateListInView();
    });
    listsModalClose?.addEventListener('click', closeListsModal);
    listsModal?.addEventListener('click', (e) => {
        if (e.target === listsModal) closeListsModal();
    });

    // Print list button
    printListBtn?.addEventListener('click', openPrintListView);

    // Sidebar feedback button
    navFeedback?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSidebar();
        // Open contact modal directly for general feedback
        setTimeout(() => {
            openContactModal('Send Feedback', '');
        }, 150);
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchTipsBtn?.contains(e.target) && !searchTipsDropdown?.contains(e.target)) {
            searchTipsDropdown?.classList.add('hidden');
        }
        // Close list picker dropdown
        if (!listPickerBtn?.contains(e.target) && !listPickerDropdown?.contains(e.target)) {
            listPickerDropdown?.classList.add('hidden');
        }
    });

    // Search tips dropdown
    searchTipsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        searchTipsDropdown?.classList.toggle('hidden');
    });

    // Bug report modal
    bugModalClose?.addEventListener('click', closeBugModal);
    bugModal?.addEventListener('click', (e) => {
        if (e.target === bugModal) closeBugModal();
    });
    bugSubmitBtn?.addEventListener('click', submitBugReport);

    // Song correction modal
    correctionModalClose?.addEventListener('click', closeCorrectionModal);
    correctionModal?.addEventListener('click', (e) => {
        if (e.target === correctionModal) closeCorrectionModal();
    });
    correctionEditBtn?.addEventListener('click', () => {
        closeCorrectionModal();
        // Trigger edit mode for current song
        enterEditMode(getCurrentSong());
    });
    correctionFeedbackBtn?.addEventListener('click', () => {
        closeCorrectionModal();
        const song = getCurrentSong();
        openContactModal('Song Correction', song ? `Song: ${song.title} by ${song.artist}\n\n` : '');
    });

    // Contact modal
    contactModalClose?.addEventListener('click', closeContactModal);
    contactModal?.addEventListener('click', (e) => {
        if (e.target === contactModal) closeContactModal();
    });
    contactSubmitBtn?.addEventListener('click', submitContactForm);

    // List picker (song view) - uses unified ListPicker component
    listPickerBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const song = getCurrentSong();
        if (song) {
            showListPicker(song.id, listPickerBtn, {
                onUpdate: () => updateTriggerButton(listPickerBtn, song.id)
            });
        }
    });

    // Create list from modal
    modalCreateListBtn?.addEventListener('click', () => {
        const name = modalNewListInput?.value.trim();
        if (name) {
            createList(name);
            modalNewListInput.value = '';
            renderListsModal();
        }
    });

    // Export dropdown - toggle on button click
    function positionDropdown(btn, dropdown) {
        if (!btn || !dropdown) return;
        const rect = btn.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.left = `${rect.left}px`;
    }

    exportBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        exportDropdown?.classList.toggle('hidden');
        if (!exportDropdown?.classList.contains('hidden')) {
            positionDropdown(exportBtn, exportDropdown);
        }
    });

    // Export option clicks
    exportDropdown?.querySelectorAll('.export-option[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action === 'print') {
                const song = getCurrentSong();
                if (song) trackExport(song.id, 'print');
                openPrintView();
            } else {
                handleExport(action);
            }
            exportDropdown.classList.add('hidden');
        });
    });

    // Bottom sheet handlers (controls moved to quick controls bar, sheet now only has actions)
    function openBottomSheet() {
        bottomSheet?.classList.remove('hidden');
        bottomSheetBackdrop?.classList.remove('hidden');
        trackBottomSheet('open');
    }

    function closeBottomSheet() {
        bottomSheet?.classList.add('hidden');
        bottomSheetBackdrop?.classList.add('hidden');
    }

    // Close when clicking backdrop
    bottomSheetBackdrop?.addEventListener('click', closeBottomSheet);

    // Close when swiping down on handle (simple touch support)
    const handle = bottomSheet?.querySelector('.bottom-sheet-handle');
    handle?.addEventListener('click', closeBottomSheet);

    // Bottom sheet action handlers
    bottomSheet?.querySelectorAll('.sheet-action').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            closeBottomSheet();

            switch (action) {
                case 'lists':
                    listPickerDropdown?.classList.toggle('hidden');
                    if (!listPickerDropdown?.classList.contains('hidden')) {
                        // Position in center of screen for mobile (from bottom sheet)
                        listPickerDropdown.style.top = '50%';
                        listPickerDropdown.style.left = '50%';
                        listPickerDropdown.style.transform = 'translate(-50%, -50%)';
                        renderListPickerDropdown();
                    } else {
                        listPickerDropdown.style.transform = '';
                    }
                    break;
                case 'print':
                    openPrintView();
                    break;
                case 'copy':
                    handleExport('copy-chordpro');
                    break;
                case 'download':
                    handleExport('download-chordpro');
                    break;
                case 'edit':
                    enterEditMode(getCurrentSong());
                    break;
                case 'flag':
                    const song = getCurrentSong();
                    if (song) {
                        openFlagModal(song);
                    }
                    break;
            }
        });
    });

    // Make openBottomSheet available globally for song-view.js
    window.openBottomSheet = openBottomSheet;

    // ==========================================================================
    // Quick Controls Bar (dynamically rendered in song-view.js)
    // ==========================================================================

    // Quick controls bar state
    let quickBarCollapsed = localStorage.getItem('quickBarCollapsed') === 'true';

    function setQuickBarCollapsed(collapsed) {
        quickBarCollapsed = collapsed;
        localStorage.setItem('quickBarCollapsed', collapsed);
        const content = document.getElementById('quick-controls-content');
        const arrow = document.querySelector('#qc-toggle .disclosure-arrow');
        content?.classList.toggle('hidden', collapsed);
        if (arrow) arrow.textContent = collapsed ? '▼' : '▲';

        // Also toggle ABC fieldset visibility (for ABC notation songs)
        const abcFieldset = document.querySelector('.render-options-fieldset');
        abcFieldset?.classList.toggle('hidden', collapsed);
    }

    // Info bar collapse state
    let infoBarCollapsed = localStorage.getItem('infoBarCollapsed') !== 'false'; // Default collapsed

    function setInfoBarCollapsed(collapsed) {
        infoBarCollapsed = collapsed;
        localStorage.setItem('infoBarCollapsed', collapsed);
        const content = document.getElementById('info-content');
        const arrow = document.querySelector('#info-toggle .disclosure-arrow');
        content?.classList.toggle('hidden', collapsed);
        if (arrow) arrow.textContent = collapsed ? '▼' : '▲';
    }

    function closeAllQcDropdowns() {
        document.getElementById('qc-key-dropdown')?.classList.add('hidden');
        document.getElementById('qc-layout-dropdown')?.classList.add('hidden');
    }

    function positionKeyDropdown() {
        const keySelect = document.getElementById('qc-key-select');
        const keyDropdown = document.getElementById('qc-key-dropdown');
        if (!keySelect || !keyDropdown) return;
        const rect = keySelect.getBoundingClientRect();
        keyDropdown.style.top = `${rect.bottom + 4}px`;
        keyDropdown.style.left = `${Math.max(8, rect.left)}px`;
    }

    function positionLayoutDropdown() {
        const layoutBtn = document.getElementById('qc-layout-btn');
        const layoutDropdown = document.getElementById('qc-layout-dropdown');
        if (!layoutBtn || !layoutDropdown) return;
        const rect = layoutBtn.getBoundingClientRect();
        layoutDropdown.style.top = `${rect.bottom + 4}px`;
        layoutDropdown.style.left = `${Math.max(8, rect.left)}px`;
    }

    // Map enharmonic key names to their chromatic array equivalents
    const ENHARMONIC_TO_CHROMATIC = {
        // Major keys - map flats to sharps where chromatic array uses sharps
        'Db': 'C#', 'D#': 'Eb', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb',
        // Minor keys - map alternatives to chromatic array spellings
        'A#m': 'Bbm', 'D#m': 'Ebm', 'G#m': 'G#m' // G#m is in the array
    };

    function normalizeKeyForChromatic(key) {
        return ENHARMONIC_TO_CHROMATIC[key] || key;
    }

    function transposeBySemitone(direction) {
        if (!currentDetectedKey || !originalDetectedKey) return;
        const keys = originalDetectedMode === 'minor' ? CHROMATIC_MINOR_KEYS : CHROMATIC_MAJOR_KEYS;
        const normalizedKey = normalizeKeyForChromatic(currentDetectedKey);
        const currentIndex = keys.indexOf(normalizedKey);
        if (currentIndex === -1) return;
        const newIndex = (currentIndex + direction + keys.length) % keys.length;
        setCurrentDetectedKey(keys[newIndex]);
    }

    function populateKeyDropdown() {
        const keyDropdown = document.getElementById('qc-key-dropdown');
        if (!keyDropdown || !originalDetectedKey) {
            if (keyDropdown) keyDropdown.innerHTML = '';
            return;
        }
        const keys = originalDetectedMode === 'minor' ? CHROMATIC_MINOR_KEYS : CHROMATIC_MAJOR_KEYS;
        keyDropdown.innerHTML = keys.map(key => {
            const isActive = key === currentDetectedKey;
            const isOriginal = key === originalDetectedKey;
            return `<button class="${isActive ? 'active' : ''} ${isOriginal ? 'original' : ''}" data-key="${key}">${key}</button>`;
        }).join('');
    }

    function updateQuickControls() {
        // Re-query elements (they're dynamically created)
        const content = document.getElementById('quick-controls-content');
        const arrow = document.querySelector('#qc-toggle .disclosure-arrow');
        const keyValue = document.getElementById('qc-key-value');
        const nashville = document.getElementById('qc-nashville');
        const compact = document.getElementById('qc-compact');
        const twocol = document.getElementById('qc-twocol');
        const sections = document.getElementById('qc-sections');
        const chordMode = document.getElementById('qc-chord-mode');
        const strum = document.getElementById('qc-strum');

        // Update key display
        if (keyValue) keyValue.textContent = currentDetectedKey || '—';

        // Update Nashville toggle
        nashville?.classList.toggle('active', nashvilleMode);

        // Update layout checkboxes
        if (compact) compact.checked = compactMode;
        if (twocol) twocol.checked = twoColumnMode;
        if (sections) sections.checked = showSectionLabels;
        if (chordMode) chordMode.value = chordDisplayMode;

        // Update Strum Machine visibility
        const song = getCurrentSong ? getCurrentSong() : currentSong;
        strum?.classList.toggle('hidden', !song?.strum_machine_url);

        // Update controls collapse state - read from localStorage to stay in sync
        const currentQuickBarCollapsed = localStorage.getItem('quickBarCollapsed') === 'true';
        content?.classList.toggle('hidden', currentQuickBarCollapsed);
        if (arrow) arrow.textContent = currentQuickBarCollapsed ? '▼' : '▲';

        // Update info collapse state
        const infoContent = document.getElementById('info-content');
        const infoArrow = document.querySelector('#info-toggle .disclosure-arrow');
        infoContent?.classList.toggle('hidden', infoBarCollapsed);
        if (infoArrow) infoArrow.textContent = infoBarCollapsed ? '▼' : '▲';

        // Repopulate key dropdown
        populateKeyDropdown();
    }

    // Make updateQuickControls available globally
    window.updateQuickControls = updateQuickControls;

    // Event delegation for quick controls (elements are dynamically created)
    songContent?.addEventListener('click', (e) => {
        const target = e.target;

        // Size controls
        if (target.closest('#qc-size-down')) {
            if (fontSizeLevel > -5) setFontSizeLevel(fontSizeLevel - 1);
            return;
        }
        if (target.closest('#qc-size-up')) {
            if (fontSizeLevel < 6) setFontSizeLevel(fontSizeLevel + 1);
            return;
        }

        // Key transpose +/- (chromatic half-steps for vocal range adjustment)
        if (target.closest('#qc-key-down')) {
            transposeBySemitone(-1);
            return;
        }
        if (target.closest('#qc-key-up')) {
            transposeBySemitone(1);
            return;
        }

        // Key dropdown toggle
        if (target.closest('#qc-key-select')) {
            e.stopPropagation();
            const keyDropdown = document.getElementById('qc-key-dropdown');
            const wasHidden = keyDropdown?.classList.contains('hidden');
            closeAllQcDropdowns();
            if (wasHidden) {
                keyDropdown?.classList.remove('hidden');
                positionKeyDropdown();
            }
            return;
        }

        // Key dropdown selection
        if (target.closest('#qc-key-dropdown button')) {
            e.stopPropagation();
            const key = target.closest('button').dataset.key;
            if (key) {
                setCurrentDetectedKey(key);
                document.getElementById('qc-key-dropdown')?.classList.add('hidden');
            }
            return;
        }

        // Layout dropdown toggle
        if (target.closest('#qc-layout-btn')) {
            e.stopPropagation();
            const layoutDropdown = document.getElementById('qc-layout-dropdown');
            const wasHidden = layoutDropdown?.classList.contains('hidden');
            closeAllQcDropdowns();
            if (wasHidden) {
                layoutDropdown?.classList.remove('hidden');
                positionLayoutDropdown();
            }
            return;
        }

        // Nashville toggle
        if (target.closest('#qc-nashville')) {
            setNashvilleMode(!nashvilleMode);
            return;
        }

        // Strum Machine
        if (target.closest('#qc-strum')) {
            const strumBtn = document.getElementById('qc-strum');
            const url = strumBtn?.dataset.url;
            if (url) window.open(url, '_blank');
            return;
        }

        // Toggle controls collapse
        if (target.closest('#qc-toggle')) {
            setQuickBarCollapsed(!quickBarCollapsed);
            return;
        }

        // Toggle info collapse
        if (target.closest('#info-toggle')) {
            setInfoBarCollapsed(!infoBarCollapsed);
            return;
        }

        // Expand/collapse artists list
        if (target.closest('#artists-expand')) {
            const expandBtn = document.getElementById('artists-expand');
            const collapseBtn = document.getElementById('artists-collapse');
            const full = document.getElementById('artists-full');
            expandBtn?.classList.add('hidden');
            full?.classList.remove('hidden');
            full?.classList.add('visible');
            collapseBtn?.classList.remove('hidden');
            return;
        }
        if (target.closest('#artists-collapse')) {
            const expandBtn = document.getElementById('artists-expand');
            const collapseBtn = document.getElementById('artists-collapse');
            const full = document.getElementById('artists-full');
            collapseBtn?.classList.add('hidden');
            full?.classList.add('hidden');
            full?.classList.remove('visible');
            expandBtn?.classList.remove('hidden');
            return;
        }

        // Add to list button (in title row)
        if (target.closest('#add-to-list-btn')) {
            e.stopPropagation();
            const song = getCurrentSong ? getCurrentSong() : currentSong;
            const btn = document.getElementById('add-to-list-btn');
            if (song && typeof showListPicker === 'function') {
                showListPicker(song.id, btn, {
                    onUpdate: () => updateTriggerButton(btn, song.id)
                });
            }
            return;
        }

        // Focus button (in title row)
        if (target.closest('#focus-btn')) {
            toggleFullscreen();
            return;
        }
    });

    // Change event delegation for checkboxes and selects
    songContent?.addEventListener('change', (e) => {
        const target = e.target;

        if (target.id === 'qc-compact') {
            setCompactMode(target.checked);
            return;
        }
        if (target.id === 'qc-twocol') {
            setTwoColumnMode(target.checked);
            return;
        }
        if (target.id === 'qc-sections') {
            setShowSectionLabels(target.checked);
            return;
        }
        if (target.id === 'qc-chord-mode') {
            setChordDisplayMode(target.value);
            return;
        }
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!exportBtn?.contains(e.target) && !exportDropdown?.contains(e.target)) {
            exportDropdown?.classList.add('hidden');
        }
        // Close quick controls dropdowns (elements are dynamically created)
        const qcKeySelect = document.getElementById('qc-key-select');
        const qcKeyDropdown = document.getElementById('qc-key-dropdown');
        const qcLayoutBtn = document.getElementById('qc-layout-btn');
        const qcLayoutDropdown = document.getElementById('qc-layout-dropdown');
        if (!qcKeySelect?.contains(e.target) && !qcKeyDropdown?.contains(e.target)) {
            qcKeyDropdown?.classList.add('hidden');
        }
        if (!qcLayoutBtn?.contains(e.target) && !qcLayoutDropdown?.contains(e.target)) {
            qcLayoutDropdown?.classList.add('hidden');
        }
    });

    // History navigation
    window.addEventListener('popstate', (e) => {
        handleHistoryNavigation(e.state);
    });

    // Handle hash changes that don't trigger popstate (e.g. manual URL edits)
    window.addEventListener('hashchange', () => {
        handleHistoryNavigation(history.state);
    });

    // Initialize Supabase auth
    if (typeof SupabaseAuth !== 'undefined') {
        SupabaseAuth.init();
        SupabaseAuth.onAuthChange((event, user) => {
            updateAuthUI(user);
            // Check for pending invite after sign-in
            if (event === 'SIGNED_IN' && user) {
                checkPendingInvite();
            }
        });

        signInBtn?.addEventListener('click', async () => {
            closeAccountModal();
            await SupabaseAuth.signInWithGoogle();
        });

        // Click on user info opens account modal
        userInfo?.addEventListener('click', () => {
            openAccountModal();
        });

        // Log visit and update visitor stats
        SupabaseAuth.logVisit().then(({ data }) => {
            if (data) {
                updateVisitorStats(data.total_views, data.total_visitors);
            }
        });
    }

    // Load the index
    loadIndex();
}

// Start the app
init();

// Exit fullscreen button
if (exitFullscreenBtn) {
    exitFullscreenBtn.addEventListener('click', exitFullscreen);
}

// Song view button (open bottom sheet with controls)
if (songViewBtn) {
    songViewBtn.addEventListener('click', openSongControls);
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }

    // F key - toggle fullscreen mode (only when viewing a song)
    if (e.key === 'f' || e.key === 'F') {
        if (!songView.classList.contains('hidden')) {
            e.preventDefault();
            toggleFullscreen();
        }
    }

    // Escape - close bottom sheet first, then exit fullscreen
    if (e.key === 'Escape') {
        // If bottom sheet is open, close it first
        if (bottomSheet && !bottomSheet.classList.contains('hidden')) {
            bottomSheet.classList.add('hidden');
            bottomSheetBackdrop?.classList.add('hidden');
            return;
        }
        // Otherwise exit fullscreen
        exitFullscreen();
    }

    // Arrow keys for navigation (when viewing a song from a list)
    if (!songView.classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigatePrev();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateNext();
        }
    }
});
