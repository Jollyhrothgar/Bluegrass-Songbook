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

// Save view preferences to localStorage
function saveViewPrefs() {
    const prefs = {
        compactMode,
        nashvilleMode,
        twoColumnMode,
        chordDisplayMode,
        showSectionLabels,
        fontSizeLevel
    };
    localStorage.setItem('songbook-view-prefs', JSON.stringify(prefs));
}

// Load view preferences from localStorage
export function loadViewPrefs() {
    try {
        const saved = localStorage.getItem('songbook-view-prefs');
        if (saved) {
            const prefs = JSON.parse(saved);
            if (prefs.compactMode !== undefined) compactMode = prefs.compactMode;
            if (prefs.nashvilleMode !== undefined) nashvilleMode = prefs.nashvilleMode;
            if (prefs.twoColumnMode !== undefined) twoColumnMode = prefs.twoColumnMode;
            if (prefs.chordDisplayMode !== undefined) chordDisplayMode = prefs.chordDisplayMode;
            if (prefs.showSectionLabels !== undefined) showSectionLabels = prefs.showSectionLabels;
            if (prefs.fontSizeLevel !== undefined) fontSizeLevel = prefs.fontSizeLevel;
        }
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

// Font size multipliers
export const FONT_SIZES = {
    '-2': 0.7,
    '-1': 0.85,
    '0': 1,
    '1': 1.2,
    '2': 1.5
};

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
export let abcScale = 1.0;                 // Size scale (0.7 - 1.5)
export let abcSynth = null;                // Persistent synth instance
export let abcTimingCallbacks = null;      // Persistent timing callbacks
export let abcIsPlaying = false;           // Playback state for toggle button

export function setShowAbcNotation(value) { showAbcNotation = value; }
export function setAbcjsRendered(value) { abcjsRendered = value; }
export function setCurrentAbcContent(value) { currentAbcContent = value; }
export function setAbcTempoBpm(value) { abcTempoBpm = value; }
export function setAbcTranspose(value) { abcTranspose = value; }
export function setAbcScale(value) { abcScale = value; }
export function setAbcSynth(value) { abcSynth = value; }
export function setAbcTimingCallbacks(value) { abcTimingCallbacks = value; }
export function setAbcIsPlaying(value) { abcIsPlaying = value; }

// ============================================
// KEY/TRANSPOSITION STATE
// ============================================

export let currentDetectedKey = null;
export let originalDetectedKey = null;
export let originalDetectedMode = null;

export function setCurrentDetectedKey(key) { currentDetectedKey = key; notifyChange('currentDetectedKey'); }
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

export function setUserLists(lists) { userLists = lists; }
export function setViewingListId(id) { viewingListId = id; notifyChange('viewingListId'); }
export function setViewingPublicList(data) { viewingPublicList = data; notifyChange('viewingPublicList'); }

// ============================================
// HISTORY STATE
// ============================================

export let historyInitialized = false;

export function setHistoryInitialized(value) { historyInitialized = value; }

// ============================================
// FULLSCREEN / MUSICIAN MODE
// ============================================

export let fullscreenMode = false;
export let listContext = null;  // { listId, songs, currentIndex } - for prev/next navigation

export function setFullscreenMode(value) { fullscreenMode = value; }
export function setListContext(context) { listContext = context; }

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
export let sidebarOpen = false;
export let activeModal = null;  // 'account' | 'lists' | 'version' | 'correction' | 'contact' | null
export let currentSearchQuery = '';

export function setCurrentView(value) { currentView = value; notifyChange('currentView'); }
export function setSidebarOpen(value) { sidebarOpen = value; notifyChange('sidebarOpen'); }
export function setActiveModal(value) { activeModal = value; notifyChange('activeModal'); }
export function setCurrentSearchQuery(value) { currentSearchQuery = value; notifyChange('currentSearchQuery'); }

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

    // Display options
    compactMode: () => compactMode,
    nashvilleMode: () => nashvilleMode,
    twoColumnMode: () => twoColumnMode,
    chordDisplayMode: () => chordDisplayMode,
    showSectionLabels: () => showSectionLabels,
    showChordProSource: () => showChordProSource,
    fontSizeLevel: () => fontSizeLevel,

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

    // History
    historyInitialized: () => historyInitialized,

    // Fullscreen/musician mode
    fullscreenMode: () => fullscreenMode,
    listContext: () => listContext,

    // Editor
    editMode: () => editMode,
    editingSongId: () => editingSongId,
    editorNashvilleMode: () => editorNashvilleMode,

    // UI view state
    currentView: () => currentView,
    sidebarOpen: () => sidebarOpen,
    activeModal: () => activeModal,
    currentSearchQuery: () => currentSearchQuery,
};

const stateSetters = {
    // Song data
    allSongs: setAllSongs,
    songGroups: setSongGroups,
    currentSong: setCurrentSong,
    currentChordpro: setCurrentChordpro,

    // Display options
    compactMode: setCompactMode,
    nashvilleMode: setNashvilleMode,
    twoColumnMode: setTwoColumnMode,
    chordDisplayMode: setChordDisplayMode,
    showSectionLabels: setShowSectionLabels,
    showChordProSource: setShowChordProSource,
    fontSizeLevel: setFontSizeLevel,

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

    // History
    historyInitialized: setHistoryInitialized,

    // Fullscreen/musician mode
    fullscreenMode: setFullscreenMode,
    listContext: setListContext,

    // Editor
    editMode: setEditMode,
    editingSongId: setEditingSongId,
    editorNashvilleMode: setEditorNashvilleMode,

    // UI view state
    currentView: setCurrentView,
    sidebarOpen: setSidebarOpen,
    activeModal: setActiveModal,
    currentSearchQuery: setCurrentSearchQuery,
};
