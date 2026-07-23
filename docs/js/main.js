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
    loadViewPrefs,
    userLists,
    compactMode,
    nashvilleMode,
    chordDisplayMode,
    showSectionLabels,
    twoColumnMode,
    fontSizeLevel,
    setListContext,
    setFullscreenMode,
    setWorkRedirects, resolveWorkId,
    setBountyIndex,
    // Reactive state system
    subscribe, setCurrentView, currentView
} from './state.js';
import { initTagDropdown, syncTagCheckboxes } from './tags.js';
import {
    initLists, performFullListsSync,
    clearListView, renderListsModal, createList, addSongToList, getViewingListId,
    showListView, fetchListData, renderManageListsView, showSongListsView, startCreateListInView,
    // Favorites functions (favorites is now just a list)
    showFavorites, updateFavoritesCount, getFavoritesList, isFavorite, toggleFavorite,
    updateSyncUI, reorderFavoriteItem, handleListsSignOut
} from './lists.js';
import { initSongView, goBack, getCurrentSong, toggleFullscreen, exitFullscreen, navigatePrev, navigateNext, setListItemRouter } from './song-view.js';
import { openWork, teardownTablatureView, configureWorkPage, updateWorkTopBar } from './work-view.js';
import { renderBountyView } from './bounty-view.js';
import { initSearch, search, showRandomSongs, renderResults, parseSearchQuery } from './search-core.js';
import { initEditor, updateEditorPreview, enterEditMode, exitEditMode, editorGenerateChordPro, closeHints, prepareAddSongView } from './editor.js';
import { escapeHtml, requireLogin, parseItemRef, buildDeleteCandidates } from './utils.js';
import { parseChordPro, renderSectionsPrintHtml } from './renderers/chordpro.js';
import { initShell, setTopBar, setBottomBand, setOverflowBase } from './shell.js';
import { initAnalytics, track, trackNavigation, trackThemeToggle, trackDeepLink } from './analytics.js';
import { initFlags, openFeedbackModal } from './flags.js';
import { initSuperUserRequest } from './superuser-request.js';
import { COLLECTIONS, COLLECTION_PINS } from './collections.js';
import { initAddSongPicker, openAddSongPicker } from './add-song-picker.js';
import { initDocUpload, resetDocUpload, prefillDocUpload } from './doc-upload.js';
import { buildStemSet } from './stem.js';

// ============================================
// DOM ELEMENTS
// ============================================

const searchInput = document.getElementById('search-input');
const searchStats = document.getElementById('search-stats');
const resultsDiv = document.getElementById('results');
const songView = document.getElementById('song-view');
const songContent = document.getElementById('song-content');
const backBtn = document.getElementById('back-btn');
const visitorStatsEl = document.getElementById('visitor-stats');

// Landing page elements
const landingPage = document.getElementById('landing-page');
const collectionsGrid = document.getElementById('collections-grid');
const landingSearchInput = document.getElementById('landing-search-input');
const logoLink = document.getElementById('logo-link');

// Fullscreen / navigation elements
const fullscreenBtn = document.getElementById('fullscreen-btn');
const exitFullscreenBtn = document.getElementById('exit-fullscreen-btn');
const navBar = document.getElementById('song-nav-bar');
const navPrevBtn = document.getElementById('nav-prev-btn');
const navNextBtn = document.getElementById('nav-next-btn');
const navPosition = document.getElementById('nav-position');
const navListName = document.getElementById('nav-list-name');

// Print list button
const printListBtn = document.getElementById('print-list-btn');

// Lists modal
const listsModal = document.getElementById('lists-modal');
const listsModalClose = document.getElementById('lists-modal-close');
const listsContainer = document.getElementById('lists-container');
const modalCreateListBtn = document.getElementById('create-list-submit');
const modalNewListInput = document.getElementById('new-list-name');

// Song Lists page (formerly Manage Lists)
const songListsView = document.getElementById('song-lists-view');
const songListsBackBtn = document.getElementById('song-lists-back-btn');
const manageListsContainer = document.getElementById('manage-lists-container');
const createListBtn = document.getElementById('create-list-btn');

// Account modal
const accountModal = document.getElementById('account-modal');
const accountModalClose = document.getElementById('account-modal-close');
const deleteModal = document.getElementById('delete-modal');
const deleteModalClose = document.getElementById('delete-modal-close');
const signInBtn = document.getElementById('sign-in-btn');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');

// Song actions now live in the app shell's top band (see work-view.js
// updateWorkTopBar): Edit / Lists / Export pills + Report/Delete overflow.

// Editor elements
const editorPanel = document.getElementById('editor-panel');
const uploadPanel = document.getElementById('upload-panel');
const editorBackBtn = document.getElementById('editor-back-btn');
const editorTitle = document.getElementById('editor-title');
const editorArtist = document.getElementById('editor-artist');
const editorWriter = document.getElementById('editor-writer');
const editorContent = document.getElementById('editor-content');
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
const editorTransposeUp = document.getElementById('editor-transpose-up');
const editorTransposeDown = document.getElementById('editor-transpose-down');
const editorKeySelect = document.getElementById('editor-key-select');
const metadataSummary = document.getElementById('metadata-summary');
const metadataFields = document.getElementById('metadata-fields');
const editorPreviewContainer = document.getElementById('editor-preview-container');
const editorUndoBtn = document.getElementById('editor-undo');
const editorRedoBtn = document.getElementById('editor-redo');
const editorTransposeGroup = document.getElementById('editor-transpose-group');

// Tag dropdown
const tagDropdownBtn = document.getElementById('tag-dropdown-btn');
const tagDropdownContent = document.getElementById('tag-dropdown-content');

// Search tips dropdown
const searchTipsBtn = document.getElementById('search-tips-btn');
const searchTipsDropdown = document.getElementById('search-tips-dropdown');

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
            // If viewing song within a list context, include list ID in URL.
            // Song pages are unified on the work URL form (#work/{slug}).
            if (data.listId) {
                hash = `#list/${data.listId}/${data.songId}`;
            } else {
                hash = `#work/${data.songId}`;
            }
            break;
        case 'edit':
            hash = `#edit/${data.songId}`;
            break;
        case 'add-song':
            hash = '#add';
            break;
        case 'doc-upload':
            hash = '#upload';
            break;
        case 'bounty':
            hash = '#bounty';
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
                const itemRef = state.partId ? `${state.songId}/${state.partId}` : state.songId;
                if (state.listId === 'favorites') {
                    // Restore favorites context (fromDeepLink: no history push)
                    openSongInFavorites(itemRef, true);
                } else if (state.listId) {
                    openSongInList(state.listId, itemRef, true);
                } else {
                    openWork(state.songId, {
                        fromHistory: true,
                        exact: true,
                        partId: state.partId || null,
                    });
                }
            }
            break;
        case 'edit':
            if (state.songId) {
                // Re-enter edit mode for the song
                const song = allSongs.find(s => s.id === state.songId);
                if (song) {
                    // Route through the view state machine so home/search
                    // content is hidden before the editor panel is shown
                    showView('add-song');
                    enterEditMode(song, { fromHistory: true });
                } else {
                    showView('search');
                }
            }
            break;
        case 'add-song':
            prepareAddSongView();
            showView('add-song');
            break;
        case 'doc-upload':
            showView('doc-upload');
            break;
        case 'bounty':
            showView('bounty');
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
        // Tear down live tablature state on any view change: stops
        // audio (including an in-flight soundfont load), destroys the
        // edit session and renderer observers. Idempotent; the work
        // view rebuilds everything it needs on render.
        teardownTablatureView();

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

        // Reset upload form when navigating away
        if (view !== 'doc-upload') {
            resetDocUpload();
        }

        // Top band: the song page declares its own chrome (back/title/
        // actions); every other view gets the plain nav band. The bottom
        // band belongs to the song page only.
        if (view === 'song') {
            updateWorkTopBar();
        } else {
            const shellNavByView = {
                'search': 'search', 'add-song': 'add', 'doc-upload': 'add',
                'favorites': 'favorites', 'list': 'lists', 'song-lists': 'lists',
            };
            setTopBar({ navActive: shellNavByView[view] || null });
            setBottomBand(null);
        }

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
                uploadPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                break;
            case 'search':
                searchContainer?.classList.remove('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                uploadPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
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
                uploadPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                break;
            case 'doc-upload':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                uploadPanel?.classList.remove('hidden');
                songListsView?.classList.add('hidden');
                break;
            case 'favorites':
                searchContainer?.classList.remove('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                uploadPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                showFavorites();
                break;
            case 'song':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.remove('hidden');
                editorPanel?.classList.add('hidden');
                uploadPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                // Show delete button for admins
                updateDeleteButtonVisibility();
                break;
            case 'list':
                searchContainer?.classList.remove('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                uploadPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                break;
            case 'bounty':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                uploadPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                renderBountyView(resultsDiv);
                break;
            case 'song-lists':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                uploadPanel?.classList.add('hidden');
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
 * Get distinct song count (counts unique titles, case-insensitive)
 * This matches the count shown in search results via showPopularSongs()
 */
function getDistinctSongCount() {
    return new Set(allSongs.map(s => s.title?.toLowerCase())).size;
}

/**
 * Render collection cards on the landing page
 */
function renderCollectionCards() {
    if (!collectionsGrid) return;

    const cards = COLLECTIONS.map(collection => {
        // Count songs matching the query (or distinct titles for "all songs", or skip for tools)
        const count = collection.isToolLink ? 0 : collection.isSearchLink ? getDistinctSongCount() : getCollectionSongCount(collection.query);
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
        renderResults(results, '');
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
    renderResults(reordered, '');

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
        // Work view: #work/{id} or #work/{id}/{partId}
        // Also handles legacy #work/{id}/parts/{partId}
        const pathParts = hash.slice(6).split('/');
        const workId = resolveWorkId(pathParts[0]);
        let partId;

        if (pathParts[1] === 'parts' && pathParts[2]) {
            // Legacy URL: #work/{id}/parts/{partId} → redirect to #work/{id}/{partId}
            partId = pathParts[2];
            history.replaceState(null, '', `#work/${workId}/${partId}`);
        } else {
            partId = pathParts[1]; // undefined if just #work/{id}
        }

        // Update URL if redirected to canonical slug
        if (workId !== pathParts[0] && !partId) {
            history.replaceState(null, '', `#work/${workId}`);
        } else if (workId !== pathParts[0] && partId) {
            history.replaceState(null, '', `#work/${workId}/${partId}`);
        }
        trackDeepLink('work', hash);
        // #work/ URLs always show the work dashboard — it's an explicit request
        openWork(workId, { partId, fromDeepLink: true });
        return true;
    } else if (hash.startsWith('#song/')) {
        // Legacy song URLs: #song/{id} → resolve to the work and rewrite
        // the URL to the canonical #work/{slug} form (page is unified).
        const songId = resolveWorkId(hash.slice(6));
        history.replaceState({ view: 'song', songId }, '', `#work/${songId}`);
        trackDeepLink('song', hash);
        openWork(songId, { fromDeepLink: true, exact: true });
        return true;
    } else if (hash === '#add') {
        trackDeepLink('add', hash);
        prepareAddSongView();
        showView('add-song');
        pushHistoryState('add-song', {}, true);
        return true;
    } else if (hash.startsWith('#edit/')) {
        const songId = hash.slice(6);
        trackDeepLink('edit', hash);
        const song = allSongs.find(s => s.id === songId);
        if (song) {
            // Route through the view state machine so the landing page is
            // hidden before the editor panel is shown (enterEditMode only
            // toggles editor-adjacent panels, not the home view)
            showView('add-song');
            enterEditMode(song, { fromDeepLink: true });
            pushHistoryState('edit', { songId }, true);
        } else {
            // Song not found, go to search
            showView('search');
        }
        return true;
    } else if (hash === '#upload') {
        trackDeepLink('upload', hash);
        showView('doc-upload');
        pushHistoryState('doc-upload', {}, true);
        return true;
    } else if (hash === '#bounty') {
        trackDeepLink('bounty', hash);
        showView('bounty');
        pushHistoryState('bounty', {}, true);
        return true;
    } else if (hash === '#request-song') {
        trackDeepLink('request-song', hash);
        window.location.hash = '';
        openAddSongPicker({ mode: 'request' });
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
        // Item ref can contain a slash (e.g., "soldier-s-joy-1/tenor-banjo")
        const itemRef = parts.length > 1 ? parts.slice(1).join('/') : undefined;

        // Handle favorites as a special list
        if (listId === 'favorites') {
            if (itemRef) {
                // Deep link to song within favorites: #list/favorites/{itemRef}
                trackDeepLink('favorites-song', hash);
                openSongInFavorites(itemRef, true);
            } else {
                // Deep link to favorites: #list/favorites
                trackDeepLink('favorites', hash);
                showView('favorites');
                pushHistoryState('favorites', {}, true);
            }
            return true;
        }

        if (itemRef) {
            // Deep link to song within list: #list/{uuid}/{itemRef}
            trackDeepLink('list-song', hash);
            // First load the list to set up context, then open the song
            openSongInList(listId, itemRef, true);
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
 * @param {string} itemRef - Work ID or part-qualified ref (e.g., "work-id/part-slug")
 */
function openSongInFavorites(itemRef, fromDeepLink = false) {
    const { workId, partId } = parseItemRef(itemRef);

    // Get favorites song IDs that exist in allSongs
    const favList = getFavoritesList();
    const favSongIds = favList ? favList.songs.filter(ref => {
        const { workId: wid } = parseItemRef(ref);
        return allSongs.find(s => s.id === wid);
    }) : [];
    const songIndex = favSongIds.indexOf(itemRef);

    // Set up favorites context for prev/next navigation
    setListContext({
        listId: 'favorites',
        listName: 'Favorites',
        songIds: favSongIds,
        currentIndex: songIndex >= 0 ? songIndex : 0
    });

    // Unified song page handles every work shape; exact keeps the stored ref
    openWork(workId, {
        partId: partId || null,
        fromDeepLink,
        fromList: true,
        listId: 'favorites',
        exact: true,
    });
}

/**
 * Open a song within a list context (for deep linking)
 * @param {string} itemRef - Work ID or part-qualified ref (e.g., "work-id/part-slug")
 */
async function openSongInList(listId, itemRef, fromDeepLink = false) {
    const { workId, partId } = parseItemRef(itemRef);
    const listData = await fetchListData(listId);

    if (!listData) {
        // List not found - fall back to opening song without context
        openWork(workId, { partId: partId || null, fromDeepLink, exact: true });
        return;
    }

    // Set up list context for prev/next navigation
    const songIndex = listData.songs.indexOf(itemRef);
    setListContext({
        listId,
        listName: listData.name,
        songIds: listData.songs,
        currentIndex: songIndex >= 0 ? songIndex : 0
    });

    // Unified song page handles every work shape; exact keeps the stored ref
    openWork(workId, {
        partId: partId || null,
        fromDeepLink,
        fromList: true,
        listId,
        exact: true,
    });
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
// NAVIGATION
// ============================================

function navigateTo(mode) {
    trackNavigation(mode);
    // Entering Add Song after an edit session must start from a fresh
    // new-song editor (an unsaved new-song draft is preserved)
    if (mode === 'add-song') prepareAddSongView();
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
        notes: pending.notes || '',
        status: pending.status || (pending.content ? undefined : 'placeholder'),
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
        // no-cache = revalidate (304 if unchanged); heuristic caching
        // otherwise serves a stale index for weeks after a re-publish.
        const [response, redirectsResponse] = await Promise.all([
            fetch('data/index.jsonl', { cache: 'no-cache' }),
            fetch('data/redirects.json').catch(() => null),
        ]);
        const text = await response.text();
        const staticSongs = text.trim().split('\n').map(line => JSON.parse(line));

        // Load work redirects (merged/renamed works)
        if (redirectsResponse?.ok) {
            try {
                const redirects = await redirectsResponse.json();
                setWorkRedirects(redirects);
                console.log(`Loaded ${Object.keys(redirects).length} work redirects`);
            } catch (e) {
                // Not critical — redirects just won't work
            }
        }

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

        // Merge: pending corrections overlay on static songs, preserving fields like tablature_parts
        const staticMap = {};
        staticSongs.forEach(s => { staticMap[s.id] = s; });

        const mergedPending = pendingSongs.map(p => {
            const base = p.replaces_id ? staticMap[p.replaces_id] : null;
            return base ? { ...base, ...p, source: 'pending' } : p;
        });

        const replacedIds = new Set(
            pendingSongs.filter(s => s.replaces_id).map(s => s.replaces_id)
        );
        const filteredStatic = staticSongs.filter(s => !replacedIds.has(s.id));
        const songs = [...filteredStatic, ...mergedPending];

        setAllSongs(songs);

        // Pre-compute stemmed word sets for fuzzy search
        for (const song of songs) {
            song._stems = buildStemSet([
                song.title || '',
                song.artist || '',
                song.composer || '',
                song.first_line || ''
            ].join(' '));
        }

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

        // Fetch bounties in background (non-blocking, not needed for initial render)
        refreshBounties();
    } catch (error) {
        console.error('Failed to load index:', error);
        if (resultsDiv) {
            resultsDiv.innerHTML = `<div class="loading">Error loading songs: ${error.message}</div>`;
        }
    }
}

/**
 * Refresh pending songs from Supabase and merge into allSongs.
 * Call this after a trusted user saves edits to ensure the song
 * is available immediately for navigation.
 * Note: Exposed on window for editor.js to avoid circular import.
 */
async function refreshPendingSongs() {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) return;

    try {
        const { data, error } = await supabase
            .from('pending_songs')
            .select('*');

        if (error || !data) {
            console.warn('Could not refresh pending songs:', error);
            return;
        }

        const pendingSongs = data.map(transformPendingToIndexFormat);

        // Get current static songs (those not from pending source)
        const currentSongs = allSongs.filter(s => s.source !== 'pending');

        // Merge: pending corrections overlay on static songs, preserving fields like tablature_parts
        const staticMap = {};
        currentSongs.forEach(s => { staticMap[s.id] = s; });

        const mergedPending = pendingSongs.map(p => {
            const base = p.replaces_id ? staticMap[p.replaces_id] : null;
            return base ? { ...base, ...p, source: 'pending' } : p;
        });

        const replacedIds = new Set(
            pendingSongs.filter(s => s.replaces_id).map(s => s.replaces_id)
        );
        const filteredStatic = currentSongs.filter(s => !replacedIds.has(s.id));
        const songs = [...filteredStatic, ...mergedPending];

        setAllSongs(songs);

        // Pre-compute stems for any new pending songs
        for (const song of pendingSongs) {
            if (!song._stems) {
                song._stems = buildStemSet([
                    song.title || '',
                    song.artist || '',
                    song.composer || '',
                    song.first_line || ''
                ].join(' '));
            }
        }

        // Rebuild song groups for version detection
        const groups = {};
        songs.forEach(song => {
            if (song.group_id) {
                if (!groups[song.group_id]) groups[song.group_id] = [];
                groups[song.group_id].push(song);
            }
        });
        setSongGroups(groups);

        if (pendingSongs.length > 0) {
            console.log(`Refreshed: ${pendingSongs.length} pending song(s) merged`);
        }
    } catch (e) {
        console.warn('Error refreshing pending songs:', e);
    }
}

// Expose refreshPendingSongs on window for editor.js (avoids circular import)
window.refreshPendingSongs = refreshPendingSongs;

/**
 * Fetch open bounties from Supabase and populate bountyIndex.
 * Groups bounties by work_id for O(1) lookup.
 */
async function refreshBounties() {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) return;

    try {
        const { data, error } = await supabase
            .from('bounties')
            .select('*')
            .eq('status', 'open');

        if (error || !data) {
            console.warn('Could not fetch bounties:', error);
            return;
        }

        // Group by work_id
        const index = {};
        for (const bounty of data) {
            if (!index[bounty.work_id]) index[bounty.work_id] = [];
            index[bounty.work_id].push(bounty);
        }
        setBountyIndex(index);

        if (data.length > 0) {
            console.log(`Loaded ${data.length} open bounties across ${Object.keys(index).length} works`);
        }
    } catch (e) {
        console.warn('Error fetching bounties:', e);
    }
}

// Expose refreshBounties on window for bounty UI components
window.refreshBounties = refreshBounties;

// ============================================
// AUTH UI
// ============================================

// Admin state (cached to avoid repeated RPC calls)
let isAdminUser = false;

function getInitials(user) {
    const name = user.user_metadata?.full_name;
    if (name) {
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        return parts[0].substring(0, 2).toUpperCase();
    }
    const email = user.email || '';
    return email.substring(0, 2).toUpperCase();
}

function updateAuthUI(user, event) {
    const userAvatarInitials = document.getElementById('user-avatar-initials');
    const accountAvatarEl = document.getElementById('account-avatar');
    const accountAvatarInitials = document.getElementById('account-avatar-initials');
    const accountNameEl = document.getElementById('account-name');
    const accountEmailEl = document.getElementById('account-email');

    if (user) {
        // Hide sign-in button, show user info
        signInBtn?.classList.add('hidden');
        userInfo?.classList.remove('hidden');

        const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
        const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';

        if (userName) userName.textContent = displayName;

        // Show photo avatar or initials fallback
        if (avatarUrl) {
            if (userAvatar) { userAvatar.src = avatarUrl; userAvatar.classList.remove('hidden'); }
            userAvatarInitials?.classList.add('hidden');
            if (accountAvatarEl) { accountAvatarEl.src = avatarUrl; accountAvatarEl.classList.remove('hidden'); }
            accountAvatarInitials?.classList.add('hidden');
        } else {
            const initials = getInitials(user);
            userAvatar?.classList.add('hidden');
            if (userAvatarInitials) { userAvatarInitials.textContent = initials; userAvatarInitials.classList.remove('hidden'); }
            accountAvatarEl?.classList.add('hidden');
            if (accountAvatarInitials) { accountAvatarInitials.textContent = initials; accountAvatarInitials.classList.remove('hidden'); }
        }

        // Populate account modal details
        if (accountNameEl) accountNameEl.textContent = displayName;
        if (accountEmailEl) accountEmailEl.textContent = user.email || '';

        updateSyncUI('syncing');
        performFullListsSync();

        // Check admin status (async, updates UI when ready)
        checkAdminStatus();
    } else {
        // Show sign-in button, hide user info
        signInBtn?.classList.remove('hidden');
        userInfo?.classList.add('hidden');
        updateSyncUI('offline');

        // Only wipe list data on actual sign-out, not on pre-session events
        // (REGISTERED/INITIAL fire with null user before session is determined)
        if (event === 'SIGNED_OUT') {
            handleListsSignOut();
        }

        // Clear admin status (drops the Delete item from the song overflow)
        isAdminUser = false;
        updateDeleteButtonVisibility();
    }
}

// Check if current user is an admin and update UI
async function checkAdminStatus() {
    if (typeof SupabaseAuth !== 'undefined') {
        isAdminUser = await SupabaseAuth.isAdmin();
        // Update delete button visibility if currently viewing a song
        updateDeleteButtonVisibility();
    }
}

// Admin status changed: rebuild the song page's top band so the Delete
// overflow item appears/disappears (work-view reads isAdmin via hook).
function updateDeleteButtonVisibility() {
    if (currentView === 'song') {
        updateWorkTopBar();
    }
}

// Handle song deletion. Opens a modal listing every version in the group:
// the viewed song is the group's *representative*, so a blind delete of
// currentSong.id can remove the wrong copy while the duplicate lives on.
function handleDeleteSong() {
    const song = getCurrentSong();
    if (!song) return;

    const candidates = buildDeleteCandidates(song, songGroups);
    const listEl = document.getElementById('delete-candidate-list');
    const confirmBtn = document.getElementById('delete-modal-confirm');
    const statusEl = document.getElementById('delete-status');
    if (!listEl || !confirmBtn) return;

    statusEl.textContent = '';
    listEl.innerHTML = candidates.map(c => `
        <label class="delete-candidate${c.isCurrent ? ' current' : ''}">
            <input type="checkbox" value="${escapeHtml(c.id)}" ${c.isCurrent ? 'checked' : ''}>
            <div>
                <div><strong>${escapeHtml(c.title)}</strong>${c.isCurrent ? ' (viewing)' : ''}</div>
                <div class="candidate-meta">${escapeHtml(c.id)} · ${escapeHtml(c.source)}${c.key ? ` · Key: ${escapeHtml(c.key)}` : ''} · ${c.chordCount} chords</div>
                ${c.firstLine ? `<div class="candidate-first-line">"${escapeHtml(c.firstLine)}"</div>` : ''}
            </div>
        </label>
    `).join('');

    const updateConfirm = () => {
        confirmBtn.disabled = listEl.querySelectorAll('input:checked').length === 0;
    };
    listEl.querySelectorAll('input').forEach(cb => cb.addEventListener('change', updateConfirm));
    updateConfirm();

    confirmBtn.onclick = () => confirmDeleteSelected(listEl, confirmBtn, statusEl);
    deleteModal?.classList.remove('hidden');
}

async function confirmDeleteSelected(listEl, confirmBtn, statusEl) {
    const ids = [...listEl.querySelectorAll('input:checked')].map(cb => cb.value);
    if (!ids.length) return;

    confirmBtn.disabled = true;
    statusEl.textContent = 'Deleting…';
    try {
        for (const id of ids) {
            const { error } = await SupabaseAuth.deleteSong(id);
            if (error) throw new Error(`${id}: ${error.message}`);
        }
        statusEl.textContent = '';
        deleteModal?.classList.add('hidden');
        alert(`Marked for deletion: ${ids.join(', ')}\n\nTakes effect after the next deleted-songs sync and rebuild.`);
        goBack();
    } catch (err) {
        console.error('Error deleting song:', err);
        statusEl.textContent = `Failed: ${err.message}`;
        confirmBtn.disabled = false;
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

// ============================================
// AUTH MODAL
// ============================================

const authModal = document.getElementById('auth-modal');
const authModalClose = document.getElementById('auth-modal-close');
const authModalTitle = document.getElementById('auth-modal-title');
const authGoogleBtn = document.getElementById('auth-google-btn');
const authEmailToggle = document.getElementById('auth-email-toggle');
const authEmailForm = document.getElementById('auth-email-form');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSuccess = document.getElementById('auth-success');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authForgotBtn = document.getElementById('auth-forgot-btn');
const authToggleText = document.getElementById('auth-toggle-text');
const authToggleBtn = document.getElementById('auth-toggle-btn');

// Reset modal elements
const resetModal = document.getElementById('reset-modal');
const resetModalClose = document.getElementById('reset-modal-close');
const resetStepEmail = document.getElementById('reset-step-email');
const resetStepSent = document.getElementById('reset-step-sent');
const resetStepNew = document.getElementById('reset-step-new');
const resetEmailInput = document.getElementById('reset-email');
const resetError = document.getElementById('reset-error');
const resetSendBtn = document.getElementById('reset-send-btn');
const resetBackBtn = document.getElementById('reset-back-btn');
const resetNewPassword = document.getElementById('reset-new-password');
const resetConfirmPassword = document.getElementById('reset-confirm-password');
const resetNewError = document.getElementById('reset-new-error');
const resetUpdateBtn = document.getElementById('reset-update-btn');

let authMode = 'signin'; // 'signin' or 'signup'

function openAuthModal() {
    authMode = 'signin';
    updateAuthModalMode();
    clearAuthForm();
    authModal?.classList.remove('hidden');
}

function closeAuthModal() {
    authModal?.classList.add('hidden');
    clearAuthForm();
}

function clearAuthForm() {
    if (authEmailInput) authEmailInput.value = '';
    if (authPasswordInput) authPasswordInput.value = '';
    authError?.classList.add('hidden');
    authSuccess?.classList.add('hidden');
    // Collapse email form
    authEmailForm?.classList.add('hidden');
    authEmailToggle?.classList.remove('hidden');
}

function updateAuthModalMode() {
    if (authMode === 'signup') {
        if (authModalTitle) authModalTitle.textContent = 'Create Account';
        if (authSubmitBtn) authSubmitBtn.textContent = 'Sign Up';
        if (authToggleText) authToggleText.textContent = 'Already have an account?';
        if (authToggleBtn) authToggleBtn.textContent = 'Sign in';
        if (authForgotBtn) authForgotBtn.classList.add('hidden');
        if (authGoogleBtn) authGoogleBtn.textContent = '';
        if (authGoogleBtn) authGoogleBtn.innerHTML = '<img src="images/google-icon.svg" alt="" class="auth-google-icon"> Sign up with Google';
        if (authEmailToggle) authEmailToggle.textContent = 'Sign up with email';
        if (authPasswordInput) authPasswordInput.setAttribute('autocomplete', 'new-password');
    } else {
        if (authModalTitle) authModalTitle.textContent = 'Sign In';
        if (authSubmitBtn) authSubmitBtn.textContent = 'Sign In';
        if (authToggleText) authToggleText.textContent = "Don't have an account?";
        if (authToggleBtn) authToggleBtn.textContent = 'Sign up';
        if (authForgotBtn) authForgotBtn.classList.remove('hidden');
        if (authGoogleBtn) authGoogleBtn.innerHTML = '<img src="images/google-icon.svg" alt="" class="auth-google-icon"> Sign in with Google';
        if (authEmailToggle) authEmailToggle.textContent = 'Sign in with email';
        if (authPasswordInput) authPasswordInput.setAttribute('autocomplete', 'current-password');
    }
}

function getAuthErrorMessage(error) {
    const msg = error?.message || '';
    if (msg.includes('Invalid login credentials')) return 'Incorrect email or password.';
    if (msg.includes('Email not confirmed')) return 'Please confirm your email before signing in. Check your inbox.';
    if (msg.includes('User already registered')) return 'An account with this email already exists. Try signing in instead.';
    if (msg.includes('Password should be at least')) return 'Password must be at least 8 characters.';
    if (msg.includes('rate limit') || msg.includes('too many requests')) return 'Too many attempts. Please wait a moment and try again.';
    if (msg.includes('Email rate limit exceeded')) return 'Too many emails sent. Please wait before trying again.';
    return msg || 'Something went wrong. Please try again.';
}

async function handleEmailAuth() {
    const email = authEmailInput?.value?.trim();
    const password = authPasswordInput?.value;

    if (!email || !password) {
        showAuthError('Please enter both email and password.');
        return;
    }

    authSubmitBtn.disabled = true;
    authError?.classList.add('hidden');
    authSuccess?.classList.add('hidden');

    try {
        if (authMode === 'signup') {
            const { data, error } = await SupabaseAuth.signUpWithEmail(email, password);
            if (error) {
                showAuthError(getAuthErrorMessage(error));
                return;
            }
            // Check if email already exists (identities will be empty)
            if (data?.user?.identities?.length === 0) {
                showAuthError('An account with this email already exists. Try signing in instead.');
                return;
            }
            // Success - show confirmation message
            showAuthSuccess('Check your email for a confirmation link to complete sign-up.');
        } else {
            const { data, error } = await SupabaseAuth.signInWithEmail(email, password);
            if (error) {
                showAuthError(getAuthErrorMessage(error));
                return;
            }
            // Success - modal will close via onAuthChange SIGNED_IN event
        }
    } finally {
        authSubmitBtn.disabled = false;
    }
}

function showAuthError(message) {
    if (authError) {
        authError.textContent = message;
        authError.classList.remove('hidden');
    }
    authSuccess?.classList.add('hidden');
}

function showAuthSuccess(message) {
    if (authSuccess) {
        authSuccess.textContent = message;
        authSuccess.classList.remove('hidden');
    }
    authError?.classList.add('hidden');
}

function openResetModal(step = 'email') {
    closeAuthModal();
    resetModal?.classList.remove('hidden');
    resetError?.classList.add('hidden');
    resetNewError?.classList.add('hidden');

    // Show appropriate step
    resetStepEmail?.classList.toggle('hidden', step !== 'email');
    resetStepSent?.classList.toggle('hidden', step !== 'sent');
    resetStepNew?.classList.toggle('hidden', step !== 'new');
}

function closeResetModal() {
    resetModal?.classList.add('hidden');
    if (resetEmailInput) resetEmailInput.value = '';
    if (resetNewPassword) resetNewPassword.value = '';
    if (resetConfirmPassword) resetConfirmPassword.value = '';
}

async function handleResetRequest() {
    const email = resetEmailInput?.value?.trim();
    if (!email) {
        if (resetError) { resetError.textContent = 'Please enter your email.'; resetError.classList.remove('hidden'); }
        return;
    }

    resetSendBtn.disabled = true;
    resetError?.classList.add('hidden');

    try {
        const { error } = await SupabaseAuth.resetPassword(email);
        if (error) {
            if (resetError) { resetError.textContent = getAuthErrorMessage(error); resetError.classList.remove('hidden'); }
            return;
        }
        // Show confirmation step
        openResetModal('sent');
    } finally {
        resetSendBtn.disabled = false;
    }
}

async function handlePasswordUpdate() {
    const newPass = resetNewPassword?.value;
    const confirmPass = resetConfirmPassword?.value;

    if (!newPass || !confirmPass) {
        if (resetNewError) { resetNewError.textContent = 'Please fill in both fields.'; resetNewError.classList.remove('hidden'); }
        return;
    }
    if (newPass !== confirmPass) {
        if (resetNewError) { resetNewError.textContent = 'Passwords do not match.'; resetNewError.classList.remove('hidden'); }
        return;
    }
    if (newPass.length < 8) {
        if (resetNewError) { resetNewError.textContent = 'Password must be at least 8 characters.'; resetNewError.classList.remove('hidden'); }
        return;
    }

    resetUpdateBtn.disabled = true;
    resetNewError?.classList.add('hidden');

    try {
        const { error } = await SupabaseAuth.updatePassword(newPass);
        if (error) {
            if (resetNewError) { resetNewError.textContent = getAuthErrorMessage(error); resetNewError.classList.remove('hidden'); }
            return;
        }
        closeResetModal();
        // Show a brief toast/notification
        showToast('Password updated successfully!');
    } finally {
        resetUpdateBtn.disabled = false;
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'auth-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function initAuthModal() {
    // Auth modal open/close
    authModalClose?.addEventListener('click', closeAuthModal);
    authModal?.addEventListener('click', (e) => {
        if (e.target === authModal) closeAuthModal();
    });

    // Google sign-in button within auth modal
    authGoogleBtn?.addEventListener('click', async () => {
        closeAuthModal();
        await SupabaseAuth.signInWithGoogle();
    });

    // Toggle email form visibility
    authEmailToggle?.addEventListener('click', () => {
        authEmailForm?.classList.remove('hidden');
        authEmailToggle?.classList.add('hidden');
        authEmailInput?.focus();
    });

    // Toggle between sign-in and sign-up
    authToggleBtn?.addEventListener('click', () => {
        authMode = authMode === 'signin' ? 'signup' : 'signin';
        updateAuthModalMode();
        authError?.classList.add('hidden');
        authSuccess?.classList.add('hidden');
    });

    // Submit email auth
    authSubmitBtn?.addEventListener('click', handleEmailAuth);

    // Enter key on password field submits
    authPasswordInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleEmailAuth();
    });

    // Forgot password
    authForgotBtn?.addEventListener('click', () => {
        openResetModal('email');
        // Pre-fill email if user already typed one
        if (authEmailInput?.value && resetEmailInput) {
            resetEmailInput.value = authEmailInput.value;
        }
    });

    // Reset modal close
    resetModalClose?.addEventListener('click', closeResetModal);
    resetModal?.addEventListener('click', (e) => {
        if (e.target === resetModal) closeResetModal();
    });

    // Reset modal actions
    resetSendBtn?.addEventListener('click', handleResetRequest);
    resetEmailInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleResetRequest();
    });
    resetBackBtn?.addEventListener('click', () => {
        closeResetModal();
        openAuthModal();
    });
    resetUpdateBtn?.addEventListener('click', handlePasswordUpdate);
    resetConfirmPassword?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handlePasswordUpdate();
    });
}

function closeListsModal() {
    listsModal?.classList.add('hidden');
}

function openListsModal() {
    listsModal?.classList.remove('hidden');
    renderListsModal();
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
    // Pre-render every song HERE in the main window via the shared ChordPro
    // renderer (renderers/chordpro.js). The print window receives static
    // HTML only — its controls just toggle CSS body classes, so zero
    // parsing/rendering/transposition logic ships inside the page.
    const songsHtml = songs.map((song, idx) => {
        const { sections } = parseChordPro(song.content || '');
        const body = renderSectionsPrintHtml(sections, { key: song.key || 'C' });
        return `<div class="song-container">
            <div class="song-header">
                <div class="title">${idx + 1}. ${escapeHtml(song.title || 'Unknown')}</div>
                ${song.artist ? `<div class="artist">${escapeHtml(song.artist)}</div>` : ''}
                <div class="key-info">Key: ${escapeHtml(song.key || 'C')}</div>
            </div>
            <div class="song-content">${body}</div>
        </div>`;
    }).join('');

    const bodyClasses = ['page-per-song'];
    if (prefs.twoColumnMode) bodyClasses.push('two-columns');
    if (!prefs.showSectionLabels) bodyClasses.push('hide-labels');
    if (prefs.nashvilleMode) bodyClasses.push('nashville');
    if (prefs.compactMode) bodyClasses.push('compact');
    if (prefs.chordDisplayMode === 'first') bodyClasses.push('chords-first');
    if (prefs.chordDisplayMode === 'none') bodyClasses.push('chords-none');

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
        .lyric-line {
            white-space: pre;
            line-height: 1.3;
        }
        /* Display-mode toggles: every variant is pre-rendered; body classes
           (set by the tiny control script) choose what shows. */
        .chord-line.nashville { color: #444; display: none; }
        body.nashville .chord-line.nashville { display: block; }
        body.nashville .chord-line.standard { display: none; }
        body.chords-none .chord-line { display: none; }
        body.chords-first .section.is-repeat .chord-line { display: none; }
        .repeat-instruction {
            display: none;
            font-style: italic;
            color: #666;
            margin: 0.5rem 0;
            font-family: system-ui, sans-serif;
        }
        body.compact .repeat-instruction { display: block; }
        body.compact .section.is-repeat { display: none; }
        .song-content { font-size: var(--font-size, 14px); }
    </style>
</head>
<body class="${bodyClasses.join(' ')}">
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

    <div id="songs-container">${songsHtml}</div>

    <script>
        const B = document.body.classList;
        const bind = (id, fn) => document.getElementById(id).addEventListener('change', fn);
        bind('chord-mode-select', e => {
            B.toggle('chords-none', e.target.value === 'none');
            B.toggle('chords-first', e.target.value === 'first');
        });
        bind('compact-toggle', e => B.toggle('compact', e.target.checked));
        bind('nashville-toggle', e => B.toggle('nashville', e.target.checked));
        bind('columns-toggle', e => B.toggle('two-columns', e.target.checked));
        bind('labels-toggle', e => B.toggle('hide-labels', !e.target.checked));
        bind('page-per-song-toggle', e => B.toggle('page-per-song', e.target.checked));
        const input = document.getElementById('font-size-input');
        const setSize = v => {
            input.value = Math.max(8, Math.min(32, v || 14));
            document.documentElement.style.setProperty('--font-size', input.value + 'px');
        };
        document.getElementById('font-decrease').addEventListener('click', () => setSize(+input.value - 2));
        document.getElementById('font-increase').addEventListener('click', () => setSize(+input.value + 2));
        input.addEventListener('change', () => setSize(+input.value));
    <\/script>
</body>
</html>`;
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
    // Initialize theme
    initTheme();

    // App shell: the slim top band replaces the old logo header + hamburger
    // drawer on every view (the big logo survives as the homepage hero).
    // Must run before auth init so #auth-section is in the band when
    // supabase-auth updates it.
    initShell({
        nav: [
            { id: 'search', label: 'Search', icon: '&#128269;', href: '#search', onClick: () => navigateTo('search') },
            { id: 'add', label: 'Add Song', icon: '&#43;', href: '#add', onClick: () => openAddSongPicker() },
            { id: 'favorites', label: 'Favorites', icon: '&#9825;', href: '#favorites', onClick: () => navigateTo('favorites') },
            { id: 'lists', label: 'Lists', icon: '&#9776;', href: '#lists', onClick: () => { showSongListsView(); pushHistoryState('song-lists', {}); } },
        ],
        onToggleTheme: toggleTheme,
    });
    setOverflowBase([
        { label: 'About', onClick: () => { location.href = 'about.html'; } },
        { label: 'Dev Blog', onClick: () => { location.href = 'blog.html'; } },
        { label: 'Standards Board', onClick: () => { location.href = 'bluegrass-standards-board.html'; } },
        { label: 'Support on Patreon', onClick: () => window.open('https://www.patreon.com/c/bluegrassbook', '_blank', 'noopener') },
        { label: 'Buy me a coffee', onClick: () => window.open('https://buymeacoffee.com/michaelbeav', '_blank', 'noopener') },
        { label: 'Send Feedback', onClick: () => openFeedbackModal({ type: 'general-feedback' }) },
    ]);
    document.getElementById('topbar-brand')?.addEventListener('click', (e) => {
        e.preventDefault();
        searchInput.value = '';
        showView('home');
        pushHistoryState('home');
    });

    // Load saved view preferences (before rendering any songs)
    loadViewPrefs();

    // Initialize reactive view state subscription
    initViewSubscription();

    // Initialize analytics (early, before other modules)
    initAnalytics();

    // Initialize the unified feedback modal (song flags, corrections,
    // bug reports, general feedback)
    initFlags({ onEditSong: (song) => enterEditMode(song) });

    // Initialize super-user request module
    initSuperUserRequest();

    // Route to the photo/document upload view (login required).
    // Shared by the picker's Upload card and the editor's empty-state link.
    const goToDocUpload = (ctx) => {
        if (!requireLogin('upload songs')) return;
        if (ctx?.targetSlug) prefillDocUpload(ctx);
        showView('doc-upload');
        pushHistoryState('doc-upload');
    };

    // Initialize add-song picker and doc upload.
    // The picker is the single Add Song entry (top-band nav item, contribute/
    // request flows); the #add deep link still goes straight to the editor.
    initAddSongPicker({
        onUpload: goToDocUpload,
        onChordPro: (ctx) => {
            if (ctx?.targetSlug) {
                enterEditMode({ id: ctx.targetSlug, title: ctx.title, artist: ctx.artist, key: ctx.key, content: '' });
            } else {
                navigateTo('add-song');
            }
        },
    });
    initDocUpload();

    // Upload panel back button
    document.getElementById('upload-back-btn')?.addEventListener('click', () => {
        resetDocUpload();
        navigateTo('search');
    });

    // Initialize lists module (handles favorites as a special list)
    initLists({
        searchStats,
        searchInput,
        resultsDiv,
        songView,
        listsContainer,
        printListBtn,
        renderResults,
        pushHistoryState
    });

    initSongView({
        songView,
        songContent,
        resultsDiv,
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

    // List navigation router: everything goes through the unified song page
    setListItemRouter((itemRef) => {
        const { workId, partId } = parseItemRef(itemRef);
        openWork(workId, { partId: partId || null, fromList: true, exact: true });
    });

    // Wire main.js-owned behaviors into the unified song page's top band
    // (Edit → editor, Delete → admin flow) and register its render loop.
    configureWorkPage({
        onEdit: (song) => enterEditMode(song),
        onDelete: handleDeleteSong,
        isAdmin: () => isAdminUser,
    });

    initSearch({
        searchInput,
        searchStats,
        resultsDiv
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
        editorCopyBtn,
        editorSaveBtn,
        editorSubmitBtn,
        editorStatus,
        editorNashville,
        editorComment,
        editCommentRow,
        hintsBtn,
        hintsPanel,
        hintsBackdrop,
        hintsClose,
        autoDetectCheckbox,
        editorTransposeUp,
        editorTransposeDown,
        editorKeySelect,
        metadataSummary,
        metadataFields,
        onUploadRequest: () => goToDocUpload(),
        onSongRequest: () => openAddSongPicker({ mode: 'request' }),
        editorPreviewContainer,
        editorUndoBtn,
        editorRedoBtn,
        editorTransposeGroup,
        resultsDiv,
        songView
    });

    // Setup event listeners

    // Home buttons - go home
    const goHome = () => {
        searchInput.value = '';
        showView('home');
        pushHistoryState('home');
    };

    logoLink?.addEventListener('click', (e) => {
        e.preventDefault();
        goHome();
    });

    // Report bug link (homepage sign) -> unified feedback modal
    const reportBugLink = document.getElementById('report-bug-link');
    reportBugLink?.addEventListener('click', (e) => {
        e.preventDefault();
        openFeedbackModal({ type: 'bug-report' });
    });

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
    deleteModalClose?.addEventListener('click', () => deleteModal?.classList.add('hidden'));
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

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchTipsBtn?.contains(e.target) && !searchTipsDropdown?.contains(e.target)) {
            searchTipsDropdown?.classList.add('hidden');
        }
    });

    // Search tips dropdown
    searchTipsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        searchTipsDropdown?.classList.toggle('hidden');
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

    // ==========================================================================
    // Song-page delegation: focus-mode buttons rendered by work-view.js.
    // (The quick-controls bar, Info bar and their dropdowns are gone —
    // replaced by the Key/Display/Info pills in song-controls.js.)
    // ==========================================================================

    songContent?.addEventListener('click', (e) => {
        const target = e.target;

        // Focus button (in title row) — focus is the immersive shell now;
        // the old focus header/exit/prev/next buttons died with it (Esc and
        // arrow keys still work via the global keydown handler).
        if (target.closest('#focus-btn')) {
            toggleFullscreen();
            return;
        }
    });

    // History navigation
    window.addEventListener('popstate', (e) => {
        handleHistoryNavigation(e.state);
    });

    // Handle hash changes that don't trigger popstate (e.g. manual URL edits)
    window.addEventListener('hashchange', () => {
        // For hash changes, always try to handle the hash first since the hash
        // represents the current navigation target, not history.state which may be stale
        if (handleDeepLink()) {
            return;
        }
        // Fall back to state-based navigation if no hash match
        handleHistoryNavigation(history.state);
    });

    // Handle editor history push (from editor.js to avoid circular imports)
    window.addEventListener('editor-push-history', (e) => {
        const { view, songId } = e.detail;
        pushHistoryState(view, { songId });
    });

    // Initialize Supabase auth
    if (typeof SupabaseAuth !== 'undefined') {
        SupabaseAuth.init();
        SupabaseAuth.onAuthChange((event, user) => {
            // Skip sign-out side effects for pre-session events (REGISTERED/INITIAL with null user)
            // to avoid wiping localStorage lists before the session is determined.
            // Only call handleListsSignOut on actual SIGNED_OUT events.
            updateAuthUI(user, event);
            // Check for pending invite after sign-in
            if (event === 'SIGNED_IN' && user) {
                checkPendingInvite();
                closeAuthModal();
            }
            // Handle password recovery flow (user clicked reset link in email)
            if (event === 'PASSWORD_RECOVERY') {
                openResetModal('new');
            }
        });

        // Sign-in button opens auth modal (instead of directly calling Google)
        signInBtn?.addEventListener('click', () => {
            openAuthModal();
        });

        // Listen for cross-module auth modal open events
        window.addEventListener('open-auth-modal', () => {
            openAuthModal();
        });

        // Click on user info opens account modal
        userInfo?.addEventListener('click', () => {
            openAccountModal();
        });

        // Wire up auth modal
        initAuthModal();

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

    // Escape - exit fullscreen
    if (e.key === 'Escape') {
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
