// Bluegrass Songbook Search

let songIndex = null;
let allSongs = [];
let currentSong = null;
let currentChordpro = null;
let compactMode = false;
let showingFavorites = false;
let nashvilleMode = false;
let currentDetectedKey = null;      // User's chosen key (or detected if not changed)
let originalDetectedKey = null;     // The auto-detected key for current song
let originalDetectedMode = null;    // The auto-detected mode for current song

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
const favoritesToggle = document.getElementById('favorites-toggle');
const favoritesCount = document.getElementById('favorites-count');
const favoriteBtn = document.getElementById('favorite-btn');

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
    if (favorites.size > 0) {
        favoritesCount.textContent = favorites.size;
        favoritesCount.classList.remove('hidden');
    } else {
        favoritesCount.classList.add('hidden');
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
    favoritesToggle.classList.add('is-favorite');
    const favSongs = allSongs.filter(s => favorites.has(s.id));
    searchStats.textContent = `${favSongs.length} favorite${favSongs.length !== 1 ? 's' : ''}`;
    searchInput.value = '';
    renderResults(favSongs, '');
}

function hideFavorites() {
    showingFavorites = false;
    favoritesToggle.classList.remove('is-favorite');
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
    favoritesToggle.classList.remove('is-favorite');

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
        let response = await fetch(`data/songs/${songId}.pro`);
        if (!response.ok) {
            response = await fetch(`../songs/classic-country/parsed/${songId}.pro`);
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
        return num;
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

    return num;
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

    let chordLine = '';
    let lastPos = 0;

    for (const { chord, position } of chords) {
        // Convert to Nashville if enabled
        const displayChord = nashvilleMode && currentDetectedKey
            ? toNashville(chord, currentDetectedKey)
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

    // On initial render, set both original and current to detected
    // On re-render (e.g., after toggling Nashville), preserve user's key choice
    if (isInitialRender || originalDetectedKey === null) {
        originalDetectedKey = detectedKey;
        originalDetectedMode = detectedMode;
        currentDetectedKey = detectedKey;
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

    // Build key dropdown options
    const majorKeys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'];
    const minorKeys = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm'];

    // Filter keys based on detected mode (only show same mode keys)
    const availableKeys = originalDetectedMode === 'minor' ? minorKeys : majorKeys;

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
            <label class="compact-toggle">
                <input type="checkbox" id="compact-checkbox" ${compactMode ? 'checked' : ''}>
                <span>Compact</span>
            </label>
            <label class="compact-toggle">
                <input type="checkbox" id="nashville-checkbox" ${nashvilleMode ? 'checked' : ''}>
                <span>Nashville</span>
            </label>
        </div>
        <div class="song-body">${sectionsHtml}</div>
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

favoritesToggle.addEventListener('click', () => {
    if (showingFavorites) {
        hideFavorites();
    } else {
        showFavorites();
    }
});

favoriteBtn.addEventListener('click', () => {
    if (currentSong) {
        toggleFavorite(currentSong.id);
    }
});

// Bug report modal elements
const bugBtn = document.getElementById('bug-btn');
const bugModal = document.getElementById('bug-modal');
const modalClose = document.getElementById('modal-close');
const bugFeedback = document.getElementById('bug-feedback');
const copyBugBtn = document.getElementById('copy-bug-btn');
const copyStatus = document.getElementById('copy-status');

function closeBugModal() {
    bugModal.classList.add('hidden');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!bugModal.classList.contains('hidden')) {
            closeBugModal();
        } else if (!songView.classList.contains('hidden')) {
            goBack();
        }
    }
});

bugBtn.addEventListener('click', () => {
    bugModal.classList.remove('hidden');
    bugFeedback.value = '';
    copyStatus.textContent = '';
    bugFeedback.focus();
});

modalClose.addEventListener('click', closeBugModal);

bugModal.addEventListener('click', (e) => {
    if (e.target === bugModal) {
        closeBugModal();
    }
});

copyBugBtn.addEventListener('click', async () => {
    const feedback = bugFeedback.value.trim();
    if (!feedback) {
        copyStatus.textContent = 'Please describe the issue first';
        copyStatus.style.color = 'var(--danger)';
        return;
    }

    const report = formatBugReport(feedback);

    try {
        await navigator.clipboard.writeText(report);
        copyStatus.textContent = 'Copied!';
        copyStatus.style.color = 'var(--success)';
    } catch (error) {
        const textarea = document.createElement('textarea');
        textarea.value = report;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        copyStatus.textContent = 'Copied!';
        copyStatus.style.color = 'var(--success)';
    }
});

function formatBugReport(feedback) {
    const song = currentSong || {};
    const songId = song.id || 'unknown';
    const lines = [
        `## Bug Report: ${song.title || 'Unknown Song'}`,
        '',
        `**Song ID:** ${songId}`,
        `**Artist:** ${song.artist || 'Unknown'}`,
        `**Parsed File:** songs/classic-country/parsed/${songId}.pro`,
        `**Raw HTML:** songs/classic-country/raw/${songId}.html`,
        '',
        `### Issue`,
        feedback,
        '',
        `### Current ChordPro Output`,
        '```chordpro',
        currentChordpro || '(content not available)',
        '```',
        '',
        `### Fix Workflow`,
        '1. Read the raw HTML file to understand the source',
        '2. Make parser changes if needed',
        '3. Re-parse and verify: `python3 scripts/quick_fix.py --song ' + songId + '`',
        '4. Check for regressions: `python3 scripts/quick_fix.py --song ' + songId + ' --check-sample`',
        '5. If good, run full batch: `python3 scripts/quick_fix.py --batch`',
        '6. If bad, rollback: `python3 scripts/quick_fix.py --rollback`',
    ];

    return lines.join('\n');
}

// Initialize
initTheme();
updateFavoritesCount();
loadIndex();
