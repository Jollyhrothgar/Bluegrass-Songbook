// Bluegrass Songbook Search

let songIndex = null;
let allSongs = [];
let currentSong = null;
let currentChordpro = null;
let compactMode = false;
let showingFavorites = false;

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

// Search songs
function search(query) {
    showingFavorites = false;
    favoritesToggle.classList.remove('is-favorite');

    if (!query.trim()) {
        showRandomSongs();
        return;
    }

    const terms = query.toLowerCase().split(/\s+/);

    const results = allSongs.filter(song => {
        const searchText = [
            song.title || '',
            song.artist || '',
            song.composer || '',
            song.lyrics || '',
            song.first_line || ''
        ].join(' ').toLowerCase();

        return terms.every(term => searchText.includes(term));
    });

    // Sort by relevance
    results.sort((a, b) => {
        const aTitle = (a.title || '').toLowerCase();
        const bTitle = (b.title || '').toLowerCase();
        const aArtist = (a.artist || '').toLowerCase();
        const bArtist = (b.artist || '').toLowerCase();
        const q = query.toLowerCase();

        if (aTitle === q && bTitle !== q) return -1;
        if (bTitle === q && aTitle !== q) return 1;
        if (aTitle.startsWith(q) && !bTitle.startsWith(q)) return -1;
        if (bTitle.startsWith(q) && !aTitle.startsWith(q)) return 1;
        if (aTitle.includes(q) && !bTitle.includes(q)) return -1;
        if (bTitle.includes(q) && !aTitle.includes(q)) return 1;
        if (aArtist.includes(q) && !bArtist.includes(q)) return -1;
        if (bArtist.includes(q) && !aArtist.includes(q)) return 1;

        return 0;
    });

    searchStats.textContent = `${results.length.toLocaleString()} results`;
    renderResults(results.slice(0, 50), query);
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

    const song = allSongs.find(s => s.id === songId);
    currentSong = song;
    updateFavoriteButton();

    if (song && song.content) {
        currentChordpro = song.content;
        renderSong(song, song.content);
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
        renderSong(song, chordpro);
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
        const spaces = Math.max(0, position - lastPos);
        chordLine += ' '.repeat(spaces) + chord;
        lastPos = position + chord.length;
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
function renderSong(song, chordpro) {
    const { metadata, sections } = parseChordPro(chordpro);

    const totalCounts = {};
    for (const section of sections) {
        totalCounts[section.label] = (totalCounts[section.label] || 0) + 1;
    }

    const seenSections = new Set();
    let sectionsHtml = '';
    let i = 0;

    while (i < sections.length) {
        const section = sections[i];
        const key = section.label;
        const isRepeatedSection = totalCounts[key] > 1;
        const shouldIndent = section.type === 'chorus' || isRepeatedSection;

        if (!seenSections.has(key)) {
            seenSections.add(key);
            sectionsHtml += renderSection(section, isRepeatedSection);
            i++;
        } else if (compactMode) {
            let consecutiveCount = 0;
            while (i < sections.length && sections[i].label === key) {
                consecutiveCount++;
                i++;
            }
            sectionsHtml += renderRepeatIndicator(key, consecutiveCount, shouldIndent);
        } else {
            sectionsHtml += renderSection(section, isRepeatedSection);
            i++;
        }
    }

    const title = metadata.title || song?.title || 'Unknown Title';
    const artist = metadata.artist || song?.artist || '';
    const composer = metadata.writer || metadata.composer || song?.composer || '';
    const sourceUrl = song?.id ? `https://www.classic-country-song-lyrics.com/${song.id}.html` : null;

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
            <label class="compact-toggle">
                <input type="checkbox" id="compact-checkbox" ${compactMode ? 'checked' : ''}>
                <span>Compact (show repeats once)</span>
            </label>
        </div>
        <div class="song-body">${sectionsHtml}</div>
    `;

    const checkbox = document.getElementById('compact-checkbox');
    if (checkbox) {
        checkbox.addEventListener('change', (e) => {
            compactMode = e.target.checked;
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
