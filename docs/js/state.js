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

export function setCompactMode(value) { compactMode = value; }
export function setShowingFavorites(value) { showingFavorites = value; }
export function setNashvilleMode(value) { nashvilleMode = value; }
export function setTwoColumnMode(value) { twoColumnMode = value; }
export function setChordDisplayMode(value) { chordDisplayMode = value; }
export function clearSeenChordPatterns() { seenChordPatterns.clear(); }
export function addSeenChordPattern(pattern) { seenChordPatterns.add(pattern); }
export function setShowSectionLabels(value) { showSectionLabels = value; }
export function setShowChordProSource(value) { showChordProSource = value; }
export function setFontSizeLevel(value) { fontSizeLevel = value; }

// Font size multipliers
export const FONT_SIZES = {
    '-2': 0.7,
    '-1': 0.85,
    '0': 1,
    '1': 1.2,
    '2': 1.5
};

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

export let favorites = new Set();
export let userLists = [];

export function setFavorites(favs) {
    favorites = favs instanceof Set ? favs : new Set(favs);
}

export function addFavorite(songId) { favorites.add(songId); }
export function removeFavorite(songId) { favorites.delete(songId); }
export function hasFavorite(songId) { return favorites.has(songId); }

export function setUserLists(lists) { userLists = lists; }

// ============================================
// HISTORY STATE
// ============================================

export let historyInitialized = false;

export function setHistoryInitialized(value) { historyInitialized = value; }

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
