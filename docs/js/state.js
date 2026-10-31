// Shared state for Bluegrass Songbook
// All state is exported as mutable objects/primitives wrapped in getter/setter functions
// This allows modules to share state while avoiding circular dependency issues

// ============================================
// REACTIVE STATE SYSTEM (Pub/Sub)
// ============================================
//
// New pattern: subscribe() to state changes, setState() to update
// Old pattern: individual setters still work for backward compatibility

const subscribers = new Map();  // stateKey -> Set of callbacks
let renderScheduled = false;
let pendingChanges = new Set();

/**
 * Subscribe to state changes
 * @param {string} stateKey - Key to watch (or '*' for all changes)
 * @param {Function} callback - Called with (newValue, key) on change
 * @returns {Function} Unsubscribe function
 */
export function subscribe(stateKey, callback) {
    if (!subscribers.has(stateKey)) {
        subscribers.set(stateKey, new Set());
    }
    subscribers.get(stateKey).add(callback);
    return () => subscribers.get(stateKey).delete(callback);
}

/**
 * Update multiple state values at once, triggering subscribers
 * @param {Object} updates - Key/value pairs to update
 */
export function setState(updates) {
    for (const [key, value] of Object.entries(updates)) {
        // Use the existing state variables
        if (stateSetters[key]) {
            const currentValue = stateGetters[key]?.();
            if (currentValue !== value) {
                stateSetters[key](value);
                pendingChanges.add(key);
            }
        }
    }
    if (pendingChanges.size > 0) {
        scheduleRender();
    }
}

function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;

    requestAnimationFrame(() => {
        const changes = new Set(pendingChanges);
        pendingChanges.clear();
        renderScheduled = false;

        // Notify specific subscribers
        for (const key of changes) {
            const callbacks = subscribers.get(key);
            if (callbacks) {
                const value = stateGetters[key]?.();
                callbacks.forEach(cb => cb(value, key));
            }
        }

        // Notify wildcard subscribers
        const wildcardCallbacks = subscribers.get('*');
        if (wildcardCallbacks) {
            wildcardCallbacks.forEach(cb => cb(getState(), changes));
        }
    });
}

/**
 * Get current state value(s)
 * @param {string} [key] - Optional key to get specific value
 * @returns {*} State value or full state object
 */
export function getState(key) {
    if (key) {
        return stateGetters[key]?.();
    }
    // Return snapshot of all tracked state
    const snapshot = {};
    for (const k of Object.keys(stateGetters)) {
        snapshot[k] = stateGetters[k]();
    }
    return snapshot;
}

// Notify subscribers when using legacy setters
function notifyChange(key) {
    pendingChanges.add(key);
    scheduleRender();
}

// ============================================
// SONG DATA
// ============================================

export let allSongs = [];
export let songGroups = {};  // Map of group_id -> array of songs

export function setAllSongs(songs) {
    allSongs = songs;
    notifyChange('allSongs');
}

// ============================================
// SONG URLS
// ============================================
// A song's address is its path: /songs/{song}/ or /songs/{song}/{version}/
// (the row's `path`, from build_works_index.apply_songs). Everything else —
// search, lists, a song's parts and editor modes — is a hash route on the
// root, written absolute ('/#…') so it never inherits a song's path.

export const SONG_PATH = /^\/songs\/[^/]+\/(?:[^/]+\/)?$/;

/** The tab editor's front door (G15c): /tab-editor/, with or without the slash. */
export const TAB_EDITOR_PATH = /^\/tab-editor\/?$/;

/**
 * The URL to put in the address bar when `view` is showing at `loc`, or null
 * to leave it. Only a song shows at a song's path and only the front door at
 * /tab-editor/; every other view belongs to the root, so a hash route set on
 * either path (`/tab-editor/#search`) becomes `/#search`.
 *
 * `entryView` is the history entry's own `state.view`. An entry that belongs
 * to its path's view is never stray, even while `view` still names the page
 * being left: Back then Forward onto a song lands before the song's route runs.
 */
export function normalizedHref(view, { pathname, hash = '' }, entryView = null) {
    const owns = (v) => view === v || entryView === v;
    const stray = (!owns('song') && SONG_PATH.test(pathname))
        || (!owns('tab-editor') && TAB_EDITOR_PATH.test(pathname));
    return stray ? `/${hash}` : null;
}

/** The URL to show for a work: its song path, or `/#work/{id}{suffix}`. */
export function songHref(workId, suffix = '') {
    const path = !suffix && allSongs.find(s => s.id === workId)?.path;
    return path ? `/${path}` : `/#work/${workId}${suffix}`;
}

/** The work whose song path is `pathname`, if the loaded corpus has it. */
export function songIdForPath(pathname) {
    const path = pathname.replace(/^\//, '');
    return allSongs.find(s => s.path === path)?.id ?? null;
}

/** Path + hash, comparable with songHref() and other absolute hrefs. */
export function currentHref() {
    return window.location.pathname + window.location.hash;
}

// True when loadIndex()'s fetch/parse of data/index.jsonl threw, leaving
// allSongs empty. Consumers (search, add-song picker, review-queue merge
// dialog) read this to tell "corpus failed to load" apart from a genuine
// no-match, and the shell banner reads it to show/hide the global notice.
export let corpusLoadFailed = false;

export function setCorpusLoadFailed(value) {
    corpusLoadFailed = value;
    notifyChange('corpusLoadFailed');
}

export function setSongGroups(groups) {
    songGroups = groups;
}

// ============================================
// CURRENT SONG STATE
// ============================================

export let currentSong = null;
export let currentChordpro = null;

export function setCurrentSong(song) {
    currentSong = song;
}

export function setCurrentChordpro(chordpro) {
    currentChordpro = chordpro;
}

// ============================================
// DISPLAY OPTIONS
// ============================================

export let compactMode = false;
export let nashvilleMode = false;
export let twoColumnMode = false;
export let chordDisplayMode = 'all';  // 'all' | 'first' | 'none'
export let seenChordPatterns = new Set();
export let showSectionLabels = true;
export let showChordProSource = false;
export let fontSizeLevel = 0;  // -2 to +2
// The chord chart's layout (G19b, Display ▸ Chart) and the song page's
// remembered view choices
export const CHART_CELLS = [2, 4, 6, 8];   // cells per row
export let chartCells = 4;
export let chartBars = 1;                  // cells a printed bar holds: 1 or 2
export let chartOrder = 'once';            // 'once' (each section once) | 'sung' (unrolled in the sung order)
export let chartBeside = true;             // wide screens: the chart is a column beside the lyrics
export let autoHideControls = false;       // both docks hide while scrolling down

// Save view preferences to localStorage
function saveViewPrefs() {
    const prefs = {
        compactMode,
        nashvilleMode,
        twoColumnMode,
        chordDisplayMode,
        showSectionLabels,
        fontSizeLevel,
        chartCells,
        chartBars,
        chartOrder,
        chartBeside,
        autoHideControls
    };
    localStorage.setItem('songbook-view-prefs', JSON.stringify(prefs));
}

// Load view preferences from localStorage
export function loadViewPrefs() {
    try {
        const saved = localStorage.getItem('songbook-view-prefs');
        const prefs = saved ? JSON.parse(saved) : {};
        if (prefs.compactMode !== undefined) compactMode = prefs.compactMode;
        if (prefs.nashvilleMode !== undefined) nashvilleMode = prefs.nashvilleMode;
        if (prefs.twoColumnMode !== undefined) twoColumnMode = prefs.twoColumnMode;
        if (prefs.chordDisplayMode !== undefined) chordDisplayMode = prefs.chordDisplayMode;
        if (prefs.showSectionLabels !== undefined) showSectionLabels = prefs.showSectionLabels;
        if (prefs.fontSizeLevel !== undefined) fontSizeLevel = prefs.fontSizeLevel;
        if (CHART_CELLS.includes(prefs.chartCells)) chartCells = prefs.chartCells;
        if (prefs.chartBars === 1 || prefs.chartBars === 2) chartBars = prefs.chartBars;
        else if (localStorage.getItem('bgb-chart-bars') === '2') chartBars = 2;   // G18b2 kept it under its own key
        if (prefs.chartOrder === 'once' || prefs.chartOrder === 'sung') chartOrder = prefs.chartOrder;
        if (typeof prefs.chartBeside === 'boolean') chartBeside = prefs.chartBeside;
        if (typeof prefs.autoHideControls === 'boolean') autoHideControls = prefs.autoHideControls;
        const abc = parseFloat(localStorage.getItem(ABC_SCALE_KEY));
        if (abc >= ABC_SCALE_MIN && abc <= ABC_SCALE_MAX) abcScale = abc;
    } catch (e) {
        console.error('Failed to load view preferences:', e);
    }
}

export function setCompactMode(value) { compactMode = value; saveViewPrefs(); notifyChange('compactMode'); }
export function setNashvilleMode(value) { nashvilleMode = value; saveViewPrefs(); notifyChange('nashvilleMode'); }
export function setTwoColumnMode(value) { twoColumnMode = value; saveViewPrefs(); notifyChange('twoColumnMode'); }
export function setChordDisplayMode(value) { chordDisplayMode = value; saveViewPrefs(); notifyChange('chordDisplayMode'); }
export function clearSeenChordPatterns() { seenChordPatterns.clear(); }
export function addSeenChordPattern(pattern) { seenChordPatterns.add(pattern); }
export function setShowSectionLabels(value) { showSectionLabels = value; saveViewPrefs(); notifyChange('showSectionLabels'); }
export function setShowChordProSource(value) { showChordProSource = value; notifyChange('showChordProSource'); }
export function setFontSizeLevel(value) { fontSizeLevel = value; saveViewPrefs(); notifyChange('fontSizeLevel'); }
export function setChartCells(value) { chartCells = value; saveViewPrefs(); notifyChange('chartCells'); }
export function setChartBars(value) { chartBars = value === 2 ? 2 : 1; saveViewPrefs(); notifyChange('chartBars'); }
export function setChartOrder(value) { chartOrder = value === 'sung' ? 'sung' : 'once'; saveViewPrefs(); notifyChange('chartOrder'); }
/** Returns whether it changed; the caller redraws, so nothing subscribes to it. */
export function setChartBeside(value) {
    if (chartBeside === !!value) return false;
    chartBeside = !!value; saveViewPrefs();
    return true;
}
export function setAutoHideControls(value) { autoHideControls = !!value; saveViewPrefs(); notifyChange('autoHideControls'); }

// Font size multipliers (smaller increments, wider range)
export const FONT_SIZES = {
    '-5': 0.5,
    '-4': 0.6,
    '-3': 0.7,
    '-2': 0.8,
    '-1': 0.9,
    '0': 1,
    '1': 1.1,
    '2': 1.25,
    '3': 1.4,
    '4': 1.6,
    '5': 1.8,
    '6': 2.0
};

// The list print view is a separate document with its own stylesheet, so it
// can't inherit the em multiplier above — it sizes song text in px instead.
// These translate one scale into the other so the two can't drift apart.
export const PRINT_BASE_FONT_PX = 14;   // what a 1.0 multiplier means in print
export const PRINT_FONT_PX_MIN = 8;     // bounds match the print view's +/- input
export const PRINT_FONT_PX_MAX = 32;

/** Font size in px for the print view, for a given app font size level. */
export function printFontPxForLevel(level) {
    const px = PRINT_BASE_FONT_PX * (FONT_SIZES[level] ?? 1);
    return Math.max(PRINT_FONT_PX_MIN, Math.min(PRINT_FONT_PX_MAX, Math.round(px)));
}

// ============================================
// TABLATURE STATE
// ============================================

export let activePartTab = 'lead-sheet';     // 'lead-sheet' | 'tablature'
export let loadedTablature = null;           // Cached OTF data for current song
export let tablaturePlayer = null;           // TabPlayer instance

export function setActivePartTab(value) { activePartTab = value; notifyChange('activePartTab'); }
export function setLoadedTablature(value) { loadedTablature = value; }
export function setTablaturePlayer(value) { tablaturePlayer = value; }

// ============================================
// ABC NOTATION STATE
// ============================================

export let showAbcNotation = true;         // Show ABC notation when available
export let abcjsRendered = null;           // Reference to ABCJS rendered object
export let currentAbcContent = null;       // Current ABC content for re-rendering
export let abcTempoBpm = 120;              // Playback tempo in BPM (60 - 240)
export let abcTranspose = 0;               // Semitones to transpose (-6 to +6)
export let abcScale = 1.0;                 // Size scale (0.7 - 1.5), remembered separately from the lyric text size
export const ABC_SCALE_KEY = 'bgb-abc-scale';
export const ABC_SCALE_MIN = 0.7;
export const ABC_SCALE_MAX = 1.5;
export let abcSynth = null;                // Persistent synth instance
export let abcTimingCallbacks = null;      // Persistent timing callbacks
export let abcIsPlaying = false;           // Playback state for toggle button
export let abcPlaybackSession = 0;         // Session counter to detect cancelled playback

export function setShowAbcNotation(value) { showAbcNotation = value; }
export function setAbcjsRendered(value) { abcjsRendered = value; }
export function setCurrentAbcContent(value) { currentAbcContent = value; }
export function setAbcTempoBpm(value) { abcTempoBpm = value; }
export function setAbcTranspose(value) { abcTranspose = value; }
export function setAbcScale(value) {
    abcScale = value;
    try { localStorage.setItem(ABC_SCALE_KEY, String(value)); } catch { /* private mode */ }
}
export function setAbcSynth(value) { abcSynth = value; }
export function setAbcTimingCallbacks(value) { abcTimingCallbacks = value; }
export function setAbcIsPlaying(value) { abcIsPlaying = value; }
export function incrementAbcPlaybackSession() { return ++abcPlaybackSession; }

// ============================================
// KEY/TRANSPOSITION STATE
// ============================================

export let currentDetectedKey = null;
export let originalDetectedKey = null;
export let originalDetectedMode = null;

/**
 * Writing the key it already holds fires nothing (same contract as
 * `setCurrentView` / `setDungeonMode`). The song page re-renders its lead
 * sheet on every `currentDetectedKey` notification, and `initKeyState` writes
 * the detected key on every render — so an unconditional notify made each
 * open draw the chart twice. Nothing relies on an explicit re-notification
 * with an unchanged key: a caller that wants a redraw calls the renderer.
 */
export function setCurrentDetectedKey(key) {
    if (currentDetectedKey === key) return;
    currentDetectedKey = key;
    notifyChange('currentDetectedKey');
}
export function setOriginalDetectedKey(key) { originalDetectedKey = key; }
export function setOriginalDetectedMode(mode) { originalDetectedMode = mode; }

// ============================================
// AUTH/SYNC STATE
// ============================================

export let isCloudSyncEnabled = false;
export let syncInProgress = false;

export function setCloudSyncEnabled(value) { isCloudSyncEnabled = value; }
export function setSyncInProgress(value) { syncInProgress = value; }

// ============================================
// LISTS (includes Favorites as a special list)
// ============================================

// Favorites is a special list with this fixed ID
export const FAVORITES_LIST_ID = 'favorites';

export let userLists = [];
export let viewingListId = null;  // ID of list being viewed (or null)
export let viewingPublicList = null;  // { list, songs, isOwner } when viewing shared list
export let selectedSongIds = new Set();  // Selected song IDs for batch operations
export let focusedListId = null;  // ID of list to auto-expand in Manage Lists

export function setUserLists(lists) { userLists = lists; }
export function setViewingListId(id) { viewingListId = id; notifyChange('viewingListId'); }
export function setViewingPublicList(data) { viewingPublicList = data; notifyChange('viewingPublicList'); }
export function setSelectedSongIds(ids) { selectedSongIds = ids; notifyChange('selectedSongIds'); }
export function setFocusedListId(id) { focusedListId = id; notifyChange('focusedListId'); }
export function toggleSongSelection(songId) {
    if (selectedSongIds.has(songId)) {
        selectedSongIds.delete(songId);
    } else {
        selectedSongIds.add(songId);
    }
    notifyChange('selectedSongIds');
}
export function clearSelectedSongs() { selectedSongIds.clear(); notifyChange('selectedSongIds'); }
export function selectAllSongs(songIds) { selectedSongIds = new Set(songIds); notifyChange('selectedSongIds'); }

// ============================================
// HISTORY STATE
// ============================================

// False until the boot sequence has finished loading the corpus and routed
// the URL the page was opened with. Everything after that point is ordinary
// navigation.
export let historyInitialized = false;

export function setHistoryInitialized(value) { historyInitialized = value; }

// The boot sequence ends by routing the URL the page loaded with (a deep
// link, or the home view). That tail fires a full network round-trip after
// the page is already interactive, so a user on a slow connection can
// navigate somewhere else first — and the tail would then yank them back to
// the boot URL.
//
// Any navigation pushed during that window claims the boot route: the user
// has said where they want to be, so the tail stands down and leaves the
// view alone. A page that boots untouched never claims it, so genuine deep
// links still land.
export let bootRouteClaimed = false;

export function setBootRouteClaimed(value) { bootRouteClaimed = value; }

/** True while the boot tail is still allowed to route the URL it loaded with. */
export function canRouteBootUrl() { return !bootRouteClaimed; }

// ============================================
// FULLSCREEN / MUSICIAN MODE
// ============================================

export let listContext = null;  // { listId, songs, currentIndex } - for prev/next navigation

export function setListContext(context) { listContext = context; }

// ============================================
// WORK REDIRECTS (merged/renamed works)
// ============================================

export let workRedirects = {};  // Map of old slug -> canonical slug

export function setWorkRedirects(redirects) { workRedirects = redirects; }

/**
 * Resolve a work ID through redirects. Returns canonical ID.
 */
export function resolveWorkId(workId) {
    return workRedirects[workId] || workId;
}

// ============================================
// BOUNTY STATE
// ============================================

export let bountyIndex = {};  // Map of work_id -> [bounty objects]

export function setBountyIndex(index) { bountyIndex = index; }

/**
 * Get open bounties for a specific work.
 * @param {string} workId - The work slug
 * @returns {Array} Array of bounty objects for this work
 */
export function getBountiesForWork(workId) {
    return bountyIndex[workId] || [];
}

/**
 * Get total count of works with open bounties.
 */
export function getBountyWorkCount() {
    return Object.keys(bountyIndex).length;
}

// ============================================
// EDITOR STATE
// ============================================

export let editMode = false;
export let editingSongId = null;
export let editorNashvilleMode = false;

export function setEditMode(value) { editMode = value; }
export function setEditingSongId(id) { editingSongId = id; }
export function setEditorNashvilleMode(value) { editorNashvilleMode = value; }

// ============================================
// UI VIEW STATE (new reactive pattern)
// ============================================

export let currentView = 'home';  // 'home' | 'search' | 'song' | 'add-song' | 'list'
export let activeModal = null;  // 'account' | 'lists' | null
export let currentSearchQuery = '';

// Dungeon mode: search scope flips to archived-only rows (indexed === false)
export let dungeonMode = false;

// "Include the dungeon": the reader's standing choice to search the archive
// alongside the canon. Off by default, remembered in localStorage. Dungeon
// mode (archive only) overrides it while it's on.
const INCLUDE_DUNGEON_KEY = 'songbook-include-dungeon';
export let includeDungeon = (() => {
    try { return globalThis.localStorage?.getItem(INCLUDE_DUNGEON_KEY) === '1'; }
    catch { return false; }
})();

/**
 * The view changed — which is NOT the same as "someone said the view".
 *
 * Writing the value it already holds fires nothing, matching `setDungeonMode`
 * below and `setState` above, and matching what main.js already documents
 * about itself ("showView('search') is a no-op when the view is already
 * 'search', so the subscriber can't be trusted to fire"). Until this guard
 * existed the code said that and the setter did the opposite.
 *
 * It is not tidiness. Subscribers run on a `requestAnimationFrame` (see
 * `scheduleRender`), so every redundant write buys a real callback at a later
 * frame boundary — and the `currentView` subscriber in main.js does imperative
 * teardown work, not just painting. A tab route is dispatched TWICE for one
 * navigation (popstate and hashchange both reach `handleDeepLink`), so
 * `openNewTabPage` runs twice; without this guard the second run queued a
 * second teardown that could land after the first run's editor had mounted.
 * Any consumer that really wants the teardown calls `teardownTablatureView()`
 * itself — `openWork` and `openNewTabPage` both do, synchronously, before
 * they build.
 */
export function setCurrentView(value) {
    if (currentView === value) return;
    currentView = value;
    notifyChange('currentView');
}
export function setActiveModal(value) { activeModal = value; notifyChange('activeModal'); }
export function setCurrentSearchQuery(value) { currentSearchQuery = value; notifyChange('currentSearchQuery'); }
export function setDungeonMode(value) {
    if (dungeonMode === value) return;
    dungeonMode = value;
    notifyChange('dungeonMode');
}
export function setIncludeDungeon(value) {
    value = !!value;
    if (includeDungeon === value) return;
    includeDungeon = value;
    try {
        if (value) localStorage.setItem(INCLUDE_DUNGEON_KEY, '1');
        else localStorage.removeItem(INCLUDE_DUNGEON_KEY);
    } catch { /* private mode: the choice lasts the session */ }
    notifyChange('includeDungeon');
}

// ============================================
// CONSTANTS
// ============================================

export const GITHUB_REPO = 'Jollyhrothgar/Bluegrass-Songbook';

// Tag categories for display
export const TAG_CATEGORIES = {
    'Genre': ['Bluegrass', 'ClassicCountry', 'OldTime', 'Gospel', 'Folk', 'HonkyTonk', 'Outlaw', 'Rockabilly', 'WesternSwing'],
    'Vibe': ['JamFriendly', 'Modal', 'Jazzy'],
    'Structure': ['Instrumental', 'Waltz']
};

// ============================================
// STATE ACCESSOR MAPS (for reactive system)
// ============================================
// These maps enable setState() and getState() to work with named keys

const stateGetters = {
    // Song data
    allSongs: () => allSongs,
    songGroups: () => songGroups,
    currentSong: () => currentSong,
    currentChordpro: () => currentChordpro,
    corpusLoadFailed: () => corpusLoadFailed,

    // Display options
    compactMode: () => compactMode,
    nashvilleMode: () => nashvilleMode,
    twoColumnMode: () => twoColumnMode,
    chordDisplayMode: () => chordDisplayMode,
    showSectionLabels: () => showSectionLabels,
    showChordProSource: () => showChordProSource,
    fontSizeLevel: () => fontSizeLevel,
    chartCells: () => chartCells,
    chartBars: () => chartBars,
    chartOrder: () => chartOrder,
    chartBeside: () => chartBeside,
    autoHideControls: () => autoHideControls,

    // Tablature
    activePartTab: () => activePartTab,
    loadedTablature: () => loadedTablature,
    tablaturePlayer: () => tablaturePlayer,

    // ABC notation
    showAbcNotation: () => showAbcNotation,
    abcjsRendered: () => abcjsRendered,
    currentAbcContent: () => currentAbcContent,
    abcTempoBpm: () => abcTempoBpm,
    abcTranspose: () => abcTranspose,
    abcScale: () => abcScale,
    abcSynth: () => abcSynth,
    abcTimingCallbacks: () => abcTimingCallbacks,
    abcIsPlaying: () => abcIsPlaying,
    abcPlaybackSession: () => abcPlaybackSession,

    // Key/transposition
    currentDetectedKey: () => currentDetectedKey,
    originalDetectedKey: () => originalDetectedKey,
    originalDetectedMode: () => originalDetectedMode,

    // Auth/sync
    isCloudSyncEnabled: () => isCloudSyncEnabled,
    syncInProgress: () => syncInProgress,

    // Lists
    userLists: () => userLists,
    viewingListId: () => viewingListId,
    viewingPublicList: () => viewingPublicList,
    selectedSongIds: () => selectedSongIds,
    focusedListId: () => focusedListId,

    // History
    historyInitialized: () => historyInitialized,
    bootRouteClaimed: () => bootRouteClaimed,

    // Fullscreen/musician mode
    listContext: () => listContext,

    // Editor
    editMode: () => editMode,
    editingSongId: () => editingSongId,
    editorNashvilleMode: () => editorNashvilleMode,

    // UI view state
    currentView: () => currentView,
    activeModal: () => activeModal,
    currentSearchQuery: () => currentSearchQuery,
    dungeonMode: () => dungeonMode,
    includeDungeon: () => includeDungeon,
};

const stateSetters = {
    // Song data
    allSongs: setAllSongs,
    songGroups: setSongGroups,
    currentSong: setCurrentSong,
    currentChordpro: setCurrentChordpro,
    corpusLoadFailed: setCorpusLoadFailed,

    // Display options
    compactMode: setCompactMode,
    nashvilleMode: setNashvilleMode,
    twoColumnMode: setTwoColumnMode,
    chordDisplayMode: setChordDisplayMode,
    showSectionLabels: setShowSectionLabels,
    showChordProSource: setShowChordProSource,
    fontSizeLevel: setFontSizeLevel,
    chartCells: setChartCells,
    chartBars: setChartBars,
    chartOrder: setChartOrder,
    chartBeside: setChartBeside,
    autoHideControls: setAutoHideControls,

    // Tablature
    activePartTab: setActivePartTab,
    loadedTablature: setLoadedTablature,
    tablaturePlayer: setTablaturePlayer,

    // ABC notation
    showAbcNotation: setShowAbcNotation,
    abcjsRendered: setAbcjsRendered,
    currentAbcContent: setCurrentAbcContent,
    abcTempoBpm: setAbcTempoBpm,
    abcTranspose: setAbcTranspose,
    abcScale: setAbcScale,
    abcSynth: setAbcSynth,
    abcTimingCallbacks: setAbcTimingCallbacks,
    abcIsPlaying: setAbcIsPlaying,
    abcPlaybackSession: incrementAbcPlaybackSession,

    // Key/transposition
    currentDetectedKey: setCurrentDetectedKey,
    originalDetectedKey: setOriginalDetectedKey,
    originalDetectedMode: setOriginalDetectedMode,

    // Auth/sync
    isCloudSyncEnabled: setCloudSyncEnabled,
    syncInProgress: setSyncInProgress,

    // Lists
    userLists: setUserLists,
    viewingListId: setViewingListId,
    viewingPublicList: setViewingPublicList,
    selectedSongIds: setSelectedSongIds,
    focusedListId: setFocusedListId,

    // History
    historyInitialized: setHistoryInitialized,
    bootRouteClaimed: setBootRouteClaimed,

    // Fullscreen/musician mode
    listContext: setListContext,

    // Editor
    editMode: setEditMode,
    editingSongId: setEditingSongId,
    editorNashvilleMode: setEditorNashvilleMode,

    // UI view state
    currentView: setCurrentView,
    dungeonMode: setDungeonMode,
    includeDungeon: setIncludeDungeon,
    activeModal: setActiveModal,
    currentSearchQuery: setCurrentSearchQuery,
};
