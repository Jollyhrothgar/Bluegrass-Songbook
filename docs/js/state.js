// Shared state for Bluegrass Songbook
// All state is exported as mutable objects/primitives wrapped in getter/setter functions
// This allows modules to share state while avoiding circular dependency issues

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
export let showingFavorites = false;
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

export function setCompactMode(value) { compactMode = value; saveViewPrefs(); }
export function setShowingFavorites(value) { showingFavorites = value; }
export function setNashvilleMode(value) { nashvilleMode = value; saveViewPrefs(); }
export function setTwoColumnMode(value) { twoColumnMode = value; saveViewPrefs(); }
export function setChordDisplayMode(value) { chordDisplayMode = value; saveViewPrefs(); }
export function clearSeenChordPatterns() { seenChordPatterns.clear(); }
export function addSeenChordPattern(pattern) { seenChordPatterns.add(pattern); }
export function setShowSectionLabels(value) { showSectionLabels = value; saveViewPrefs(); }
export function setShowChordProSource(value) { showChordProSource = value; }
export function setFontSizeLevel(value) { fontSizeLevel = value; saveViewPrefs(); }

// Font size multipliers
export const FONT_SIZES = {
    '-2': 0.7,
    '-1': 0.85,
    '0': 1,
    '1': 1.2,
    '2': 1.5
};

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

export function setCurrentDetectedKey(key) { currentDetectedKey = key; }
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
// FAVORITES AND LISTS
// ============================================

// Favorites is an ordered array (not a Set) so users can reorder
export let favorites = [];
export let userLists = [];

export function setFavorites(favs) {
    // Convert Set to Array if needed, or use as-is if already Array
    favorites = favs instanceof Set ? [...favs] : Array.isArray(favs) ? favs : [];
}

export function addFavorite(songId) {
    if (!favorites.includes(songId)) {
        favorites.push(songId);
    }
}

export function removeFavorite(songId) {
    const index = favorites.indexOf(songId);
    if (index !== -1) {
        favorites.splice(index, 1);
    }
}

export function hasFavorite(songId) {
    return favorites.includes(songId);
}

export function reorderFavorite(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= favorites.length) return false;
    if (toIndex < 0 || toIndex >= favorites.length) return false;
    if (fromIndex === toIndex) return false;

    const [songId] = favorites.splice(fromIndex, 1);
    favorites.splice(toIndex, 0, songId);
    return true;
}

export function setUserLists(lists) { userLists = lists; }

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
// CONSTANTS
// ============================================

export const GITHUB_REPO = 'Jollyhrothgar/Bluegrass-Songbook';

// Tag categories for display
export const TAG_CATEGORIES = {
    'Genre': ['Bluegrass', 'ClassicCountry', 'OldTime', 'Gospel', 'Folk', 'HonkyTonk', 'Outlaw', 'Rockabilly', 'WesternSwing'],
    'Vibe': ['JamFriendly', 'Modal', 'Jazzy'],
    'Structure': ['Instrumental', 'Waltz']
};
