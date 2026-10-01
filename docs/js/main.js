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
    setBootRouteClaimed,
    canRouteBootUrl,
    loadViewPrefs,
    userLists,
    compactMode,
    nashvilleMode,
    chordDisplayMode,
    showSectionLabels,
    twoColumnMode,
    fontSizeLevel,
    printFontPxForLevel,
    PRINT_BASE_FONT_PX, PRINT_FONT_PX_MIN, PRINT_FONT_PX_MAX,
    setListContext, listContext,
    setWorkRedirects, resolveWorkId,
    setBountyIndex,
    setCorpusLoadFailed,
    // Reactive state system
    subscribe, setCurrentView, currentView,
    dungeonMode, setDungeonMode
} from './state.js';
import { initTagDropdown, syncTagCheckboxes } from './tags.js';
import {
    initLists, performFullListsSync,
    clearListView, renderListsModal, createList, addSongToList, getViewingListId,
    showListView, fetchListData, renderManageListsView, showSongListsView, startCreateListInView,
    // Favorites functions (favorites is now just a list)
    showFavorites, getFavoritesList, isFavorite, toggleFavorite,
    updateSyncUI, reorderFavoriteItem, handleListsSignOut,
    ensureArchiveForRefs
} from './lists.js';
import { initSongView, goBack, getCurrentSong, navigatePrev, navigateNext, setListItemRouter } from './song-view.js';
import {
    openWork, teardownTablatureView, configureWorkPage, updateWorkTopBar,
    handleEditAction, openNewTabPage,
} from './work-view.js';
import { parseTabRoute, partInstrumentFor } from './otf-editor/create-tab-entry.js';
import { initSearch, search, showPopularSongs, renderResults, parseSearchQuery, searchableSongs } from './search-core.js';
import { escapeHtml, escapeAttr, requireLogin, parseItemRef, buildDeleteCandidates, downloadFile } from './utils.js';
import { parseChordPro, renderSectionsPrintHtml } from './renderers/chordpro.js';
import { initShell, setTopBar, setBottomBand, setOverflowBase, setChromeAutoHide, pill, setBanner } from './shell.js';
import { initAnalytics, track, trackNavigation, trackThemeToggle, trackDeepLink } from './analytics.js';
import { initFlags, openFeedbackModal } from './flags.js';
import { initSuperUserRequest } from './superuser-request.js';
import { COLLECTIONS, COLLECTION_PINS, collectionThumbnailHtml } from './collections.js';
import { initAddSongPicker, openAddSongPicker } from './add-song-picker.js';
import {
    fetchJsonl, mergeCorpus, markArchived, countDistinctTitles,
    transformPendingRow, overlaysNeedArchive, PENDING_OVERLAY_COLUMNS,
    readCachedIdSet, writeCachedIdSet,
} from './corpus.js';
import { getSongContents, setPendingContentFetcher } from './song-content.js';
import { showToast } from './toast.js';
import { AUTH_REDIRECT, persistReturnRecord, takeReturnRecord, pruneReturnRecord } from './auth-return.js';
import { initPWA, canInstall, promptInstall } from './pwa.js';
import { getDraftStore, migrateLegacyDraft, parseHashParams } from './drafts.js';

// ============================================
// LAZY MODULES
// ============================================
//
// Route- or action-specific code is fetched with import() the first time it
// is needed instead of riding along in the boot graph (B7a). The wrappers
// below keep the names the rest of this file always used, so call sites read
// as before. Nothing here has module-level side effects to preserve: the
// modules only export functions, and the wiring that used to run at boot
// (initEditor, configureReviewQueue) runs once, right after the first load.

/** A failed download (offline, deploy in flight) must say so, not vanish. */
function lazyLoadFailed(what, err) {
    console.error(`Could not load ${what}:`, err);
    showToast(`Couldn't load ${what}. Check your connection and try again.`,
        { variant: 'warning', duration: 6000 });
}

// --- Song editor (editor.js and what only it uses: smart-paste, dedup-check, visual-editor/)

let editorModule = null;
let editorLoading = null;

function loadEditor() {
    editorLoading ||= import('./editor.js').then((mod) => {
        mod.initEditor(editorInitOptions());
        editorModule = mod;
        return mod;
    }).catch((err) => {
        editorLoading = null; // let the next attempt retry
        throw err;
    });
    return editorLoading;
}

/** Edit a song. Resolves once the editor is open (or the load failed). */
async function enterEditMode(song, options) {
    try {
        const mod = await loadEditor();
        return await mod.enterEditMode(song, options);
    } catch (err) {
        lazyLoadFailed('the editor', err);
    }
}

// Until the editor has loaded there is nothing to reset, close or exit:
// every one of these only undoes state enterEditMode/initEditor created.
function exitEditMode() { editorModule?.exitEditMode(); }
function closeHints() { editorModule?.closeHints(); }
function prepareAddSongView() { editorModule?.prepareAddSongView(); }

// The leave-without-submitting guard and ownership chrome (A7, A11) only
// concern an editor that has been opened, i.e. loaded.
function editorHasUnsavedChanges() { return editorModule?.editorHasUnsavedChanges() ?? false; }
function editorSessionInfo() { return editorModule?.editorSessionInfo() ?? { isEdit: false, songId: null }; }
function promptUnsavedChanges() { return editorModule ? editorModule.promptUnsavedChanges() : Promise.resolve('cancelled'); }
function closeUnsavedPrompt() { editorModule?.closeUnsavedPrompt(); }
function unsavedPromptOpen() { return editorModule?.unsavedPromptOpen() ?? false; }
function refreshEditorOwnership() { return editorModule?.refreshEditorOwnership(); }

// --- Review queue (Dungeon-only; review-queue.js)

let reviewQueueModule = null;
let reviewQueueLoading = null;

function loadReviewQueue() {
    reviewQueueLoading ||= import('./review-queue.js').then((mod) => {
        mod.configureReviewQueue({
            isAdmin: () => isAdminUser,
            isTrusted: () => isTrustedFlag,
            // An approved delete has already landed in deleted_songs; mirror it
            // client-side so the corpus stops serving the song immediately.
            onDeleteExecuted: (id) => {
                deletedIds.add(id);
                persistCuration();
                rebuildCorpus();
            },
        });
        reviewQueueModule = mod;
        return mod;
    }).catch((err) => {
        reviewQueueLoading = null;
        throw err;
    });
    return reviewQueueLoading;
}

function hideReviewQueue() { reviewQueueModule?.hideReviewQueue(); }

/** The review-queue module for a request handler; null (after a toast) if it cannot load. */
async function requireReviewQueue() {
    try {
        return await loadReviewQueue();
    } catch (err) {
        lazyLoadFailed('the review queue', err);
        return null;
    }
}

/**
 * Show the Dungeon's review queue. Viewers who are neither trusted nor admin
 * never see it, so they never download it either (the module would only hide
 * its panel for them — canSeeQueue in review-queue.js).
 */
async function showReviewQueue() {
    if (!isAdminUser && !isTrustedFlag) {
        hideReviewQueue();
        return;
    }
    const rq = await requireReviewQueue();
    await rq?.showReviewQueue();
}

// --- Whole-page views rendered into the results panel

/**
 * Load a view's module, then render it — unless the reader has already
 * moved on to another view while it downloaded.
 */
function renderLazyView(view, load, render) {
    // Don't leave the previous view's results on screen during the download
    // (each view replaces this as soon as it renders).
    if (resultsDiv) resultsDiv.innerHTML = '<div class="loading">Loading…</div>';
    load().then((mod) => {
        if (currentView === view) render(mod);
    }).catch((err) => lazyLoadFailed('this page', err));
}
const renderBountyView = (el) =>
    renderLazyView('bounty', () => import('./bounty-view.js'), m => m.renderBountyView(el));
const renderMySubmissionsView = (el) =>
    renderLazyView('my-submissions', () => import('./my-submissions.js'), m => m.renderMySubmissionsView(el));
const renderHighScoresView = (el) =>
    renderLazyView('high-scores', () => import('./high-scores.js'), m => m.renderHighScoresView(el));
const renderDraftsView = (el) =>
    renderLazyView('drafts', () => import('./drafts-view.js'), m => m.renderDraftsView(el));

// ============================================
// DOM ELEMENTS
// ============================================

const searchInput = document.getElementById('search-input');
const searchStats = document.getElementById('search-stats');
const resultsDiv = document.getElementById('results');
const songView = document.getElementById('song-view');
const songContent = document.getElementById('song-content');
const visitorStatsEl = document.getElementById('visitor-stats');

// Landing page elements
const landingPage = document.getElementById('landing-page');
const collectionsGrid = document.getElementById('collections-grid');
const landingSearchInput = document.getElementById('landing-search-input');
const logoLink = document.getElementById('logo-link');

// List navigation bar elements
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

// The inline script at the top of index.html <head> applies the theme before
// first paint; these keep it in step afterwards. Saved choice wins, else the OS.
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#000000' : '#fafafa');
}

function savedTheme() {
    try {
        const saved = localStorage.getItem('theme');
        return saved === 'dark' || saved === 'light' ? saved : null;
    } catch { return null; }
}

function initTheme() {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    applyTheme(savedTheme() || (mq?.matches ? 'dark' : 'light'));
    // With no saved choice, follow OS changes live
    mq?.addEventListener?.('change', (e) => {
        if (!savedTheme()) applyTheme(e.matches ? 'dark' : 'light');
    });
}

function setTheme(theme) {
    applyTheme(theme);
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    trackThemeToggle(newTheme);
}

// ============================================
// EDITOR WIRING
// ============================================

/** Options for initEditor: the editor panel's DOM + host callbacks. */
function editorInitOptions() {
    return {
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
        onSongRequest: () => openAddSongPicker({ mode: 'request' }),
        editorPreviewContainer,
        editorUndoBtn,
        editorRedoBtn,
        editorTransposeGroup,
        resultsDiv,
        songView
    };
}

// ============================================
// HISTORY MANAGEMENT
// ============================================

function pushHistoryState(view, data = {}, replace = false) {
    // Before the boot tail runs, every caller here is a user action (the
    // module wiring in init() only stores this function; nothing calls it on
    // the way in). Such a navigation used to be dropped on the floor, which
    // left the URL showing the boot hash and let loadIndex's tail route back
    // to it a second later. Record it like any other navigation and claim
    // the boot route so the tail leaves the view alone.
    if (!historyInitialized) setBootRouteClaimed(true);

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
        case 'bounty':
            hash = '#bounty';
            break;
        case 'my-submissions':
            hash = '#my-submissions';
            break;
        case 'drafts':
            hash = '#drafts';
            break;
        case 'high-scores':
            hash = '#high-scores';
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
        case 'dungeon':
            hash = data.query ? `#dungeon/${encodeURIComponent(data.query)}` : '#dungeon';
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
        setDungeonMode(false);
        showView('home');
        return;
    }

    // Dungeon chrome persists only on the dungeon list and song pages opened
    // from it — any other destination drops back to the canon scope
    if (state.view !== 'dungeon' && state.view !== 'song') {
        setDungeonMode(false);
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
                // Re-enter edit mode for the song (archive rows arrive late,
                // so a miss waits for archive.jsonl before giving up)
                (async () => {
                    let song = allSongs.find(s => s.id === state.songId);
                    if (!song) {
                        await ensureArchiveLoaded();
                        song = allSongs.find(s => s.id === state.songId);
                    }
                    if (song) {
                        // Route through the view state machine so home/search
                        // content is hidden before the editor panel is shown
                        showView('add-song');
                        await enterEditMode(song, { fromHistory: true });
                    } else {
                        showView('search');
                    }
                })();
            }
            break;
        case 'add-song':
            prepareAddSongView();
            showView('add-song');
            break;
        case 'bounty':
            showView('bounty');
            break;
        case 'my-submissions':
            showView('my-submissions');
            break;
        case 'high-scores':
            showView('high-scores');
            break;
        case 'drafts':
            showView('drafts');
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
        case 'dungeon':
            enterDungeon(state.query || '', { fromHistory: true });
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

/**
 * The editor was navigated away from with edits that were never submitted
 * (hash change, Back, a link). The navigation has already happened, so the
 * prompt sits over the new view; "Keep editing" routes straight back to the
 * editor, whose state exitEditMode() has deliberately not been allowed to
 * touch yet.
 */
async function guardEditorExit() {
    const { isEdit, songId } = editorSessionInfo();
    const choice = await promptUnsavedChanges();
    if (choice === 'keep') {
        if (isEdit) pushHistoryState('edit', { songId });
        else pushHistoryState('add-song');
        showView('add-song');
    } else if (choice === 'discard') {
        exitEditMode();
    }
    // 'cancelled': the user came back to the editor some other way
}

// Subscribe to view changes and update DOM accordingly
function initViewSubscription() {
    const searchContainer = document.querySelector('.search-container');
    let previousView = null;

    subscribe('currentView', (view) => {
        const leftEditor = previousView === 'add-song' && view !== 'add-song';
        previousView = view;

        // Tear down live tablature state when LEAVING the song page: stops
        // audio (including an in-flight soundfont load), destroys the edit
        // session and renderer observers.
        //
        // Not when arriving at it. Subscribers run on a `requestAnimationFrame`
        // (state.js `scheduleRender`), so a teardown queued by *entering* the
        // song view lands a frame later — by which time work-view has already
        // built the very thing it then destroys. That is a coin flip decided
        // by the module cache: with the editor's five dynamic imports cold the
        // frame wins and the editor survives; warm, the mount resolves in a
        // microtask, finishes first, and gets deleted. `#drafts` → Open lost
        // that flip every time (warm), and a dropped `.tef` lost it about half
        // the time.
        //
        // Nothing is left un-torn-down: every path INTO the song view goes
        // through work-view, which tears down synchronously before it builds
        // (`openWork`, `openNewTabPage`, and the two bare loading/not-found
        // states below them). Leaving is the case with no other owner, and
        // that is the case this keeps.
        if (view !== 'song') teardownTablatureView();

        // Chrome auto-hide only lives on the song page
        setChromeAutoHide(view === 'song');

        // Close any open editor hints panel
        closeHints();

        // Exit edit mode when navigating away from the editor — unless there
        // are unsubmitted edits, in which case ask first (and leave the
        // editor's state alone until the answer).
        if (view !== 'add-song') {
            if (leftEditor && editorHasUnsavedChanges()) {
                guardEditorExit();
            } else if (!unsavedPromptOpen()) {
                exitEditMode();
            }
        } else {
            closeUnsavedPrompt();
        }

        // The review queue sits above the results list, so it belongs to the
        // search view only — dungeon mode persists onto song pages, and the
        // queue must not ride along.
        if (view !== 'search') hideReviewQueue();

        // Top band: the song page declares its own chrome (back/title/
        // actions); every other view gets the plain nav band. The bottom
        // band belongs to the song page only.
        if (view === 'song') {
            updateWorkTopBar();
        } else {
            const shellNavByView = {
                'search': 'search', 'add-song': 'add',
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
        if (isHome) renderCollectionCardsIfHome();

        switch (view) {
            case 'home':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                break;
            case 'search':
                searchContainer?.classList.remove('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                // An empty box means BROWSE THE WHOLE CANON, not "show a
                // prompt": the home page's "Search All Songs" card advertises
                // "Browse the full jam collection — N songs", so #search, the
                // card, and the nav link must all deliver that.
                //
                // Guarded on the corpus being loaded. showView('search') can
                // fire before loadIndex resolves, and rendering an empty
                // allSongs would paint "No songs found" — which the load flow
                // then wipes (`resultsDiv.innerHTML = ''`), leaving a blank
                // page that never recovers, because the later
                // showView('search') is a no-op when the view is unchanged.
                // The entry points call browseAllSongs() themselves for that
                // reason; this branch just covers other transitions.
                //
                // allSongs.length also stays 0 when loadIndex() has
                // definitively failed rather than merely being in flight —
                // that permanent case is surfaced separately via
                // corpusLoadFailed (state.js) and the shell banner it drives,
                // so this guard doesn't need to distinguish the two: staying
                // silent is correct either way.
                if (!searchInput?.value?.trim() && resultsDiv && allSongs.length) {
                    showPopularSongs();
                }
                searchInput?.focus();
                break;
            case 'add-song':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                // The panel's listeners (paste conversion, preview, undo) are
                // wired by initEditor, which runs when the editor module
                // finishes loading. Showing the panel before that lets a
                // fast paste or keystroke land in an unwired textarea, so on
                // the first visit it appears only once the editor is ready.
                if (editorModule) {
                    editorPanel?.classList.remove('hidden');
                } else {
                    loadEditor().then(() => {
                        if (currentView === 'add-song') editorPanel?.classList.remove('hidden');
                    }).catch((err) => lazyLoadFailed('the editor', err));
                }
                break;
            case 'favorites':
                searchContainer?.classList.remove('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                showFavorites();
                break;
            case 'song':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.add('hidden');
                songView?.classList.remove('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                // Show delete button for admins
                updateDeleteButtonVisibility();
                break;
            case 'list':
                searchContainer?.classList.remove('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                break;
            case 'bounty':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                renderBountyView(resultsDiv);
                break;
            case 'my-submissions':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                renderMySubmissionsView(resultsDiv);
                break;
            case 'high-scores':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                renderHighScoresView(resultsDiv);
                break;
            case 'drafts':
                searchContainer?.classList.add('hidden');
                resultsDiv?.classList.remove('hidden');
                songView?.classList.add('hidden');
                editorPanel?.classList.add('hidden');
                songListsView?.classList.add('hidden');
                renderDraftsView(resultsDiv);
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

// Collection fallback icons (thumbnails live in collections.js)

const COLLECTION_ICONS = {
    'bluegrass-standards': '🎸',
    'first-generation': '👴',
    'gospel': '⛪',
    'fiddle-tunes': '🎻',
    'jam-friendly': '🤝',
    'bluegrass-dungeon': '🧟',
    'classic-country': '🤠',
    'old-time': '🪕',
    'chord-explorer': '🎹'
};

/**
 * Get distinct song count (counts unique titles, case-insensitive)
 * This matches the count shown in search results via showPopularSongs()
 */
function getDistinctSongCount() {
    return countDistinctTitles(allSongs);
}

// The landing cards are built only while the home view is showing. A visitor
// who arrives on a song (a shared link, a bookmark) never sees them, and used
// to download every card image into a hidden page. `Stale` = the corpus changed
// since they were built (their counts come from it).
let collectionCardsStale = true;
let collectionCardsRendered = false;

function renderCollectionCardsIfHome() {
    if (currentView !== 'home' || !collectionCardsStale || !canonRows.length) return;
    collectionCardsStale = false;
    collectionCardsRendered = true;
    renderCollectionCards();
}

/**
 * Render collection cards on the landing page
 */
function renderCollectionCards() {
    if (!collectionsGrid) return;

    const cards = COLLECTIONS.map(collection => {
        // Count songs matching the query (or distinct titles for "all songs", or skip for tools/dungeon)
        const count = (collection.isToolLink || collection.isDungeonLink) ? 0 : collection.isSearchLink ? getDistinctSongCount() : getCollectionSongCount(collection.query);
        const icon = COLLECTION_ICONS[collection.id] || '🎵';
        const thumbHtml = collectionThumbnailHtml(collection.id, escapeAttr(collection.title));

        // Use image if available, otherwise fall back to emoji icon
        const imageContent = thumbHtml || icon;

        // Determine href based on collection type
        const href = collection.isDungeonLink
            ? '#dungeon'
            : collection.isToolLink
            ? collection.href
            : collection.isSearchLink
            ? '#search'
            : `#search/${encodeURIComponent(collection.query)}`;

        return `
            <a href="${href}"
               class="collection-card${thumbHtml ? ' has-image' : ''}${collection.isSearchLink ? ' search-all' : ''}${collection.isToolLink ? ' tool-link' : ''}${collection.isDungeonLink ? ' dungeon-card' : ''}"
               data-collection="${collection.id}"
               style="--collection-color: ${collection.color}">
                <div class="collection-image">
                    ${imageContent}
                </div>
                <div class="collection-content">
                    <h3 class="collection-title">${escapeHtml(collection.title)}</h3>
                    <p class="collection-description">${escapeHtml(collection.description)}</p>
                    ${(collection.isToolLink || collection.isDungeonLink) ? '' : `<span class="collection-count">${count.toLocaleString()} songs</span>`}
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

            if (href === '#dungeon') {
                enterDungeon('');
                track('collection_click', { collection: 'bluegrass-dungeon' });
            } else if (isSearchAll) {
                browseAllSongs();
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
        if (song.indexed === false) return false;
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

/**
 * Open one of the three tab-authoring routes (plan §9.2), resolving a
 * `?draft={id}` first.
 *
 * A hash cannot carry a document, so every "reopen this work in progress"
 * path — the Drafts list, the OS file handler, a `.tef` dragged onto the
 * window — parks the OTF in IndexedDB and puts its id in the URL. This is
 * the one place that reads it back: the route then opens on the DRAFT's
 * document instead of a fresh empty take (or, for an edit, instead of the
 * published take it corrects).
 *
 * A draft id that no longer resolves is not an error — the route simply
 * opens the way it would have without it.
 */
async function openTabRoute(route, hash) {
    // `file=1` rides along from pwa.js: it means "this draft is a file the
    // reader just opened", which the take header says out loud.
    const { draft: draftId, file: fromFile } = parseHashParams(hash);
    let draft = null;
    if (draftId) {
        try {
            const record = await getDraftStore().get(draftId);
            if (record?.otf?.tracks?.length) draft = record;
        } catch (err) {
            console.warn('Could not read that draft', err);
        }
    }

    if (route.kind === 'new-tab') {
        const options = { ...route.options };
        if (draft) {
            options.otf = draft.otf;
            options.title = options.title || draft.title || '';
            options.instrument = options.instrument
                || partInstrumentFor(draft.otf, draft.instrument);
        }
        openNewTabPage({ ...options, draft, fromFile: fromFile && !!draft });
        return;
    }

    const workId = resolveWorkId(route.workId);
    if (route.kind === 'add-tab') {
        openWork(workId, {
            fromDeepLink: true,
            addTab: { ...route.target, ...(draft ? { otf: draft.otf } : {}) },
            draft,
        });
        return;
    }
    openWork(workId, { fromDeepLink: true, editRef: route.partRef, draft });
}

/**
 * The page just came back from the Google sign-in redirect. Put the user back
 * where they were: route to the recorded hash and let the open editor restore
 * its state (auth-return.js). Never submits anything on their behalf.
 *
 * @param {{signedIn: boolean}} options - false when the redirect came back with
 *   an error (consent refused): the work is restored all the same.
 */
async function resumeAfterAuthRedirect({ signedIn }) {
    const record = takeReturnRecord();
    if (!record) return;
    await bootRouted;

    const message = signedIn
        ? 'Signed in \u2014 ready to submit'
        : 'Sign-in did not finish \u2014 your work is still here';
    // The staged text lives in editor.js, which loads on demand (B7a): load it
    // first, so the #add / #edit route below finds the snapshot waiting.
    let editor = null;
    if (record.kind === 'lead-sheet') {
        try {
            editor = await loadEditor();
        } catch (err) {
            lazyLoadFailed('the editor', err);
        }
        if (editor && record.state) editor.stageEditorRestore(record.state, { message });
    }

    // Replace the token-bearing URL with the route we left, then route it the
    // way a fresh load of that URL would (#add, #edit/{id}, a tab route with
    // its ?draft=, or any other page).
    history.replaceState(null, '', window.location.pathname + record.hash);
    handleDeepLink();

    if (record.kind === 'lead-sheet') {
        editor?.applyEditorRestore();   // the new-song editor; an edit's waits for enterEditMode
    } else if (record.kind === 'tab') {
        showToast(message, { duration: 6000 });
    }
}

function handleDeepLink() {
    const hash = window.location.hash;
    if (!hash) return false;

    // Dungeon chrome persists only on dungeon and song URLs — every other
    // destination drops back to the canon scope
    if (!/^#(dungeon|work\/|song\/)/.test(hash)) {
        setDungeonMode(false);
    }

    // Use replace=true for deep links to avoid duplicate history entries
    // (the URL is already set from the initial page load)

    // The tab-authoring routes (plan §9.2). They come FIRST because two of
    // them live under `#work/` and would otherwise be read as a part id.
    // Each one is the song page in a different mode — never a page of its
    // own — so they all end up in openWork()/openNewTabPage().
    const tabRoute = parseTabRoute(hash);
    if (tabRoute) {
        trackDeepLink(`tab-${tabRoute.kind}`, hash);
        // `?draft={id}` (Drafts list, file handler, drag-and-drop) has to be
        // read out of IndexedDB, which is async — openTabRoute does that and
        // then opens the page, while this stays synchronous about the one
        // thing its caller needs to know: the hash was ours.
        openTabRoute(tabRoute, hash);
        return true;
    }

    if (hash === '#drafts') {
        // The PWA's personal bucket. No login and no network: it reads
        // IndexedDB, which is the point — this is the offline surface.
        trackDeepLink('drafts', hash);
        showView('drafts');
        pushHistoryState('drafts', {}, true);
        return true;
    }

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
        (async () => {
            let song = allSongs.find(s => s.id === songId);
            if (!song) {
                // Might be an archived work — wait for archive.jsonl once
                await ensureArchiveLoaded();
                song = allSongs.find(s => s.id === songId);
            }
            if (song) {
                // Route through the view state machine so the landing page is
                // hidden before the editor panel is shown (enterEditMode only
                // toggles editor-adjacent panels, not the home view)
                showView('add-song');
                await enterEditMode(song, { fromDeepLink: true });
                pushHistoryState('edit', { songId }, true);
            } else {
                // Song not found, go to search
                showView('search');
            }
        })();
        return true;
    } else if (hash === '#bounty') {
        trackDeepLink('bounty', hash);
        showView('bounty');
        pushHistoryState('bounty', {}, true);
        return true;
    } else if (hash === '#my-submissions') {
        trackDeepLink('my-submissions', hash);
        showView('my-submissions');
        pushHistoryState('my-submissions', {}, true);
        return true;
    } else if (hash === '#high-scores') {
        trackDeepLink('high-scores', hash);
        showView('high-scores');
        pushHistoryState('high-scores', {}, true);
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
    } else if (hash === '#dungeon') {
        trackDeepLink('dungeon', hash);
        enterDungeon('', { replace: true });
        return true;
    } else if (hash.startsWith('#dungeon/')) {
        const query = decodeURIComponent(hash.slice(9));
        trackDeepLink('dungeon', hash);
        enterDungeon(query, { replace: true });
        return true;
    } else if (hash === '#search') {
        // Search view without query = browse the whole canon
        trackDeepLink('search', hash);
        browseAllSongs();
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
async function openSongInFavorites(itemRef, fromDeepLink = false) {
    const { workId, partId } = parseItemRef(itemRef);

    // Open the tapped song first; the prev/next context is refined once any
    // favorite that only the archive holds has loaded (never block on it).
    const favList = getFavoritesList();
    const buildFavSongIds = () => favList ? favList.songs.filter(ref => {
        const { workId: wid } = parseItemRef(ref);
        return allSongs.find(s => s.id === wid);
    }) : [];
    const favSongIds = buildFavSongIds();
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

    // Refine the prev/next context with archived favorites, if any.
    if (favList && window.isArchiveLoaded?.() === false) {
        ensureArchiveForRefs(favList.songs).then(() => {
            const ids = buildFavSongIds();
            // Skip if nothing changed or the context has moved on meanwhile.
            if (ids.length === favSongIds.length || listContext?.listId !== 'favorites') return;
            const idx = ids.indexOf(itemRef);
            setListContext({
                listId: 'favorites',
                listName: 'Favorites',
                songIds: ids,
                currentIndex: idx >= 0 ? idx : 0
            });
        });
    }
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

/**
 * Show the search view browsing the WHOLE canon (empty query).
 *
 * Called explicitly by every "browse everything" entry point rather than
 * relying on the currentView subscriber: showView('search') is a no-op when
 * the view is already 'search', so the subscriber can't be trusted to fire.
 */
function browseAllSongs() {
    setDungeonMode(false);
    if (searchInput) searchInput.value = '';
    showView('search');
    showPopularSongs();
}

/**
 * Enter the Bluegrass Dungeon: the archive-only search scope.
 * Waits for archive.jsonl if it hasn't arrived yet (idle prefetch).
 */
async function enterDungeon(query = '', { fromHistory = false, replace = false } = {}) {
    setDungeonMode(true);
    if (searchInput) searchInput.value = query;
    showView('search');
    if (!fromHistory) pushHistoryState('dungeon', { query }, replace);
    if (!window.isArchiveLoaded()) {
        if (searchStats) searchStats.textContent = '';
        if (resultsDiv) resultsDiv.innerHTML = '<div class="dungeon-loading">🧟 Opening the dungeon…</div>';
        await ensureArchiveLoaded();
        // User may have navigated away while the archive downloaded
        if (!dungeonMode) return;
    }
    search(query);
    if (searchableSongs().length === 0 && resultsDiv) {
        resultsDiv.innerHTML = '<div class="no-results">The dungeon is empty — the archive could not be loaded. Try reloading the page.</div>';
    }

    // The Dungeon is where curation happens (Promote lives on its songs), so
    // the review queue for the destructive asks hangs here too. It renders
    // itself away for anyone who is neither trusted nor admin.
    showReviewQueue();
}

function navigateTo(mode) {
    trackNavigation(mode);
    // Entering Add Song after an edit session must start from a fresh
    // new-song editor (an unsaved new-song draft is preserved)
    if (mode === 'add-song') prepareAddSongView();
    // The Search nav link browses everything when there's nothing typed, but
    // never throws away a query the user still has in the box.
    if (mode === 'search' && !searchInput?.value?.trim()) {
        browseAllSongs();
        pushHistoryState(mode);
        return;
    }
    if (dungeonMode) {
        // Explicit nav away from the dungeon returns to the canon scope;
        // re-run any typed query so results match the restored scope
        setDungeonMode(false);
        if (mode === 'search' && searchInput?.value?.trim()) {
            search(searchInput.value);
        }
    }
    showView(mode);
    pushHistoryState(mode);
}

// ============================================
// LOAD INDEX
// ============================================

// The pending → index-row transform lives in corpus.js
// (`transformPendingRow`): a `pending_songs` row is a whole SONG or a
// tablature PART depending on its `part_type`, and only the merge knows
// which work a part belongs to. Keeping the branch next to the merge is
// also what makes both testable without booting the app.

// The three row sources, kept apart so any one of them can be re-fetched
// and re-merged without re-reading the others (see rebuildCorpus).
let canonRows = [];
let archiveRows = [];
let pendingRows = [];

// Curation overlays from Supabase, applied on top of the static rows exactly
// as the index build applies docs/data/{deleted,promoted}_songs.json — so an
// admin delete or a trusted-user promote is live now instead of after the
// hourly sync and the next deploy. Also written in-session by the
// promote/delete handlers below.
//
// The last-known sets are cached in localStorage and applied at boot, before
// the network answers: a deleted song must not flash into the first paint just
// because the overlay request is still in flight. The fetched sets replace them.
const deletedIds = readCachedIdSet('deleted');
const promotedIds = readCachedIdSet('promoted');

/** Remember the curation sets for the next visit's first paint. */
function persistCuration() {
    writeCachedIdSet('deleted', deletedIds);
    writeCachedIdSet('promoted', promotedIds);
}

// Archive load state. The archive is fetched ON DEMAND — nothing prefetches it
// any more — by whatever needs an archived row: an unknown id on a song page,
// the Dungeon, a list / favorites / export that names an archived song, the
// bounty board and the add-song picker (they match against every title), an
// overlay that targets an archived work (syncArchiveNeed). The promise
// resolves once the archive is merged (or has definitively failed) and NEVER
// rejects, so awaiting it is always safe; window.ensureArchiveLoaded() is the
// hook other modules use.
let archivePromise = null;
let archiveLoaded = false;

/**
 * Re-merge canon + archive + pending into allSongs/songGroups and refresh
 * the counts that describe "the book". Subscribers of `allSongs` (lists,
 * search results) re-render themselves off the notification.
 */
function rebuildCorpus() {
    const { songs, groups } = mergeCorpus({
        canon: canonRows,
        archive: archiveRows,
        pending: pendingRows,
        deleted: deletedIds,
        promoted: promotedIds,
        archiveLoaded,
    });
    setAllSongs(songs);
    setSongGroups(groups);
    // The landing cards count the corpus; they are rebuilt from it the next
    // time the home view shows (or right now if it is showing).
    builtOverlayVersion = overlayVersion;
    collectionCardsStale = true;
    if (collectionCardsRendered) renderCollectionCardsIfHome();
    return songs;
}

/** The searchable-title count shown next to the search box. */
function updateSongbookCount(songs) {
    if (!searchStats) return;
    searchStats.textContent = `${countDistinctTitles(songs).toLocaleString()} songs`;
}

/**
 * Load data/archive.jsonl and merge it in. Idempotent: repeat calls get the
 * same promise, so a deep link that needs an archived work and the idle
 * prefetch can't double-fetch.
 */
function loadArchive() {
    if (archivePromise) return archivePromise;

    archivePromise = fetchJsonl('data/archive.jsonl')
        .then(rows => {
            archiveRows = markArchived(rows);
            // Flag first: the merge applies the pending rows it was holding
            // back for this archive.
            archiveLoaded = true;
            rebuildCorpus();
            console.log(`Archive loaded: ${archiveRows.length} rows off the shelf`);
        })
        .catch(error => {
            // No archive published (or offline): the canon still works, only
            // deep links to pruned works fail — mark it done so nothing waits.
            // Re-merge so the pending rows held back for it apply as they are.
            archiveLoaded = true;
            rebuildCorpus();
            console.warn('Archive not loaded:', error.message);
        });

    return archivePromise;
}

/**
 * Await the archive exactly once from any path that failed to resolve an id
 * in the canon (openWork, legacy #song/ redirects, #edit/ deep links).
 * Resolves immediately when the archive is already in.
 */
function ensureArchiveLoaded() {
    if (archiveLoaded) return Promise.resolve();
    return loadArchive();
}
window.ensureArchiveLoaded = ensureArchiveLoaded;
window.isArchiveLoaded = () => archiveLoaded;

/**
 * Bring the archive in when the Supabase overlays only make sense with it (a
 * promotion of an archived work the canon doesn't hold yet, a pending edit or
 * tab for one) — see corpus.overlaysNeedArchive. Cheap and idempotent.
 */
function syncArchiveNeed() {
    if (archiveLoaded || archivePromise) return;
    if (overlaysNeedArchive({
        canon: canonRows, pending: pendingRows, promoted: promotedIds, deleted: deletedIds,
    })) {
        loadArchive();
    }
}

/**
 * Fetch the pending overlay as merge-ready rows, WITHOUT `content`.
 *
 * `select('*')` shipped every pending row's whole body (up to 200 KB a chart,
 * 2 MB a tab) to every visitor on every load. The merge needs the columns in
 * PENDING_OVERLAY_COLUMNS and one bit more — does the row HAVE a body? — which
 * a second, id-only query answers (rows with a non-empty `content`). The text
 * itself is read from pending_songs when its song is opened (song-content's
 * pending fetcher, registered below).
 *
 * @returns {Promise<Array|null>} transformed rows, or null when the read failed
 */
async function fetchPendingOverlayRows(supabase) {
    // PostgREST builders are thenables, not promises — Promise.resolve gives
    // us a .catch so one failing query can't take the other down.
    const safe = query => Promise.resolve(query).catch(error => ({ data: null, error }));

    const [rows, withText] = await Promise.all([
        safe(supabase.from('pending_songs').select(PENDING_OVERLAY_COLUMNS)),
        safe(supabase.from('pending_songs').select('id')
            .not('content', 'is', null).neq('content', '')),
    ]);
    if (!rows.data || rows.error) {
        console.warn('Could not fetch pending songs:', rows.error);
        return null;
    }
    // If only the id query failed, rows go through with no `has_content`
    // signal — the transform then assumes a body unless the row's kind says
    // it has none, which errs toward showing the song.
    const haveText = withText.data && !withText.error
        ? new Set(withText.data.map(r => r.id)) : null;
    return rows.data.map(row => transformPendingRow(
        haveText ? { ...row, has_content: haveText.has(row.id) } : row));
}

// Reads one pending row's text for song-content (a song, a fork, or a tab
// take that was opened). Null once the row is gone.
setPendingContentFetcher(async (id) => {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) throw new Error('Not connected');
    const { data, error } = await supabase
        .from('pending_songs').select('content').eq('id', id).maybeSingle();
    if (error) throw error;
    return typeof data?.content === 'string' ? data.content : null;
});

// The overlay fetch starts WITH the index download (loadIndex) and is raced
// against a short grace period rather than awaited: a slow or down Supabase
// must not hold the first render hostage.
const OVERLAY_GRACE_MS = 800;
let overlayPromise = null;
// Bumped when fetched overlay data lands; rebuildCorpus records the version it
// merged, so a late arrival knows whether the corpus still needs a re-merge.
let overlayVersion = 0;
let builtOverlayVersion = 0;

/**
 * Fetch the Supabase overlays: pending edits plus the two world-readable
 * curation tables. All three go out together, in parallel with the index
 * (the deleted/promoted sets are also cached from the last visit so a deleted
 * song does not flash in while they are in flight).
 *
 * Fails soft in every direction: no client, a down backend, or a single
 * table erroring leaves the static index exactly as it was built. Never
 * rejects. The caller rebuilds the corpus afterwards.
 */
async function fetchSupabaseOverlays() {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) return;

    // PostgREST builders are thenables, not promises — Promise.resolve gives
    // us a .catch so one failing table can't take the other two down.
    const safe = query => Promise.resolve(query).catch(error => ({ data: null, error }));

    try {
        const [pending, deleted, promoted] = await Promise.all([
            fetchPendingOverlayRows(supabase),
            safe(supabase.from('deleted_songs').select('song_id')),
            safe(supabase.from('promoted_songs').select('song_id')),
        ]);

        if (pending) {
            pendingRows = pending;
            if (pendingRows.length > 0) {
                console.log(`Merged ${pendingRows.length} pending row(s) — songs and tab parts`);
            }
        }
        // The fetched sets REPLACE the cached ones: an un-delete or an
        // un-promote has to be able to take effect.
        if (deleted.data && !deleted.error) {
            deletedIds.clear();
            for (const row of deleted.data) deletedIds.add(row.song_id);
            if (deletedIds.size > 0) {
                console.log(`Hiding ${deletedIds.size} deleted song(s)`);
            }
        }
        if (promoted.data && !promoted.error) {
            promotedIds.clear();
            for (const row of promoted.data) promotedIds.add(row.song_id);
            if (promotedIds.size > 0) {
                console.log(`Promoted ${promotedIds.size} song(s) into search`);
            }
        }
        persistCuration();
    } catch (e) {
        console.warn('Could not fetch Supabase overlays:', e);
        // Static index still works - graceful degradation
    }
    overlayVersion++;
}

/** Start the overlay fetch once; every caller shares the promise. */
function startOverlayFetch() {
    if (!overlayPromise) overlayPromise = fetchSupabaseOverlays();
    return overlayPromise;
}

// Other modules (openWork) wait for the overlays before giving up on an id.
// Bounded — a hung backend must not hold a deep link on "Loading song…" — and
// merge-aware: overlays that land after the first render are folded into the
// corpus BEFORE the caller looks again, so a brand-new pending song is found
// without the archive. The cap is larger than OVERLAY_GRACE_MS on purpose.
const OVERLAY_SETTLE_CAP_MS = 3000;
window.whenOverlaysSettled = () => Promise.race([
    (overlayPromise || Promise.resolve()).then(() => {
        if (canonRows.length && builtOverlayVersion !== overlayVersion) rebuildCorpus();
    }),
    new Promise(resolve => setTimeout(resolve, OVERLAY_SETTLE_CAP_MS)),
]);

// Guards against a Retry click (or any other caller) overlapping an
// in-flight loadIndex() — the function is otherwise re-entrant (it only
// mutates state on success paths), so this just avoids a wasted duplicate
// fetch rather than fixing a correctness bug.
let indexLoadInFlight = false;

// Settles once the boot URL has been routed (or the load gave up): from then
// on it is safe to route somewhere ELSE on purpose. The sign-in return waits
// for it, or the boot tail would route the token-bearing URL to home right
// over the top of the route it restored.
let resolveBootRouted;
const bootRouted = new Promise(resolve => { resolveBootRouted = resolve; });

async function loadIndex() {
    if (indexLoadInFlight) return;
    indexLoadInFlight = true;

    if (resultsDiv) {
        resultsDiv.innerHTML = '<div class="loading">Loading songbook...</div>';
    }

    try {
        // Only the canon blocks first paint. Song content (data/songs/{id}.pro)
        // is fetched per song page; the archive is fetched only when something
        // asks for an archived row. The Supabase overlays start NOW, in
        // parallel with the index, and are raced against a grace period below.
        const overlays = startOverlayFetch();
        const [canon, redirectsResponse] = await Promise.all([
            fetchJsonl('data/index.jsonl'),
            fetch('data/redirects.json').catch(() => null),
        ]);
        canonRows = canon;

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

        // Give the overlays a moment to land so a pending row or a deletion
        // is in the first paint; a slow backend is merged in when it answers.
        await Promise.race([
            overlays,
            new Promise(resolve => setTimeout(resolve, OVERLAY_GRACE_MS)),
        ]);

        const songs = rebuildCorpus();
        // Cached promoted ids count at once, not only after the overlay
        // fetch settles (supabase-js retries a failing GET for several seconds).
        syncArchiveNeed();

        // A retry that succeeds clears both the flag and the banner a
        // previous failure left up.
        setCorpusLoadFailed(false);
        setBanner(null);

        if (resultsDiv) {
            resultsDiv.innerHTML = '';
        }
        updateSongbookCount(songs);

        // (The landing page's collection cards are built when the home view is
        // shown — below for a plain load, never for a deep link.)

        // Boot is over: history is under normal control from here on, and
        // pushHistoryState stops claiming the boot route. Set before the
        // routing below so handleDeepLink's own replace-pushes don't claim it.
        setHistoryInitialized(true);

        // Route the URL the page loaded with — a deep link, or the landing
        // page. Skipped entirely if the user already navigated while the
        // corpus was loading: that navigation owns the view, and re-running
        // the boot URL here would steal it back (the hash still reads as the
        // boot hash for nav links that push state without a hashchange).
        if (canRouteBootUrl()) {
            if (!handleDeepLink()) {
                showView('home');
                history.replaceState({ view: 'home' }, '', window.location.pathname);
            }
        }
        // The cards belong to the home view: a visitor headed for a song never
        // builds them (or downloads their images) because this returns early
        // unless the view is 'home'. Not gated on the deep-link result: some
        // handlers (#request-song, #invite/<token>) return true yet leave the
        // landing page showing. The currentView subscriber builds them on the
        // way home otherwise.
        renderCollectionCardsIfHome();

        // Fetch bounties in background (non-blocking, not needed for initial render)
        refreshBounties();

        // Overlays that missed the grace period: merge them in now, and pull
        // the archive in if they only make sense with it (a promotion of an
        // archived work, a pending edit of one). Runs at once if they landed.
        overlays.then(() => {
            if (builtOverlayVersion !== overlayVersion) {
                rebuildCorpus();
                // The result list already on screen was drawn without them (a
                // deleted song still in it, a pending one missing): draw it
                // again from the merged corpus.
                if (currentView === 'search' && searchInput?.value?.trim()) {
                    search(searchInput.value);
                }
            }
            syncArchiveNeed();
        });
    } catch (error) {
        console.error('Failed to load index:', error);
        overlayPromise = null;   // a Retry starts the overlays over with the index
        if (resultsDiv) {
            resultsDiv.innerHTML = `<div class="loading">Error loading songs: ${error.message}</div>`;
        }
        // Loud and global: a failed corpus load isn't just this view's
        // problem — every consumer of allSongs (search, add-song picker,
        // review-queue merge dialog) needs to know the corpus is empty
        // because the fetch failed, not because there's nothing to find.
        setCorpusLoadFailed(true);
        setBanner(
            "The songbook index failed to load — search and song lists will be empty.",
            { onRetry: () => loadIndex() }
        );
    } finally {
        indexLoadInFlight = false;
        resolveBootRouted();
    }
}

/**
 * Refresh the pending overlay from Supabase and merge into allSongs.
 * Call this after any save so the contribution is available immediately for
 * navigation — a song, a correction, or (since tabs joined the instant
 * pipeline) a tablature part landing on the work it targets.
 * Note: Exposed on window for editor.js to avoid circular import.
 */
async function refreshPendingSongs() {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) return;

    try {
        const rows = await fetchPendingOverlayRows(supabase);
        if (!rows) return;

        pendingRows = rows;
        syncArchiveNeed();
        rebuildCorpus();

        if (pendingRows.length > 0) {
            console.log(`Refreshed: ${pendingRows.length} pending row(s) merged`);
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

// Trusted state (cached the same way; gates the Promote overflow item)
let isTrustedFlag = false;

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

        // Check admin/trusted status (async, updates UI when ready)
        checkAdminStatus();
        checkTrustedStatus();
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

        // Clear admin/trusted status (drops the Delete and Promote items
        // from the song overflow)
        isAdminUser = false;
        isTrustedFlag = false;
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

// Check if current user is trusted and update UI (gates Promote)
async function checkTrustedStatus() {
    if (typeof SupabaseAuth !== 'undefined') {
        isTrustedFlag = await SupabaseAuth.isTrustedUser();
        updateDeleteButtonVisibility();
    }
}

// Admin/trusted status changed: rebuild the song page's top band so the
// Delete/Promote overflow items appear/disappear (work-view reads the
// isAdmin/isTrusted hooks).
function updateDeleteButtonVisibility() {
    if (currentView === 'song') {
        updateWorkTopBar();
    }
    // Trust/admin resolving late must not leave the Dungeon's queue hidden
    // (or, on sign-out, visible).
    if (dungeonMode) showReviewQueue();
}

// Promote the viewed archived song into the main index (trusted users).
// Writes a promoted_songs row, which every browser reads at startup and
// applies client-side (see fetchSupabaseOverlays) — so the promotion is live
// for everyone immediately. The hourly sync + rebuild are durability, not
// delivery: they fold the same decision into the built index.
async function handlePromoteSong() {
    const song = getCurrentSong();
    if (!song) return;

    if (promotedIds.has(song.id)) {
        // Undo path
        const { error } = await SupabaseAuth.unpromoteSong(song.id);
        if (error) {
            alert(`Could not undo promotion: ${error.message}`);
            return;
        }
        promotedIds.delete(song.id);
        persistCuration();
        song.indexed = false;
        rebuildCorpus();
        alert(`Promotion of "${song.title}" undone.`);
        updateWorkTopBar();
        return;
    }

    if (song.indexed !== false) {
        alert(`"${song.title}" is already in the songbook.`);
        return;
    }

    const { error } = await SupabaseAuth.promoteSong(song.id);
    if (error) {
        alert(`Could not promote song: ${error.message}`);
        return;
    }
    promotedIds.add(song.id);
    persistCuration();
    song.indexed = true;
    rebuildCorpus();
    alert(`Promoted "${song.title}" to the songbook!\n\nIt is searchable right away — for you and for everyone who loads the site from now on.`);
    updateWorkTopBar();
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
            <input type="checkbox" value="${escapeAttr(c.id)}" ${c.isCurrent ? 'checked' : ''}>
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
        for (const id of ids) deletedIds.add(id);
        persistCuration();
        rebuildCorpus();
        alert(`Deleted: ${ids.join(', ')}\n\nGone from the site right away; the next sync and rebuild make it permanent.`);
        goBack();
    } catch (err) {
        console.error('Error deleting song:', err);
        statusEl.textContent = `Failed: ${err.message}`;
        confirmBtn.disabled = false;
    }
}

// Trusted-but-not-admin: the same overflow slot files a request instead of
// deleting. Admins keep the instant modal above — they are the reviewers, so
// queueing them would just be a round trip through their own inbox.
async function handleRequestDeleteSong() {
    const song = getCurrentSong();
    if (!song) return;

    const reason = prompt(
        `Ask an admin to delete "${song.title}"?\n\nWhy should it go? (duplicate, junk data, wrong song…)`
    );
    if (reason === null) return;
    if (!reason.trim()) {
        alert('A reason is required — the reviewer only sees what you write here.');
        return;
    }

    const rq = await requireReviewQueue();
    if (!rq) return;
    const { error } = await rq.submitReviewRequest({
        kind: 'delete',
        targetId: song.id,
        payload: { title: song.title },
        reason: reason.trim(),
    });
    if (error) {
        alert(`Could not file the request: ${error.message}`);
        return;
    }
    alert(`Requested deletion of "${song.title}".\n\nIt stays on the site until an admin approves it — you can follow it in the review queue in the Bluegrass Dungeon.`);
    if (dungeonMode) showReviewQueue();
}

// Suppress and merge-redirect have no instant execution path (see
// review-queue.js), so both go through the same request queue for any
// trusted user — the dialogs collect what submitReviewRequest needs and
// validate before it ever reaches the network.
async function handleRequestSuppressSong() {
    const song = getCurrentSong();
    if (!song) return;

    const rq = await requireReviewQueue();
    if (!rq) return;
    const reason = await rq.showSuppressRequestDialog(song);
    if (reason === null) return; // cancelled

    const { error } = await rq.submitReviewRequest({
        kind: 'suppress',
        targetId: song.id,
        payload: {},
        reason,
    });
    if (error) {
        alert(`Could not file the request: ${error.message}`);
        return;
    }
    alert(`Requested suppression of "${song.title}".\n\nIt stays searchable until an admin approves the request AND runs the suppress command it prints — you can follow both steps in the review queue in the Bluegrass Dungeon.`);
    if (dungeonMode) showReviewQueue();
}

async function handleRequestMergeSong() {
    const song = getCurrentSong();
    if (!song) return;

    // The merge target can be any work, an archived one included.
    await ensureArchiveLoaded();

    const rq = await requireReviewQueue();
    if (!rq) return;
    const outcome = await rq.showMergeRequestDialog(song, { songs: allSongs });
    if (outcome === null) return; // cancelled

    const { error } = await rq.submitReviewRequest({
        kind: 'merge-redirect',
        targetId: song.id,
        payload: rq.buildMergeRedirectPayload(outcome.targetId),
        reason: outcome.reason,
    });
    if (error) {
        alert(`Could not file the request: ${error.message}`);
        return;
    }
    alert(`Requested merging "${song.title}" into "${outcome.targetTitle}".\n\nBoth songs stay as they are until an admin approves the request AND runs the merge command it prints — you can follow both steps in the review queue in the Bluegrass Dungeon.`);
    if (dungeonMode) showReviewQueue();
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

function initAuthModal() {
    // Auth modal open/close
    authModalClose?.addEventListener('click', closeAuthModal);
    authModal?.addEventListener('click', (e) => {
        if (e.target === authModal) closeAuthModal();
    });

    // Google sign-in button within auth modal
    authGoogleBtn?.addEventListener('click', async () => {
        closeAuthModal();
        persistReturnRecord();
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

/**
 * The list currently being viewed, with its songs resolved against the corpus.
 * Shared by every Export action so print and download can't drift apart on
 * which songs they think are in the list.
 */
async function resolveViewingList() {
    const listId = getViewingListId();
    if (!listId) return null;

    // Find the list (favorites is now just a regular list)
    let list = userLists.find(l => l.id === listId || l.cloudId === listId);

    // Handle 'favorites' ID
    if (!list && listId === 'favorites') {
        list = getFavoritesList();
    }

    if (!list) return null;

    // Print / export name every song: an archived one has to be loaded first.
    await ensureArchiveForRefs(list.songs);
    const listSongs = list.songs
        .map(id => allSongs.find(s => s.id === id))
        .filter(Boolean);

    return { list, listSongs };
}

async function openPrintListView() {
    const resolved = await resolveViewingList();
    if (!resolved) return;
    const { list, listSongs } = resolved;

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

    // Lead sheets live in data/songs/{id}.pro now — pull them all in before
    // rendering (failures come back as '' so one bad song can't kill a set)
    const contents = await getSongContents(listSongs);

    const printHtml = generatePrintListPage(list.name, listSongs, prefs, contents);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow popups for print view');
        return;
    }
    printWindow.document.write(printHtml);
    printWindow.document.close();
}

/**
 * Download the whole list as one file. Both formats export the SOURCE
 * ChordPro, not the transposed/Nashville view — same as the song page's
 * Export, so a downloaded file always matches what's stored.
 */
async function handleListExport(action) {
    if (action === 'print') {
        openPrintListView();
        return;
    }

    const resolved = await resolveViewingList();
    if (!resolved) return;
    const { list, listSongs } = resolved;

    if (listSongs.length === 0) {
        alert('No songs in this list to export.');
        return;
    }

    const contents = await getSongContents(listSongs);
    let exporter;
    try {
        exporter = await import('./list-export.js');
    } catch (err) {
        lazyLoadFailed('the export tools', err);
        return;
    }
    const { buildListChordPro, buildListText, buildListZipFiles, listFileBase } = exporter;
    const base = listFileBase(list.name);

    if (action === 'download-chordpro') {
        downloadFile(`${base}.pro`, buildListChordPro(listSongs, contents), 'text/plain');
    } else if (action === 'download-text') {
        downloadFile(`${base}.txt`, buildListText(listSongs, contents), 'text/plain');
    } else if (action === 'download-zip') {
        // One .pro per song, for readers that import a folder of files
        const files = buildListZipFiles(listSongs, contents);
        if (!files.length) {
            alert('No song content available to export.');
            return;
        }
        let createZip;
        try {
            ({ createZip } = await import('./zip.js'));
        } catch (err) {
            lazyLoadFailed('the export tools', err);
            return;
        }
        downloadFile(`${base}.zip`, createZip(files), 'application/zip');
    }
}

const LIST_EXPORT_ACTIONS = [
    { action: 'print', label: '🖨️ Print' },
    { action: 'download-chordpro', label: '⬇️ Download .pro' },
    { action: 'download-text', label: '⬇️ Download .txt' },
    { action: 'download-zip', label: '🗜️ Download .zip (one file per song)' },
];

/**
 * Export pill for the list header. The song page has had one of these all
 * along; list view only offered a bare Print button, which is what sent the
 * reporter of #206 looking for an Export control that wasn't there.
 */
function buildListExportPill() {
    return pill('Export', (container, api) => {
        container.innerHTML = LIST_EXPORT_ACTIONS.map(a =>
            `<button class="pill-popover-item" data-action="${a.action}">${a.label}</button>`
        ).join('');
        container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                api.close();
                handleListExport(btn.dataset.action);
            });
        });
    }, { id: 'list-export-pill', title: 'Print or download every song in this list' });
}

/**
 * Mount the Export pill in the list header, where the bare Print button used
 * to be. It leads the control row because printing/exporting a set is the
 * reason most people open a list in the first place.
 */
function mountListExportPill() {
    const controls = document.querySelector('.list-header-controls');
    if (!controls || document.getElementById('list-export-pill')) return;
    controls.insertBefore(buildListExportPill(), controls.firstChild);
}

function generatePrintListPage(listName, songs, prefs, contents = []) {
    // Pre-render every song HERE in the main window via the shared ChordPro
    // renderer (renderers/chordpro.js). The print window receives static
    // HTML only — its controls just toggle CSS body classes, so zero
    // parsing/rendering/transposition logic ships inside the page.
    const songsHtml = songs.map((song, idx) => {
        const { sections } = parseChordPro(contents[idx] || song.content || '');
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

    // Carry the reader's font size across the document boundary. The print
    // window can't inherit the app's em multiplier (it's a separate document
    // with its own stylesheet), so derive its px scale from the SAME
    // FONT_SIZES table the song page uses — one source of truth, not two.
    const fontPx = printFontPxForLevel(prefs.fontSizeLevel);

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
        .section-comment { font-style: italic; margin: 0 0 0.5rem; font-family: system-ui, sans-serif; }
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
        .song-content { font-size: var(--font-size, ${PRINT_BASE_FONT_PX}px); }
        :root { --font-size: ${fontPx}px; }
    </style>
</head>
<body class="${bodyClasses.join(' ')}">
    <div class="controls">
        <div class="font-size-control">
            <span class="control-label">Size:</span>
            <button id="font-decrease" class="size-btn">−</button>
            <input type="number" id="font-size-input" value="${fontPx}" min="${PRINT_FONT_PX_MIN}" max="${PRINT_FONT_PX_MAX}">
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
            input.value = Math.max(${PRINT_FONT_PX_MIN}, Math.min(${PRINT_FONT_PX_MAX}, v || ${fontPx}));
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

/**
 * The persistent ⋯ menu. Re-seeded (not appended to) whenever its contents
 * change, because setOverflowBase REPLACES the list — "Install app" appears
 * only once Chromium has offered us a `beforeinstallprompt`, and disappears
 * again the moment the app is installed.
 */
function seedOverflowBase() {
    setOverflowBase([
        ...(canInstall() ? [{
            label: 'Install app',
            onClick: async () => {
                await promptInstall();
                seedOverflowBase();   // the prompt is single-use
            },
        }] : []),
        { label: 'Drafts', onClick: () => { showView('drafts'); pushHistoryState('drafts'); } },
        { label: 'High Scores', onClick: () => { showView('high-scores'); pushHistoryState('high-scores'); } },
        { label: 'About', onClick: () => { location.href = 'about.html'; } },
        { label: 'Dev Blog', onClick: () => { location.href = 'blog.html'; } },
        { label: 'Standards Board', onClick: () => { location.href = 'bluegrass-standards-board.html'; } },
        { label: 'Support on Patreon', onClick: () => window.open('https://www.patreon.com/c/bluegrassbook', '_blank', 'noopener') },
        { label: 'Buy me a coffee', onClick: () => window.open('https://buymeacoffee.com/michaelbeav', '_blank', 'noopener') },
        { label: 'Send Feedback', onClick: () => openFeedbackModal({ type: 'general-feedback' }) },
    ]);
}

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
        // Bug reports get a first-class top-band button (the old homepage
        // "Report Bugs" sign is gone with the banner hero)
        onReportBug: () => openFeedbackModal({ type: 'bug-report' }),
    });
    seedOverflowBase();
    document.getElementById('topbar-brand')?.addEventListener('click', (e) => {
        e.preventDefault();
        setDungeonMode(false);
        searchInput.value = '';
        showView('home');
        pushHistoryState('home');
    });

    // Load saved view preferences (before rendering any songs)
    loadViewPrefs();

    // Initialize reactive view state subscription
    initViewSubscription();

    // Dungeon chrome (zombie topbar face, blood-red accent) follows the flag.
    // Read the live binding rather than the callback arg: notifies are
    // rAF-batched, so the argument can lag behind rapid flag changes.
    subscribe('dungeonMode', () => {
        document.body.classList.toggle('dungeon-mode', dungeonMode);
        // The review queue is Dungeon chrome too: leaving the scope takes it
        // with you (enterDungeon re-renders it on the way in).
        if (!dungeonMode) hideReviewQueue();
    });
    document.body.classList.toggle('dungeon-mode', dungeonMode);

    // Initialize analytics (early, before other modules)
    initAnalytics();

    // Initialize the unified feedback modal (song flags, corrections,
    // bug reports, general feedback)
    initFlags({ onEditSong: (song) => enterEditMode(song) });

    // Initialize super-user request module
    initSuperUserRequest();

    // Initialize the add-song picker. It is the single Add Song entry
    // (top-band nav item, contribute/request flows); the #add deep link still
    // goes straight to the editor. Binary document upload was removed in
    // phase 2d — the intake was a dead end, so the picker offers text or a
    // song request only.
    initAddSongPicker({
        onChordPro: (ctx) => {
            if (ctx?.targetSlug) {
                enterEditMode({ id: ctx.targetSlug, title: ctx.title, artist: ctx.artist, key: ctx.key, content: '' });
            } else {
                navigateTo('add-song');
            }
        },
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
        // Navigation elements
        navBar,
        navPrevBtn,
        navNextBtn,
        navPosition,
        navListName
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
        onRequestDelete: handleRequestDeleteSong,
        onRequestSuppress: handleRequestSuppressSong,
        onRequestMerge: handleRequestMergeSong,
        isAdmin: () => isAdminUser,
        isTrusted: () => isTrustedFlag,
        // Promote is open to anyone signed in, so it reads login rather than
        // the trusted flag. isTrusted stays — the admin actions still use it.
        isLoggedIn: () => !!SupabaseAuth?.isLoggedIn?.(),
        onPromote: handlePromoteSong,
        isPromoted: (id) => promotedIds.has(id),
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
            pushHistoryState(dungeonMode ? 'dungeon' : 'search', { query }, true);
        }, 500);
    });

    initTagDropdown({
        searchInput,
        tagDropdownBtn,
        tagDropdownContent,
        search,
        parseSearchQuery
    });

    // initEditor runs when the editor first loads (loadEditor above).


    // Setup event listeners

    // Home buttons - go home
    const goHome = () => {
        setDungeonMode(false);
        searchInput.value = '';
        showView('home');
        pushHistoryState('home');
    };

    logoLink?.addEventListener('click', (e) => {
        e.preventDefault();
        goHome();
    });

    editorBackBtn?.addEventListener('click', () => navigateTo('search'));

    // Landing facet chips: tags.js already toggles the tag in the main
    // search box and runs the search — we just carry the user to it
    document.getElementById('landing-facets')?.addEventListener('click', (e) => {
        if (!e.target.closest('.facet-chip[data-facet-tag]')) return;
        showView('search');
        pushHistoryState('search', { query: searchInput?.value || '' });
    });

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

    // My Submissions link in account modal (#227 / #207)
    const mySubmissionsBtn = document.getElementById('account-my-submissions-btn');
    mySubmissionsBtn?.addEventListener('click', () => {
        closeAccountModal();
        showView('my-submissions');
        pushHistoryState('my-submissions');
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

    // List header gets the full Export menu (print + downloads), not just print
    mountListExportPill();

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

        // Edit button (in title row — a content action lives with the
        // content; the old Focus button died with focus mode)
        if (target.closest('#edit-song-btn')) {
            handleEditAction();
            return;
        }
    });

    // History navigation.
    //
    // One back/forward (or `location.hash = …`) step fires `popstate` AND
    // `hashchange` whenever the fragment differs, popstate first. Routing
    // both ran `openWork` twice per step, so the song page was built and
    // drawn twice. The hash is the more trustworthy of the two (see the
    // hashchange handler), so a popstate does not route immediately: it
    // parks its work for one task, and a hashchange arriving in that window
    // takes over and cancels it. With no hashchange (same fragment, only the
    // state differs) the parked popstate runs as before. `handledHref` covers
    // a browser that dispatches the two in separate tasks the other way
    // round: a hashchange for the URL a popstate already routed is an echo.
    let parkedPopstate = null;
    let handled = { href: null, at: 0 };
    const markHandled = () => { handled = { href: window.location.href, at: performance.now() }; };

    window.addEventListener('popstate', (e) => {
        if (parkedPopstate) clearTimeout(parkedPopstate);
        const state = e.state;
        parkedPopstate = setTimeout(() => {
            parkedPopstate = null;
            markHandled();
            handleHistoryNavigation(state);
        }, 0);
    });

    // Handle hash changes that don't trigger popstate (e.g. manual URL edits)
    window.addEventListener('hashchange', () => {
        if (parkedPopstate) {
            clearTimeout(parkedPopstate);
            parkedPopstate = null;
        } else if (handled.href === window.location.href
                   && performance.now() - handled.at < 100) {
            return;   // the tail of a traversal popstate already routed
        }
        markHandled();
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
    let authReturnHandled = false;
    pruneReturnRecord();
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
            // What the editor promises ("updates in place" vs "your own
            // arrangement") depends on who is signed in
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
                refreshEditorOwnership();
            }
            // This page load IS the return from the Google redirect: go back
            // to what the user was doing (once — later events must not replay it)
            if (user && AUTH_REDIRECT === 'signed-in' && !authReturnHandled) {
                authReturnHandled = true;
                resumeAfterAuthRedirect({ signedIn: true });
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

    // PWA: service worker (offline + update nudge), install affordance, and
    // .tef / .otf.json file opening — both from the OS (installed app) and
    // from a drag onto the window. All of it no-ops where the APIs are
    // missing, so it is safe on every browser and in the test runners.
    initPWA({ onInstallAvailable: () => seedOverflowBase() });

    // The old single-slot localStorage draft becomes draft #1 of the new
    // IndexedDB bucket. Runs once, never blocks boot, never throws.
    migrateLegacyDraft({ store: getDraftStore() }).catch(() => {});

    // Load the index
    loadIndex();

    // Came back from the redirect WITHOUT signing in (consent refused, error):
    // the work is still worth restoring
    if (AUTH_REDIRECT === 'error') resumeAfterAuthRedirect({ signedIn: false });
}

// Start the app
init();

// Exit fullscreen button
if (exitFullscreenBtn) {
    // "List" button in the list nav bar: return to the list
    exitFullscreenBtn.addEventListener('click', () => history.back());
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
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
