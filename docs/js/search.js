// Bluegrass Songbook Search

let songIndex = null;
let allSongs = [];
let currentSong = null;
let currentChordpro = null;
let compactMode = false;
let showingFavorites = false;
let nashvilleMode = false;
let twoColumnMode = false;
let fontSizeLevel = 0;              // -2 to +2, 0 is default
let currentDetectedKey = null;      // User's chosen key (or detected if not changed)
let originalDetectedKey = null;     // The auto-detected key for current song
let originalDetectedMode = null;    // The auto-detected mode for current song

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

// Favorites stored in localStorage
let favorites = new Set(JSON.parse(localStorage.getItem('songbook-favorites') || '[]'));

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
const navContact = document.getElementById('nav-contact');

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
    if (favorites.has(songId)) {
        favorites.delete(songId);
    } else {
        favorites.add(songId);
    }
    saveFavorites();
    updateFavoriteButton();
    // Update result list if visible
    if (!resultsDiv.classList.contains('hidden')) {
        const item = resultsDiv.querySelector(`[data-id="${songId}"]`);
        if (item) {
            item.classList.toggle('is-favorite', favorites.has(songId));
        }
    }
}

function updateFavoriteButton() {
    if (currentSong && favoriteBtn) {
        favoriteBtn.classList.toggle('is-favorite', isFavorite(currentSong.id));
    }
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

// Load the song index
async function loadIndex() {
    resultsDiv.innerHTML = '<div class="loading">Loading songbook...</div>';

    try {
        const response = await fetch('data/index.json');
        songIndex = await response.json();
        allSongs = songIndex.songs;

        resultsDiv.innerHTML = '';
        searchStats.textContent = `${allSongs.length.toLocaleString()} songs loaded`;
        searchInput.focus();

        showRandomSongs();
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

    resultsDiv.innerHTML = songs.map(song => {
        const favClass = isFavorite(song.id) ? 'is-favorite' : '';
        return `
            <div class="result-item ${favClass}" data-id="${song.id}">
                <div class="result-title">${highlightMatch(song.title || 'Unknown', query)}</div>
                <div class="result-artist">${highlightMatch(song.artist || 'Unknown artist', query)}</div>
                <div class="result-preview">${song.first_line || ''}</div>
            </div>
        `;
    }).join('');

    resultsDiv.querySelectorAll('.result-item').forEach(item => {
        item.addEventListener('click', () => openSong(item.dataset.id));
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
    songView.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    document.querySelector('.search-container').classList.add('hidden');

    // Reset key tracking for new song
    originalDetectedKey = null;
    originalDetectedMode = null;
    currentDetectedKey = null;

    const song = allSongs.find(s => s.id === songId);
    currentSong = song;
    updateFavoriteButton();

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
function renderLine(line) {
    const { chords, lyrics } = parseLineWithChords(line);

    if (chords.length === 0) {
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

// Render a section (verse, chorus, etc.)
function renderSection(section, isRepeatedSection = false) {
    const lines = section.lines.map(line => renderLine(line)).join('');
    const shouldIndent = section.type === 'chorus' || isRepeatedSection;
    const indentClass = shouldIndent ? 'section-indent' : '';

    return `
        <div class="song-section ${indentClass}">
            <div class="section-label">${escapeHtml(section.label)}</div>
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

        if (!seenSections.has(sectionKey)) {
            seenSections.add(sectionKey);
            sectionsHtml += renderSection(section, isRepeatedSection);
            i++;
        } else if (compactMode) {
            let consecutiveCount = 0;
            while (i < sections.length && sections[i].label === sectionKey) {
                consecutiveCount++;
                i++;
            }
            sectionsHtml += renderRepeatIndicator(sectionKey, consecutiveCount, shouldIndent);
        } else {
            sectionsHtml += renderSection(section, isRepeatedSection);
            i++;
        }
    }

    const title = metadata.title || song?.title || 'Unknown Title';
    const artist = metadata.artist || song?.artist || '';
    const composer = metadata.writer || metadata.composer || song?.composer || '';
    const sourceUrl = song?.id ? `https://www.classic-country-song-lyrics.com/${song.id}.html` : null;

    // Build key dropdown options (availableKeys already defined above)
    const keyOptions = availableKeys.map(k => {
        const isDetected = k === originalDetectedKey;
        const label = isDetected ? `${k} (detected)` : k;
        const selected = k === currentDetectedKey ? 'selected' : '';
        return `<option value="${k}" ${selected}>${label}</option>`;
    }).join('');

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
            <div class="song-title">${escapeHtml(title)}</div>
            <div class="song-meta">${metaHtml}</div>
        </div>
        <div class="render-options">
            <div class="key-selector">
                <label for="key-select">Key:</label>
                <select id="key-select" class="key-select">${keyOptions}</select>
            </div>
            <div class="font-size-controls">
                <button id="font-decrease" class="font-btn" ${fontSizeLevel <= -2 ? 'disabled' : ''}>−</button>
                <button id="font-increase" class="font-btn" ${fontSizeLevel >= 2 ? 'disabled' : ''}>+</button>
            </div>
            <label class="compact-toggle">
                <input type="checkbox" id="compact-checkbox" ${compactMode ? 'checked' : ''}>
                <span>Compact</span>
            </label>
            <label class="compact-toggle">
                <input type="checkbox" id="nashville-checkbox" ${nashvilleMode ? 'checked' : ''}>
                <span>Nashville</span>
            </label>
            <label class="compact-toggle">
                <input type="checkbox" id="twocol-checkbox" ${twoColumnMode ? 'checked' : ''}>
                <span>2-Col</span>
            </label>
        </div>
        <div class="song-body ${twoColumnMode ? 'two-column' : ''}" style="font-size: ${FONT_SIZES[fontSizeLevel]}em">${sectionsHtml}</div>
    `;

    const keySelect = document.getElementById('key-select');
    if (keySelect) {
        keySelect.addEventListener('change', (e) => {
            currentDetectedKey = e.target.value;
            renderSong(song, chordpro);
        });
    }

    const compactCheckbox = document.getElementById('compact-checkbox');
    if (compactCheckbox) {
        compactCheckbox.addEventListener('change', (e) => {
            compactMode = e.target.checked;
            renderSong(song, chordpro);
        });
    }

    const nashvilleCheckbox = document.getElementById('nashville-checkbox');
    if (nashvilleCheckbox) {
        nashvilleCheckbox.addEventListener('change', (e) => {
            nashvilleMode = e.target.checked;
            renderSong(song, chordpro);
        });
    }

    const twocolCheckbox = document.getElementById('twocol-checkbox');
    if (twocolCheckbox) {
        twocolCheckbox.addEventListener('change', (e) => {
            twoColumnMode = e.target.checked;
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
    songView.classList.add('hidden');
    resultsDiv.classList.remove('hidden');
    document.querySelector('.search-container').classList.remove('hidden');
    searchInput.focus();
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

// Event listeners
searchInput.addEventListener('input', (e) => {
    search(e.target.value);
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

favoriteBtn.addEventListener('click', () => {
    if (currentSong) {
        toggleFavorite(currentSong.id);
    }
});

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
            exitEditMode();
            break;

        case 'favorites':
            if (navFavorites) navFavorites.classList.add('active');
            searchContainer.classList.remove('hidden');
            resultsDiv.classList.remove('hidden');
            if (editorPanel) editorPanel.classList.add('hidden');
            songView.classList.add('hidden');
            showFavorites();
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
    const lines = [
        `**Song ID:** ${songId}`,
        `**Artist:** ${song.artist || 'Unknown'}`,
        `**Parsed File:** sources/classic-country/parsed/${songId}.pro`,
        `**Raw HTML:** sources/classic-country/raw/${songId}.html`,
        '',
        '## Issue',
        feedback,
        '',
        '## Current ChordPro Output',
        '```chordpro',
        currentChordpro || '(content not available)',
        '```',
    ];

    return lines.join('\n');
}

// Contact modal elements
const contactModal = document.getElementById('contact-modal');
const contactModalClose = document.getElementById('contact-modal-close');
const contactFeedback = document.getElementById('contact-feedback');
const submitContactBtn = document.getElementById('submit-contact-btn');
const contactStatus = document.getElementById('contact-status');

function closeContactModal() {
    contactModal.classList.add('hidden');
}

function openContactModal() {
    closeSidebar();
    contactModal.classList.remove('hidden');
    contactFeedback.value = '';
    contactStatus.textContent = '';
    contactFeedback.focus();
}

if (navContact) {
    navContact.addEventListener('click', openContactModal);
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

    const title = feedback.length > 50 ? feedback.substring(0, 50) + '...' : feedback;
    const body = feedback;

    const params = new URLSearchParams({
        title: title,
        body: body,
        labels: 'feature-request'
    });

    const issueUrl = `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
    window.open(issueUrl, '_blank');
    closeContactModal();
});

// Global Escape key handler for all modals and sidebar
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (sidebar && sidebar.classList.contains('open')) {
            closeSidebar();
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
    if (writer) output += `{meta: writer ${writer}}\n`;

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
