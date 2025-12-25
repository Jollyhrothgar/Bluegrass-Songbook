// Editor state
let nashvilleMode = false;
let currentKey = null;

// DOM elements
const titleInput = document.getElementById('song-title');
const artistInput = document.getElementById('song-artist');
const writerInput = document.getElementById('song-writer');
const contentInput = document.getElementById('song-content');
const previewContent = document.getElementById('preview-content');
const copyBtn = document.getElementById('copy-btn');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const themeToggle = document.getElementById('theme-toggle');
const nashvilleCheckbox = document.getElementById('preview-nashville');

// Theme handling
function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
});

initTheme();

// Key detection data
const KEYS = {
    'C':  { scale: ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'], tonic: 'C', mode: 'major' },
    'G':  { scale: ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'], tonic: 'G', mode: 'major' },
    'D':  { scale: ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim'], tonic: 'D', mode: 'major' },
    'A':  { scale: ['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim'], tonic: 'A', mode: 'major' },
    'E':  { scale: ['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim'], tonic: 'E', mode: 'major' },
    'B':  { scale: ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m', 'A#dim'], tonic: 'B', mode: 'major' },
    'F':  { scale: ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim'], tonic: 'F', mode: 'major' },
    'Bb': { scale: ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim'], tonic: 'Bb', mode: 'major' },
    'Eb': { scale: ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim'], tonic: 'Eb', mode: 'major' },
    'Am': { scale: ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G'], tonic: 'Am', mode: 'minor' },
    'Em': { scale: ['Em', 'F#dim', 'G', 'Am', 'Bm', 'C', 'D'], tonic: 'Em', mode: 'minor' },
    'Bm': { scale: ['Bm', 'C#dim', 'D', 'Em', 'F#m', 'G', 'A'], tonic: 'Bm', mode: 'minor' },
    'Dm': { scale: ['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C'], tonic: 'Dm', mode: 'minor' },
    'Gm': { scale: ['Gm', 'Adim', 'Bb', 'Cm', 'Dm', 'Eb', 'F'], tonic: 'Gm', mode: 'minor' },
};

const CHROMATIC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const ENHARMONIC = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
const NASHVILLE_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const NASHVILLE_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

function normalizeChord(chord) {
    if (!chord) return null;
    const match = chord.match(/^([A-G][#b]?)/);
    if (!match) return null;
    let root = match[1];
    const rest = chord.slice(root.length).toLowerCase();
    if (root in ENHARMONIC) root = ENHARMONIC[root];
    let quality = '';
    if (rest.startsWith('m') && !rest.startsWith('maj')) quality = 'm';
    else if (rest.includes('dim')) quality = 'dim';
    return root + quality;
}

function extractChords(content) {
    const matches = content.match(/\[([^\]]+)\]/g) || [];
    return matches.map(m => m.slice(1, -1));
}

function detectKey(chords) {
    if (!chords.length) return { key: null, mode: null };

    const chordCounts = {};
    for (const chord of chords) {
        const normalized = normalizeChord(chord);
        if (normalized) {
            chordCounts[normalized] = (chordCounts[normalized] || 0) + 1;
        }
    }

    const total = chords.length;
    const scores = {};

    for (const [keyName, keyInfo] of Object.entries(KEYS)) {
        const normalizedScale = new Set(keyInfo.scale.map(c => normalizeChord(c)));
        const normalizedTonic = normalizeChord(keyInfo.tonic);

        let matchWeight = 0;
        let tonicWeight = 0;

        for (const [chord, count] of Object.entries(chordCounts)) {
            if (normalizedScale.has(chord)) {
                matchWeight += count;
                if (chord === normalizedTonic) {
                    tonicWeight += count * 0.5;
                }
            }
        }

        scores[keyName] = (matchWeight + tonicWeight) / total;
    }

    let bestKey = null;
    let bestScore = 0;
    for (const [key, score] of Object.entries(scores)) {
        if (score > bestScore) {
            bestScore = score;
            bestKey = key;
        }
    }

    const preferredKeys = ['G', 'C', 'D', 'A', 'E', 'Am', 'Em', 'Dm'];
    for (const key of preferredKeys) {
        if (key in scores && scores[key] >= bestScore - 0.03) {
            bestKey = key;
            break;
        }
    }

    return bestKey ? { key: bestKey, mode: KEYS[bestKey].mode } : { key: null, mode: null };
}

function toNashville(chord, keyName) {
    if (!chord || !keyName || !(keyName in KEYS)) return chord;

    const keyInfo = KEYS[keyName];
    const match = chord.match(/^([A-G][#b]?)/);
    if (!match) return chord;

    let chordRoot = match[1];
    if (chordRoot in ENHARMONIC) chordRoot = ENHARMONIC[chordRoot];

    let tonicRoot = keyInfo.tonic.replace('m', '');
    if (tonicRoot in ENHARMONIC) tonicRoot = ENHARMONIC[tonicRoot];

    const tonicIndex = CHROMATIC.indexOf(tonicRoot);
    const chordIndex = CHROMATIC.indexOf(chordRoot);
    if (tonicIndex === -1 || chordIndex === -1) return chord;

    const interval = (chordIndex - tonicIndex + 12) % 12;
    const intervalToDegree = { 0: 0, 2: 1, 3: 2, 4: 2, 5: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6 };
    const scaleDegree = intervalToDegree[interval];

    if (scaleDegree === undefined) {
        const symbols = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
        return symbols[interval];
    }

    const nashville = keyInfo.mode === 'minor' ? NASHVILLE_MINOR : NASHVILLE_MAJOR;
    return nashville[scaleDegree];
}

// Parse ChordPro content into sections
function parseContent(content) {
    const lines = content.split('\n');
    const sections = [];
    let currentSection = { label: 'Verse 1', lines: [] };
    let verseCount = 1;
    let inSection = false;

    for (const line of lines) {
        // Check for section markers
        if (line.match(/^\{(start_of_verse|sov)/i)) {
            if (currentSection.lines.length > 0) {
                sections.push(currentSection);
            }
            const labelMatch = line.match(/:\s*(.+?)\s*\}/);
            currentSection = {
                label: labelMatch ? labelMatch[1] : `Verse ${++verseCount}`,
                lines: []
            };
            inSection = true;
            continue;
        }
        if (line.match(/^\{(start_of_chorus|soc)/i)) {
            if (currentSection.lines.length > 0) {
                sections.push(currentSection);
            }
            currentSection = { label: 'Chorus', type: 'chorus', lines: [] };
            inSection = true;
            continue;
        }
        if (line.match(/^\{(end_of_verse|eov|end_of_chorus|eoc)/i)) {
            if (currentSection.lines.length > 0) {
                sections.push(currentSection);
            }
            currentSection = { label: `Verse ${++verseCount}`, lines: [] };
            inSection = false;
            continue;
        }

        // Skip other directives
        if (line.startsWith('{')) continue;

        // Blank line = new section (if not in explicit section)
        if (!line.trim() && !inSection) {
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

    if (currentSection.lines.length > 0) {
        sections.push(currentSection);
    }

    return sections;
}

// Render a single line with chords above lyrics
function renderLine(line) {
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

    if (chords.length === 0) {
        return `<div class="song-line"><div class="lyrics-line">${escapeHtml(lyrics)}</div></div>`;
    }

    let chordLine = '';
    let lastPos = 0;

    for (const { chord, position } of chords) {
        const displayChord = nashvilleMode && currentKey
            ? toNashville(chord, currentKey)
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update preview
function updatePreview() {
    const title = titleInput.value.trim();
    const artist = artistInput.value.trim();
    const writer = writerInput.value.trim();
    const content = contentInput.value;

    if (!content.trim()) {
        previewContent.innerHTML = '<p class="preview-placeholder">Enter a song to see preview...</p>';
        return;
    }

    // Detect key
    const chords = extractChords(content);
    const { key } = detectKey(chords);
    currentKey = key;

    // Parse and render
    const sections = parseContent(content);

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
            html += renderLine(line);
        }
        html += '</div></div>';
    }

    previewContent.innerHTML = html;
}

// Generate ChordPro file content
function generateChordPro() {
    const title = titleInput.value.trim();
    const artist = artistInput.value.trim();
    const writer = writerInput.value.trim();
    const content = contentInput.value.trim();

    let output = '';

    if (title) output += `{meta: title ${title}}\n`;
    if (artist) output += `{meta: artist ${artist}}\n`;
    if (writer) output += `{meta: writer ${writer}}\n`;

    if (output) output += '\n';

    // Parse content and wrap in verse markers
    const sections = parseContent(content);

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

// Generate filename from title
function generateFilename(title) {
    if (!title) return 'untitled.pro';
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 50) + '.pro';
}

// Copy to clipboard
copyBtn.addEventListener('click', async () => {
    const chordpro = generateChordPro();
    try {
        await navigator.clipboard.writeText(chordpro);
        saveStatus.textContent = 'Copied!';
        saveStatus.className = 'save-status success';
        setTimeout(() => { saveStatus.textContent = ''; }, 2000);
    } catch (err) {
        saveStatus.textContent = 'Copy failed';
        saveStatus.className = 'save-status error';
    }
});

// Save to server
saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) {
        saveStatus.textContent = 'Title required';
        saveStatus.className = 'save-status error';
        return;
    }

    const chordpro = generateChordPro();
    const filename = generateFilename(title);

    try {
        const response = await fetch('http://localhost:8081/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, content: chordpro })
        });

        if (response.ok) {
            const result = await response.json();
            saveStatus.textContent = `Saved: ${result.path}`;
            saveStatus.className = 'save-status success';
        } else {
            throw new Error('Save failed');
        }
    } catch (err) {
        saveStatus.textContent = 'Save failed - is editor server running?';
        saveStatus.className = 'save-status error';
    }
});

// Nashville toggle
nashvilleCheckbox.addEventListener('change', (e) => {
    nashvilleMode = e.target.checked;
    updatePreview();
});

// Smart paste detection and conversion
function isChordLine(line) {
    if (!line.trim()) return false;

    // Check if line is mostly chords with spaces
    const words = line.trim().split(/\s+/);
    if (words.length === 0) return false;

    const chordPattern = /^[A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?$/;
    const chordCount = words.filter(w => chordPattern.test(w)).length;

    // If most words are chords, it's a chord line
    return chordCount / words.length > 0.5;
}

function isSectionMarker(line) {
    const trimmed = line.trim();
    // Match [Verse 1], [Chorus], [Instrumental break], etc.
    return /^\[.+\]$/.test(trimmed);
}

function isInstrumentalLine(line) {
    // Match lines like "—G---/G---/C---/" or "G---/G---/"
    return /^[—\-]?[A-G][#b]?---/.test(line.trim());
}

function extractChordsWithPositions(chordLine) {
    const chords = [];
    const pattern = /([A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?)/g;
    let match;

    while ((match = pattern.exec(chordLine)) !== null) {
        chords.push({
            chord: match[1],
            position: match.index
        });
    }

    return chords;
}

function alignChordsToLyrics(chordLine, lyricLine, chordPositions) {
    if (!chordPositions.length) return lyricLine;

    // Sort by position descending so we can insert right to left
    const sorted = [...chordPositions].sort((a, b) => b.position - a.position);

    let result = lyricLine;

    for (const { chord, position } of sorted) {
        // Find the position in lyrics that corresponds to the chord position
        // Scale if chord line and lyric line have different lengths
        let lyricPos = position;

        // If position is beyond lyric length, put at end
        if (lyricPos > result.length) {
            lyricPos = result.length;
        }

        // Insert chord at position
        result = result.slice(0, lyricPos) + `[${chord}]` + result.slice(lyricPos);
    }

    return result;
}

function convertToChordPro(text) {
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Empty line - keep as section break
        if (!trimmed) {
            result.push('');
            i++;
            continue;
        }

        // Section marker like [Verse 1] or [Chorus]
        if (isSectionMarker(trimmed)) {
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

        // Instrumental notation line
        if (isInstrumentalLine(trimmed)) {
            // Convert to comment
            result.push(`{comment: ${trimmed}}`);
            i++;
            continue;
        }

        // Check if this is a chord line followed by lyrics
        if (isChordLine(line)) {
            const chordPositions = extractChordsWithPositions(line);

            // Look ahead for lyric line
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];

                // If next line is empty, just chords, or another chord line,
                // this is a chord-only line
                if (!nextLine.trim() || isChordLine(nextLine) || isSectionMarker(nextLine.trim())) {
                    // Chord-only line - convert to comment
                    const chords = chordPositions.map(c => c.chord).join(' ');
                    result.push(`{comment: ${chords}}`);
                    i++;
                    continue;
                }

                // Next line is lyrics - align chords to it
                const chordproLine = alignChordsToLyrics(line, nextLine, chordPositions);
                result.push(chordproLine);
                i += 2; // Skip both chord line and lyric line
                continue;
            } else {
                // No more lines - chord only
                const chords = chordPositions.map(c => c.chord).join(' ');
                result.push(`{comment: ${chords}}`);
                i++;
                continue;
            }
        }

        // Regular lyric line (no chords above)
        result.push(line);
        i++;
    }

    return result.join('\n');
}

function detectAndConvert(text) {
    // Check if the text looks like chord-above-lyrics format
    const lines = text.split('\n');
    let chordLineCount = 0;
    let consecutivePairs = 0;

    for (let i = 0; i < lines.length - 1; i++) {
        if (isChordLine(lines[i]) && !isChordLine(lines[i + 1]) && lines[i + 1].trim()) {
            consecutivePairs++;
        }
        if (isChordLine(lines[i])) {
            chordLineCount++;
        }
    }

    // If we have several chord-lyric pairs, it's likely chord-above format
    if (consecutivePairs >= 2 || chordLineCount >= 3) {
        return convertToChordPro(text);
    }

    // Already in ChordPro format or plain text
    return text;
}

// Handle paste event
contentInput.addEventListener('paste', (e) => {
    // Let the paste happen, then convert
    setTimeout(() => {
        const converted = detectAndConvert(contentInput.value);
        if (converted !== contentInput.value) {
            contentInput.value = converted;
            updatePreview();
            saveStatus.textContent = 'Converted from chord-above format';
            saveStatus.className = 'save-status success';
            setTimeout(() => { saveStatus.textContent = ''; }, 3000);
        }
    }, 0);
});

// Live preview on input
titleInput.addEventListener('input', updatePreview);
artistInput.addEventListener('input', updatePreview);
contentInput.addEventListener('input', updatePreview);

// Initial preview
updatePreview();
