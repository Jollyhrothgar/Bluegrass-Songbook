// WorkView - Display works with multiple parts (lead sheets, tablature, etc.)
// Part of the works architecture refactor

import {
    allSongs,
    songGroups,
    currentSong, setCurrentSong,
    currentChordpro, setCurrentChordpro,
    loadedTablature, setLoadedTablature,
    tablaturePlayer, setTablaturePlayer,
    compactMode, nashvilleMode, chordDisplayMode, showSectionLabels,
    fontSizeLevel, FONT_SIZES,
    currentDetectedKey, setCurrentDetectedKey,
    originalDetectedKey, setOriginalDetectedKey,
    setOriginalDetectedMode,
    fullscreenMode,
    setCurrentView
} from './state.js';

import { parseChordPro, showVersionPicker } from './song-view.js';
import { detectKey, transposeChord, toNashville, getSemitonesBetweenKeys, KEYS } from './chords.js';
import { escapeHtml } from './utils.js';
import { TabRenderer, TabPlayer, INSTRUMENT_ICONS } from './renderers/index.js';
import { getTagCategory, formatTagName } from './tags.js';

// ============================================
// WORK STATE
// ============================================

let currentWork = null;          // The full work object
let activePart = null;           // Currently displayed part { type, format, file, ... }
let availableParts = [];         // All parts for current work
let trackRenderers = {};         // Map of trackId -> TabRenderer instance
let showRepeatsCompact = false;  // true = show repeat signs, false = unroll repeats

// ============================================
// NOTATION HELPERS
// ============================================

/**
 * Analyze reading list to detect repeat structures
 *
 * Returns an object with:
 * - repeatSections: [{startMeasure, endMeasure, repeatCount}]
 * - endings: [{measure, endingNumber}] - measures that are 1st/2nd endings
 * - repeatStartMarkers: Set of measures where repeat starts (|:)
 * - repeatEndMarkers: Set of measures where repeat ends (:|)
 *
 * Handles patterns like:
 * - [1-9, 2-8, 10-10]: Section 2-8 repeats, 9 is 1st ending, 10 is 2nd ending
 * - [11-18, 11-17, 19-19]: Section 11-17 repeats, 18 is 1st ending, 19 is 2nd ending
 */
function analyzeReadingList(readingList) {
    if (!readingList || readingList.length === 0) {
        return { repeatSections: [], endings: {}, repeatStartMarkers: new Set(), repeatEndMarkers: new Set() };
    }

    const repeatStartMarkers = new Set();
    const repeatEndMarkers = new Set();
    const endings = {}; // measure -> ending number (1, 2, etc.)

    // Look for consecutive entries that share a common subset
    for (let i = 0; i < readingList.length - 1; i++) {
        const curr = readingList[i];
        const next = readingList[i + 1];

        // Check if next entry is a subset of or overlaps with current
        // Pattern: [A-B] followed by [C-D] where C >= A and D <= B-1 (or C > A and D < B)
        // This indicates a repeat from C, with measures (D+1 to B) as 1st ending

        const currStart = curr.from_measure;
        const currEnd = curr.to_measure;
        const nextStart = next.from_measure;
        const nextEnd = next.to_measure;

        // Case 1: Next starts inside current and ends before current ends
        // e.g., [1-9] followed by [2-8] -> repeat at 2, end at 8, 9 is 1st ending
        if (nextStart > currStart && nextStart <= currEnd &&
            nextEnd < currEnd && nextEnd >= nextStart) {

            repeatStartMarkers.add(nextStart);
            repeatEndMarkers.add(nextEnd);

            // Measures from nextEnd+1 to currEnd are 1st ending
            for (let m = nextEnd + 1; m <= currEnd; m++) {
                endings[m] = 1;
            }

            // Check if there's a 2nd ending after the repeat
            const afterRepeat = readingList[i + 2];
            if (afterRepeat &&
                afterRepeat.from_measure === currEnd + 1 &&
                afterRepeat.to_measure === afterRepeat.from_measure) {
                endings[afterRepeat.from_measure] = 2;
            }
        }

        // Case 2: Same start, next ends before current (subset repeat)
        // e.g., [11-18] followed by [11-17] -> repeat at 11, end at 17, 18 is 1st ending
        if (nextStart === currStart && nextEnd < currEnd) {
            repeatStartMarkers.add(currStart);
            repeatEndMarkers.add(nextEnd);

            // Measures from nextEnd+1 to currEnd are 1st ending
            for (let m = nextEnd + 1; m <= currEnd; m++) {
                endings[m] = 1;
            }

            // Check for 2nd ending
            const afterRepeat = readingList[i + 2];
            if (afterRepeat &&
                afterRepeat.from_measure === currEnd + 1 &&
                afterRepeat.to_measure === afterRepeat.from_measure) {
                endings[afterRepeat.from_measure] = 2;
            }
        }

        // Case 3: Same start, next extends past current (simple repeat of first section)
        // e.g., [1-8] followed by [1-16] -> repeat at 1, end at 8 (measures 1-8 repeat)
        // This is common in AABB tune structures where A part repeats before B
        if (nextStart === currStart && nextEnd > currEnd) {
            repeatStartMarkers.add(currStart);
            repeatEndMarkers.add(currEnd);
        }
    }

    return { repeatStartMarkers, repeatEndMarkers, endings };
}

/**
 * Build a tick mapping for compact mode visualization
 *
 * Returns a function that converts playback tick (expanded) to visual tick (original)
 * This is needed because in compact mode:
 * - Display shows original measures (e.g., 1-19)
 * - Playback uses expanded measures following reading list (e.g., 1-36)
 *
 * @param {Array} readingList - Array of {from_measure, to_measure} entries
 * @param {number} ticksPerMeasure - Ticks per measure for calculations
 * @returns {Function} Mapping function (playbackTick) => visualTick
 */
function buildTickMapping(readingList, ticksPerMeasure) {
    if (!readingList || readingList.length === 0) {
        return (tick) => tick; // No mapping needed
    }

    // Build array of [expandedMeasure, originalMeasure] pairs
    const measureMapping = [];
    let expandedMeasure = 1;

    for (const range of readingList) {
        for (let m = range.from_measure; m <= range.to_measure; m++) {
            measureMapping.push({ expanded: expandedMeasure, original: m });
            expandedMeasure++;
        }
    }

    return (playbackTick) => {
        // Find which expanded measure this tick is in
        const expandedMeasureNum = Math.floor(playbackTick / ticksPerMeasure) + 1;
        const tickInMeasure = playbackTick % ticksPerMeasure;

        // Look up the original measure
        const mapping = measureMapping.find(m => m.expanded === expandedMeasureNum);
        if (!mapping) {
            return playbackTick; // Fallback
        }

        // Convert to tick in original measure
        return (mapping.original - 1) * ticksPerMeasure + tickInMeasure;
    };
}

/**
 * Expand notation according to reading list (repeat structure)
 *
 * The reading list defines playback order, e.g.:
 * [1-9, 2-8, 10-10, 11-18, 11-17, 19-19]
 * means play measures 1-9, then 2-8, then 10, then 11-18, etc.
 *
 * @param {Array} notation - Original notation array (each entry has {measure, events})
 * @param {Array} readingList - Array of {from_measure, to_measure} entries
 * @returns {Array} Expanded notation with measures repeated as specified
 */
function expandNotationWithReadingList(notation, readingList) {
    if (!readingList || readingList.length === 0) {
        return notation;
    }

    // Build a map of measure number -> notation entry
    const measureMap = {};
    for (const entry of notation) {
        measureMap[entry.measure] = entry;
    }

    // Expand according to reading list
    const expanded = [];
    let newMeasureNum = 1;

    for (const range of readingList) {
        const from = range.from_measure;
        const to = range.to_measure;

        for (let m = from; m <= to; m++) {
            const original = measureMap[m];
            if (original) {
                // Clone the measure with new measure number
                expanded.push({
                    ...original,
                    measure: newMeasureNum,
                    originalMeasure: m  // Keep reference to original for debugging
                });
                newMeasureNum++;
            }
        }
    }

    return expanded;
}

/**
 * Prepare compact notation with repeat markers
 *
 * Returns the original notation with added repeat/ending metadata
 */
function prepareCompactNotation(notation, readingList) {
    if (!readingList || readingList.length === 0) {
        return notation;
    }

    const analysis = analyzeReadingList(readingList);

    // Clone notation and add markers
    return notation.map(measure => {
        const m = measure.measure;
        const enhanced = { ...measure };

        if (analysis.repeatStartMarkers.has(m)) {
            enhanced.repeatStart = true;
        }
        if (analysis.repeatEndMarkers.has(m)) {
            enhanced.repeatEnd = true;
        }
        if (analysis.endings[m]) {
            enhanced.ending = analysis.endings[m];
        }

        return enhanced;
    });
}

// ============================================
// WORK LOADING
// ============================================

/**
 * Build the parts list from index data
 * The index has: content (ChordPro), tablature_parts (array)
 */
function buildPartsFromIndex(song) {
    const parts = [];

    // Lead sheet from content
    if (song.content) {
        // Use "Fiddle" label for tunes with ABC notation
        const label = song.abc_content ? 'Fiddle' : 'Lead Sheet';
        parts.push({
            type: 'lead-sheet',
            format: 'chordpro',
            label: label,
            content: song.content,
            default: true
        });
    }

    // Tablature parts
    if (song.tablature_parts) {
        for (const tab of song.tablature_parts) {
            parts.push({
                type: 'tablature',
                format: 'otf',
                instrument: tab.instrument,
                label: tab.label || `${tab.instrument} Tab`,
                file: tab.file,
                default: !song.content,  // Default if no lead sheet
                // Provenance info for attribution
                source: tab.source,
                source_id: tab.source_id,
                author: tab.author,
                source_page_url: tab.source_page_url,
                author_url: tab.author_url,
            });
        }
    }

    return parts;
}

/**
 * Open a work by ID
 */
export async function openWork(workId, options = {}) {
    const song = allSongs.find(s => s.id === workId);
    if (!song) {
        console.error(`Work not found: ${workId}`);
        return;
    }

    // Clear chordpro content FIRST to prevent stale render from subscribers
    // This must happen before any state changes that trigger reactive re-renders
    setCurrentChordpro(null);

    // Show the song view panel
    setCurrentView('song');

    // Reset key tracking
    setOriginalDetectedKey(null);
    setOriginalDetectedMode(null);
    setCurrentDetectedKey(null);

    // Reset tablature state for new work
    setLoadedTablature(null);
    if (tablaturePlayer) {
        tablaturePlayer.stop();
        setTablaturePlayer(null);
    }

    currentWork = song;
    availableParts = buildPartsFromIndex(song);
    setCurrentSong(song);

    // Find default part or first available
    const defaultPart = availableParts.find(p => p.default) || availableParts[0];
    activePart = options.partId
        ? availableParts.find(p => p.instrument === options.partId || p.type === options.partId)
        : defaultPart;

    if (!activePart && availableParts.length > 0) {
        activePart = availableParts[0];
    }

    renderWorkView();

    // Update URL
    const hash = options.partId
        ? `#work/${workId}/parts/${options.partId}`
        : `#work/${workId}`;

    if (window.location.hash !== hash && !options.fromDeepLink) {
        history.pushState({ workId, partId: options.partId }, '', hash);
    }
}

// ============================================
// RENDERING
// ============================================

/**
 * Main render function for work view
 */
export function renderWorkView() {
    const container = document.getElementById('song-content');
    if (!container || !currentWork) return;

    container.innerHTML = '';

    // Work header
    const header = renderWorkHeader();
    container.appendChild(header);

    // Part selector (if multiple parts)
    if (availableParts.length > 1) {
        const selector = renderPartSelector();
        container.appendChild(selector);
    }

    // Part content
    const content = document.createElement('div');
    content.className = 'work-part-content';
    container.appendChild(content);

    if (activePart) {
        renderPart(activePart, content);
    } else {
        content.innerHTML = '<p class="no-parts">No parts available for this work.</p>';
    }
}

/**
 * Render work header with metadata - matches song-view pattern
 */
function renderWorkHeader() {
    const header = document.createElement('div');
    header.className = 'work-header-container';

    const title = currentWork.title || 'Untitled';
    const artist = currentWork.artist || '';
    const composer = currentWork.composer || '';
    const key = currentWork.key || '';

    // Check for multiple versions
    const groupId = currentWork?.group_id;
    const versions = groupId ? (songGroups[groupId] || []) : [];
    const otherVersionCount = versions.length - 1;
    const versionHtml = otherVersionCount > 0
        ? `<button class="see-versions-btn" data-group-id="${groupId}">See ${otherVersionCount} other version${otherVersionCount > 1 ? 's' : ''}</button>`
        : '';

    // Build artists list: primary artist + covering artists
    const allArtists = new Set();
    if (artist) allArtists.add(artist);
    const coveringArtists = currentWork?.covering_artists || [];
    coveringArtists.forEach(a => allArtists.add(a));
    versions.forEach(v => { if (v.artist) allArtists.add(v.artist); });
    const artistsList = Array.from(allArtists);

    // Build info items
    let infoItems = [];
    if (composer) {
        infoItems.push(`<div class="info-item"><span class="info-label">Written by:</span> ${escapeHtml(composer)}</div>`);
    }
    if (artistsList.length > 0) {
        const maxVisible = 3;
        const hasMore = artistsList.length > maxVisible;
        const visibleArtists = hasMore ? artistsList.slice(0, maxVisible) : artistsList;
        const hiddenArtists = hasMore ? artistsList.slice(maxVisible) : [];

        const artistsHtml = hasMore
            ? `<span class="artists-visible">${visibleArtists.map(a => escapeHtml(a)).join(', ')}</span><button class="artists-toggle" id="artists-expand" type="button">… <span class="artists-more">(+${hiddenArtists.length})</span></button><span class="artists-hidden hidden" id="artists-full">, ${hiddenArtists.map(a => escapeHtml(a)).join(', ')}</span><button class="artists-toggle hidden" id="artists-collapse" type="button">(collapse)</button>`
            : visibleArtists.map(a => escapeHtml(a)).join(', ');

        infoItems.push(`<div class="info-item"><span class="info-label">Artists:</span> <span class="artists-list">${artistsHtml}</span></div>`);
    }

    // Tags with voting controls
    const songTags = currentWork?.tags || {};
    const tagNames = Object.keys(songTags);
    const isLoggedIn = window.SupabaseAuth?.isLoggedIn?.() || false;

    const tagsHtml = tagNames.length > 0
        ? tagNames.map(tag => {
            const category = getTagCategory(tag);
            const displayName = formatTagName(tag);
            return `
                <span class="votable-tag tag-${category}" data-tag="${escapeHtml(tag)}">
                    <span class="tag-name">${escapeHtml(displayName)}</span>
                    ${isLoggedIn ? `
                        <span class="vote-chip">
                            <button class="vote-btn vote-up" data-vote="1" title="Agree">
                                <svg width="14" height="16" viewBox="0 0 10 12"><path d="M5 0L10 6H7V9H3V6H0L5 0Z" fill="currentColor"/></svg>
                            </button>
                            <span class="vote-divider"></span>
                            <button class="vote-btn vote-down" data-vote="-1" title="Disagree">
                                <svg width="14" height="16" viewBox="0 0 10 12"><path d="M5 12L0 6H3V3H7V6H10L5 12Z" fill="currentColor"/></svg>
                            </button>
                        </span>
                    ` : ''}
                </span>
            `;
        }).join('')
        : '<em class="no-tags">None</em>';

    // Disclosure states from localStorage
    const controlsCollapsed = localStorage.getItem('workControlsCollapsed') !== 'false'; // Default collapsed
    const infoBarCollapsed = localStorage.getItem('infoBarCollapsed') !== 'false'; // Default collapsed

    // Focus header - shown in fullscreen mode
    const focusHeaderHtml = `
        <div class="focus-header">
            <button id="focus-exit-btn" class="focus-nav-btn" title="Exit focus mode">
                <span>✕</span>
                <span class="focus-btn-label">Exit</span>
            </button>
            <div class="focus-title-area">
                <span class="focus-title">${escapeHtml(title)}</span>
                <span id="focus-position" class="focus-position"></span>
            </div>
            <button id="focus-controls-toggle" class="focus-nav-btn" title="Toggle controls">
                <span>⚙️</span>
                <span class="focus-btn-label">Controls</span>
            </button>
        </div>
    `;

    // Header controls row
    const headerControlsHtml = `
        <div class="header-controls">
            <button id="flag-btn" class="flag-btn" title="Report an issue">🚩 Report</button>
            <button id="work-controls-toggle" class="disclosure-btn" title="Toggle controls">⚙️ Controls <span class="disclosure-arrow">${controlsCollapsed ? '▼' : '▲'}</span></button>
            <button id="info-toggle" class="disclosure-btn" title="Toggle info">🎵 Info <span class="disclosure-arrow">${infoBarCollapsed ? '▼' : '▲'}</span></button>
        </div>
    `;

    // Info disclosure content
    const infoContentHtml = `
        <div id="info-content" class="info-content ${infoBarCollapsed ? 'hidden' : ''}">
            <div class="info-details">
                ${infoItems.join('')}
            </div>
            <div class="info-tags">
                <div class="info-tags-label">Tags:</div>
                <div class="song-tags-row">
                    <span id="song-tags-container" class="song-tags" data-song-id="${currentWork.id}">${tagsHtml}</span>
                    ${isLoggedIn ? `<button class="add-tags-btn" data-song-id="${currentWork.id}">+ Add your own</button>` : ''}
                </div>
            </div>
        </div>
    `;

    // Corner nav buttons for focus mode list navigation
    const cornerNavHtml = `
        <button id="focus-prev-btn" class="focus-corner-nav focus-corner-prev" title="Previous song (←)">
            <span class="corner-nav-arrow">←</span>
        </button>
        <button id="focus-next-btn" class="focus-corner-nav focus-corner-next" title="Next song (→)">
            <span class="corner-nav-arrow">→</span>
        </button>
    `;

    header.innerHTML = `
        ${focusHeaderHtml}
        <div class="song-header">
            <div class="song-header-left">
                <div class="song-title-row">
                    <span class="song-title">${escapeHtml(title)}</span>
                    ${versionHtml}
                    <button id="add-to-list-btn" class="add-to-list-btn" title="Add to list">+ Lists</button>
                    <button id="focus-btn" class="focus-btn" title="Focus mode (F)">⛶ Focus</button>
                </div>
            </div>
            ${headerControlsHtml}
        </div>
        <div id="work-controls-content" class="work-controls-content ${controlsCollapsed ? 'hidden' : ''}">
            <!-- Controls are injected here by renderTablaturePart or renderChordProPart -->
        </div>
        ${infoContentHtml}
        ${cornerNavHtml}
    `;

    // Wire up version button click handler
    const versionBtn = header.querySelector('.see-versions-btn');
    if (versionBtn) {
        versionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showVersionPicker(versionBtn.dataset.groupId);
        });
    }

    // Wire up disclosure toggles
    const controlsToggle = header.querySelector('#work-controls-toggle');
    const controlsContent = header.querySelector('#work-controls-content');
    if (controlsToggle && controlsContent) {
        controlsToggle.addEventListener('click', () => {
            const isCollapsed = controlsContent.classList.toggle('hidden');
            localStorage.setItem('workControlsCollapsed', isCollapsed);
            const arrow = controlsToggle.querySelector('.disclosure-arrow');
            if (arrow) arrow.textContent = isCollapsed ? '▼' : '▲';
        });
    }

    const infoToggle = header.querySelector('#info-toggle');
    const infoContent = header.querySelector('#info-content');
    if (infoToggle && infoContent) {
        infoToggle.addEventListener('click', () => {
            const isCollapsed = infoContent.classList.toggle('hidden');
            localStorage.setItem('infoBarCollapsed', isCollapsed);
            const arrow = infoToggle.querySelector('.disclosure-arrow');
            if (arrow) arrow.textContent = isCollapsed ? '▼' : '▲';
        });
    }

    return header;
}

/**
 * Render part selector tabs
 */
function renderPartSelector() {
    const selector = document.createElement('div');
    selector.className = 'part-selector';

    const tabs = availableParts.map(part => {
        const isActive = part === activePart;
        const icon = part.type === 'tablature'
            ? (INSTRUMENT_ICONS[part.instrument] || '🎵')
            : '📄';

        return `
            <button class="part-tab ${isActive ? 'active' : ''}"
                    data-part-type="${part.type}"
                    data-part-instrument="${part.instrument || ''}"
                    data-part-file="${part.file || ''}">
                <span class="part-icon">${icon}</span>
                <span class="part-label">${escapeHtml(part.label)}</span>
            </button>
        `;
    }).join('');

    selector.innerHTML = tabs;

    // Add click handlers
    selector.querySelectorAll('.part-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const partType = tab.dataset.partType;
            const partInstrument = tab.dataset.partInstrument;
            const partFile = tab.dataset.partFile;

            // Find matching part
            activePart = availableParts.find(p =>
                p.type === partType &&
                (p.instrument || '') === partInstrument &&
                (p.file || '') === partFile
            );

            renderWorkView();

            // Update URL
            const partId = activePart?.instrument || activePart?.type;
            const hash = `#work/${currentWork.id}/parts/${partId}`;
            history.pushState({ workId: currentWork.id, partId }, '', hash);
        });
    });

    return selector;
}

/**
 * Render a specific part
 */
async function renderPart(part, container) {
    if (part.format === 'chordpro' || part.type === 'lead-sheet') {
        renderChordProPart(part, container);
    } else if (part.format === 'otf' || part.type === 'tablature') {
        await renderTablaturePart(part, container);
    } else {
        container.innerHTML = `<p class="error">Unknown part format: ${part.format}</p>`;
    }
}

/**
 * Render ChordPro lead sheet
 */
function renderChordProPart(part, container) {
    const content = part.content || currentWork.content;
    if (!content) {
        container.innerHTML = '<p class="error">No content available</p>';
        return;
    }

    setCurrentChordpro(content);

    // Detect key
    const sections = parseChordPro(content);
    const allChords = [];
    sections.forEach(section => {
        section.lines.forEach(line => {
            if (line.chords) {
                line.chords.forEach(c => allChords.push(c.chord));
            }
        });
    });

    const detected = detectKey(allChords);
    if (detected) {
        setOriginalDetectedKey(detected.key);
        setOriginalDetectedMode(detected.mode);
        if (!currentDetectedKey) {
            setCurrentDetectedKey(detected.key);
        }
    }

    // Inject controls into the header's controls content area
    const controls = createLeadSheetControls();
    const controlsContent = document.getElementById('work-controls-content');
    if (controlsContent) {
        controlsContent.innerHTML = '';
        controlsContent.appendChild(controls);
    } else {
        // Fallback: add controls to container if header not found
        container.appendChild(controls);
    }

    // Create content area
    const contentArea = document.createElement('div');
    contentArea.className = 'chordpro-content';
    container.appendChild(contentArea);

    renderChordProContent(sections, contentArea);
}

/**
 * Create controls for lead sheet
 */
function createLeadSheetControls() {
    const controls = document.createElement('div');
    controls.className = 'leadsheet-controls';

    // Key selector
    const keySelector = document.createElement('select');
    keySelector.className = 'key-selector';
    KEYS.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = k;
        if (k === currentDetectedKey) opt.selected = true;
        keySelector.appendChild(opt);
    });

    keySelector.addEventListener('change', () => {
        setCurrentDetectedKey(keySelector.value);
        renderWorkView();
    });

    controls.innerHTML = `<label>Key:</label>`;
    controls.appendChild(keySelector);

    return controls;
}

/**
 * Render ChordPro sections to HTML
 */
function renderChordProContent(sections, container) {
    const fontMultiplier = FONT_SIZES[fontSizeLevel] || 1;
    const transpose = currentDetectedKey && originalDetectedKey
        ? getSemitonesBetweenKeys(originalDetectedKey, currentDetectedKey)
        : 0;

    let html = '';
    const seenPatterns = new Set();

    sections.forEach((section, idx) => {
        // Section label
        if (showSectionLabels && section.label) {
            html += `<div class="section-label">${escapeHtml(section.label)}</div>`;
        }

        // Section content
        html += `<div class="section${compactMode ? ' compact' : ''}">`;

        section.lines.forEach(line => {
            if (line.type === 'empty') {
                html += '<div class="empty-line"></div>';
                return;
            }

            if (line.type === 'comment') {
                html += `<div class="comment">${escapeHtml(line.text)}</div>`;
                return;
            }

            // Chord line
            html += '<div class="line">';

            if (line.chords && line.chords.length > 0 && chordDisplayMode !== 'none') {
                html += '<div class="chord-line">';

                // Build pattern for "first" mode
                const pattern = line.chords.map(c => c.chord).join('|');
                const shouldHide = chordDisplayMode === 'first' && seenPatterns.has(pattern);
                if (chordDisplayMode === 'first') seenPatterns.add(pattern);

                let lastPos = 0;
                line.chords.forEach(c => {
                    // Spacing
                    const spaces = c.position - lastPos;
                    if (spaces > 0) {
                        html += `<span class="chord-space">${'&nbsp;'.repeat(spaces)}</span>`;
                    }

                    // Chord
                    let chord = c.chord;
                    if (transpose !== 0) {
                        chord = transposeChord(chord, transpose);
                    }
                    if (nashvilleMode && currentDetectedKey) {
                        chord = toNashville(chord, currentDetectedKey);
                    }

                    if (shouldHide) {
                        html += `<span class="chord hidden">${escapeHtml(chord)}</span>`;
                    } else {
                        html += `<span class="chord">${escapeHtml(chord)}</span>`;
                    }

                    lastPos = c.position + c.chord.length;
                });

                html += '</div>';
            }

            // Lyrics line
            if (line.lyrics) {
                html += `<div class="lyrics">${escapeHtml(line.lyrics)}</div>`;
            }

            html += '</div>';
        });

        html += '</div>';
    });

    container.innerHTML = html;
    container.style.fontSize = `${fontMultiplier}em`;
}

/**
 * Render tablature part
 */
async function renderTablaturePart(part, container) {
    container.innerHTML = '<div class="loading">Loading tablature...</div>';

    try {
        // Load OTF data
        let otf = loadedTablature;
        if (!otf || otf._partFile !== part.file) {
            const response = await fetch(part.file);
            if (!response.ok) throw new Error(`Failed to load ${part.file}`);
            otf = await response.json();
            otf._partFile = part.file;
            setLoadedTablature(otf);
        }

        container.innerHTML = '';
        trackRenderers = {};

        // Inject controls into the header's controls content area
        const controls = createTablatureControls(otf, part);
        const controlsContent = document.getElementById('work-controls-content');
        if (controlsContent) {
            controlsContent.innerHTML = '';
            controlsContent.appendChild(controls);
        } else {
            // Fallback: add controls to container if header not found
            container.appendChild(controls);
        }

        // Create container for all tracks
        const allTracksContainer = document.createElement('div');
        allTracksContainer.className = 'tablature-all-tracks';
        container.appendChild(allTracksContainer);

        const timeSignature = otf.metadata?.time_signature || '4/4';
        const ticksPerBeat = otf.timing?.ticks_per_beat || 480;

        // Determine which track is the "lead" (matches part instrument, or first track)
        let leadTrackId = otf.tracks[0]?.id;
        if (part.instrument && otf.tracks.length > 1) {
            const matchingTrack = otf.tracks.find(t =>
                t.instrument?.includes(part.instrument) ||
                t.id?.includes(part.instrument)
            );
            if (matchingTrack) {
                leadTrackId = matchingTrack.id;
            }
        }

        // Render each track in its own section
        for (const track of otf.tracks) {
            let notation = otf.notation[track.id];
            if (!notation || notation.length === 0) continue;

            const isLead = track.id === leadTrackId || track.role === 'lead';
            const isMandolin = track.instrument?.includes('mandolin') || track.id?.includes('mandolin');

            // Skip mandolin backup tracks - chop notation is often buggy in TEF files
            // Only show mandolin if it's the lead/melody track
            if (isMandolin && !isLead) {
                continue;
            }

            // Apply reading list: either compact (with repeat signs) or expanded (unrolled)
            if (showRepeatsCompact && otf.reading_list && otf.reading_list.length > 0) {
                notation = prepareCompactNotation(notation, otf.reading_list);
            } else {
                notation = expandNotationWithReadingList(notation, otf.reading_list);
            }
            const icon = INSTRUMENT_ICONS[track.instrument] ||
                        (track.id.includes('banjo') ? '🪕' :
                         track.id.includes('mandolin') ? '🎸' :
                         track.id.includes('guitar') ? '🎸' :
                         track.id.includes('fiddle') ? '🎻' : '🎵');

            // Create track section with header
            const trackSection = document.createElement('div');
            trackSection.className = `tablature-track-section${isLead ? '' : ' backup-track'}`;
            trackSection.dataset.trackId = track.id;
            trackSection.style.display = isLead ? 'block' : 'none';

            const trackHeader = document.createElement('div');
            trackHeader.className = 'tablature-track-header';
            trackHeader.innerHTML = `
                <span class="track-icon">${icon}</span>
                <span class="track-name">${track.id}</span>
                ${!isLead ? '<span class="track-role">(backup)</span>' : ''}
            `;
            trackSection.appendChild(trackHeader);

            const tabContainer = document.createElement('div');
            tabContainer.className = 'tablature-container';
            trackSection.appendChild(tabContainer);

            allTracksContainer.appendChild(trackSection);

            // Create renderer for this track
            const renderer = new TabRenderer(tabContainer);
            renderer.render(track, notation, ticksPerBeat, timeSignature);
            trackRenderers[track.id] = renderer;
        }

        // Wire up track visibility toggles
        const trackCheckboxes = controls.querySelectorAll('.track-checkbox');
        trackCheckboxes.forEach(checkbox => {
            // Set initial checked state to match visibility
            const trackId = checkbox.dataset.trackId;
            const trackSection = allTracksContainer.querySelector(`[data-track-id="${trackId}"]`);
            if (trackSection) {
                checkbox.checked = trackSection.style.display !== 'none';
            }

            checkbox.addEventListener('change', () => {
                const section = allTracksContainer.querySelector(`[data-track-id="${trackId}"]`);
                if (section) {
                    section.style.display = checkbox.checked ? 'block' : 'none';
                }
            });
        });

        // Wire up repeat toggle (re-renders with repeat signs or unrolled)
        const repeatCheckbox = controls.querySelector('.tab-repeat-checkbox');
        const repeatLabel = controls.querySelector('.tab-repeat-label');
        if (repeatCheckbox) {
            repeatCheckbox.addEventListener('change', () => {
                showRepeatsCompact = repeatCheckbox.checked;
                if (repeatLabel) {
                    repeatLabel.textContent = showRepeatsCompact ? 'Repeats' : 'Unrolled';
                }
                // Re-render tablature with new mode
                renderTablaturePart(part, container);
            });
        }

        // Set up player with lead track renderer for visualization
        const leadRenderer = trackRenderers[leadTrackId] || Object.values(trackRenderers)[0];
        setupTablaturePlayer(otf, controls, leadRenderer);

        // Add attribution section for Banjo Hangout tabs
        if (part.source === 'banjo-hangout') {
            const attribution = document.createElement('div');
            attribution.className = 'tab-attribution';

            let attrHtml = '<div class="attribution-content">';

            // Author credit with link
            if (part.author) {
                attrHtml += '<span class="attribution-item">Tabbed by ';
                if (part.author_url) {
                    attrHtml += `<a href="${part.author_url}" target="_blank" rel="noopener">${escapeHtml(part.author)}</a>`;
                } else {
                    attrHtml += escapeHtml(part.author);
                }
                attrHtml += '</span>';
            }

            // Source link
            if (part.source_page_url) {
                attrHtml += `<span class="attribution-item"><a href="${part.source_page_url}" target="_blank" rel="noopener">View on Banjo Hangout</a></span>`;
            }

            attrHtml += '</div>';

            // Disclaimer
            attrHtml += '<div class="attribution-disclaimer">';
            attrHtml += 'This tab was converted from TablEdit format and may contain minor errors. ';
            attrHtml += 'Please report issues if you notice problems.';
            attrHtml += '</div>';

            attribution.innerHTML = attrHtml;
            container.appendChild(attribution);
        }

    } catch (e) {
        console.error('Error loading tablature:', e);
        container.innerHTML = `<div class="error">Failed to load tablature: ${e.message}</div>`;
    }
}

/**
 * Create tablature controls
 */
function createTablatureControls(otf, part) {
    const defaultTempo = otf.metadata?.tempo || 100;
    const originalKey = currentWork.key || 'G';

    // Filter out mandolin backup tracks (chop notation is often buggy)
    const filteredTracks = otf.tracks.filter(track => {
        const isMandolin = track.instrument?.includes('mandolin') || track.id?.includes('mandolin');
        const isLead = track.role === 'lead' || track.instrument?.includes('banjo') ||
                       (part.instrument && track.instrument?.includes(part.instrument));
        return !isMandolin || isLead;
    });

    // Build track mixer if multiple tracks
    const trackMixerHtml = filteredTracks.length > 1 ? `
        <div class="tab-track-mixer">
            <span class="mixer-label">Tracks:</span>
            ${filteredTracks.map(track => {
                const icon = track.instrument?.includes('banjo') ? '🪕' :
                            track.instrument?.includes('guitar') ? '🎸' :
                            track.instrument?.includes('mandolin') ? '🎸' :
                            track.instrument?.includes('bass') ? '🎸' :
                            track.instrument?.includes('fiddle') ? '🎻' : '🎵';
                const isLead = track.role === 'lead' || track.instrument?.includes('banjo');
                return `<label class="track-toggle" title="${track.id}">
                    <input type="checkbox" class="track-checkbox" data-track-id="${track.id}" ${isLead ? 'checked' : ''}>
                    <span class="track-icon">${icon}</span>
                    <span class="track-name">${track.id}</span>
                </label>`;
            }).join('')}
        </div>
    ` : '';

    // Only show repeat toggle if there's a reading list
    const hasReadingList = otf.reading_list && otf.reading_list.length > 0;
    const repeatToggleHtml = hasReadingList ? `
        <label class="tab-repeat-toggle" title="Toggle repeat notation style">
            <input type="checkbox" class="tab-repeat-checkbox" ${showRepeatsCompact ? 'checked' : ''}>
            <span class="tab-repeat-label">${showRepeatsCompact ? 'Repeats' : 'Unrolled'}</span>
        </label>
    ` : '';

    // Build key options with capo indicators
    const keyOptions = Object.keys(KEYS).filter(k => KEYS[k].mode === 'major').map(k => {
        const keyList = Object.keys(KEYS).filter(key => KEYS[key].mode === 'major');
        const capo = (keyList.indexOf(k) - keyList.indexOf(originalKey) + 12) % 12;
        const capoLabel = capo === 0 ? '' : ` (Capo ${capo})`;
        return `<option value="${k}" data-capo="${capo}" ${k === originalKey ? 'selected' : ''}>${k}${capoLabel}</option>`;
    }).join('');

    const controls = document.createElement('div');
    controls.className = 'tab-controls';
    // Control order matches lyrics/ABC: Size → Key → Tempo → Play
    controls.innerHTML = `
        <div class="qc-group">
            <button class="tab-size-down qc-btn" title="Decrease size">−</button>
            <span class="qc-label">Aa</span>
            <button class="tab-size-up qc-btn" title="Increase size">+</button>
        </div>
        <div class="qc-group qc-key-group">
            <button class="tab-key-down qc-btn" title="Transpose down">−</button>
            <select class="tab-key-select qc-key-btn" title="Select key">
                ${keyOptions}
            </select>
            <button class="tab-key-up qc-btn" title="Transpose up">+</button>
        </div>
        <div class="qc-group">
            <button class="tab-tempo-down qc-btn" title="Decrease tempo">−</button>
            <span class="qc-label tab-tempo-display">${defaultTempo}</span>
            <button class="tab-tempo-up qc-btn" title="Increase tempo">+</button>
        </div>
        <button class="tab-play-btn qc-toggle-btn">▶ Play</button>
        <button class="tab-stop-btn qc-toggle-btn" disabled>⏹ Stop</button>
        <label class="tab-metronome-toggle">
            <input type="checkbox" class="tab-metronome-checkbox">
            <span class="tab-metronome-icon">🥁</span>
        </label>
        ${repeatToggleHtml}
        <span class="tab-position"></span>
        <span class="tab-capo-indicator"></span>
        ${trackMixerHtml}
    `;

    return controls;
}

/**
 * Set up tablature player with controls
 */
function setupTablaturePlayer(otf, controls, renderer) {
    if (!tablaturePlayer) {
        setTablaturePlayer(new TabPlayer());
    }

    const player = tablaturePlayer;
    const playBtn = controls.querySelector('.tab-play-btn');
    const stopBtn = controls.querySelector('.tab-stop-btn');
    const posEl = controls.querySelector('.tab-position');
    const tempoDisplay = controls.querySelector('.tab-tempo-display');
    const tempoDown = controls.querySelector('.tab-tempo-down');
    const tempoUp = controls.querySelector('.tab-tempo-up');
    const keySelect = controls.querySelector('.tab-key-select');
    const keyDown = controls.querySelector('.tab-key-down');
    const keyUp = controls.querySelector('.tab-key-up');
    const capoIndicator = controls.querySelector('.tab-capo-indicator');
    const metronomeCheckbox = controls.querySelector('.tab-metronome-checkbox');
    const sizeDown = controls.querySelector('.tab-size-down');
    const sizeUp = controls.querySelector('.tab-size-up');

    let currentTempo = parseInt(tempoDisplay.textContent, 10);
    let currentCapo = 0;
    let currentScale = 1.0; // Scale factor for tablature size

    // Build tick mapping for compact mode visualization
    // In compact mode, playback ticks are expanded but display is compact
    const timeSignature = otf.metadata?.time_signature || '4/4';
    const ticksPerBeat = otf.timing?.ticks_per_beat || 480;
    const beatsPerMeasure = parseInt(timeSignature.split('/')[0], 10) || 4;
    const ticksPerMeasure = ticksPerBeat * beatsPerMeasure;
    const tickMapper = showRepeatsCompact
        ? buildTickMapping(otf.reading_list, ticksPerMeasure)
        : (tick) => tick;

    // Playback visualization callbacks (with tick mapping for compact mode)
    player.onTick = (absTick) => renderer.updateBeatCursor(tickMapper(absTick));
    player.onNoteStart = (absTick) => renderer.highlightNote(tickMapper(absTick));
    player.onNoteEnd = (absTick) => renderer.clearNoteHighlight(tickMapper(absTick));

    // Size controls - scale the tablature
    const updateSize = (delta) => {
        currentScale = Math.max(0.6, Math.min(1.6, currentScale + delta));
        const container = document.querySelector('.tablature-container');
        if (container) {
            container.style.setProperty('--tab-scale', currentScale);
            // Trigger reflow if renderer supports it
            if (typeof renderer.reflow === 'function') {
                renderer.reflow();
            }
        }
        // Update button states
        sizeDown.disabled = currentScale <= 0.6;
        sizeUp.disabled = currentScale >= 1.6;
    };

    sizeDown?.addEventListener('click', () => updateSize(-0.1));
    sizeUp?.addEventListener('click', () => updateSize(0.1));

    // Metronome
    metronomeCheckbox?.addEventListener('change', () => {
        player.metronomeEnabled = metronomeCheckbox.checked;
    });

    // Tempo controls
    const updateTempoButtons = () => {
        tempoDown.disabled = currentTempo <= 40;
        tempoUp.disabled = currentTempo >= 280;
    };

    const setTempo = (val) => {
        currentTempo = Math.max(40, Math.min(280, val));
        tempoDisplay.textContent = currentTempo;
        updateTempoButtons();
    };

    tempoDown?.addEventListener('click', () => setTempo(currentTempo - 5));
    tempoUp?.addEventListener('click', () => setTempo(currentTempo + 5));

    // Key/capo controls
    const updateCapoIndicator = () => {
        capoIndicator.textContent = currentCapo > 0 ? `Capo ${currentCapo}` : '';
    };

    const selectKeyByIndex = (index) => {
        const options = keySelect.options;
        const newIndex = Math.max(0, Math.min(options.length - 1, index));
        keySelect.selectedIndex = newIndex;
        currentCapo = parseInt(options[newIndex].dataset.capo, 10) || 0;
        updateCapoIndicator();
    };

    keySelect?.addEventListener('change', () => {
        currentCapo = parseInt(keySelect.options[keySelect.selectedIndex].dataset.capo, 10) || 0;
        updateCapoIndicator();
    });

    keyDown?.addEventListener('click', () => {
        selectKeyByIndex(keySelect.selectedIndex - 1);
    });

    keyUp?.addEventListener('click', () => {
        selectKeyByIndex(keySelect.selectedIndex + 1);
    });

    // Position updates
    player.onPositionUpdate = (elapsed, total) => {
        const fmt = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
        posEl.textContent = `${fmt(elapsed)} / ${fmt(total)}`;
    };

    player.onPlaybackEnd = () => {
        playBtn.textContent = '▶ Play';
        playBtn.classList.remove('playing');
        stopBtn.disabled = true;
        posEl.textContent = '';
        renderer.resetPlaybackVisualization();
    };

    // Get enabled tracks from checkboxes (excluding mandolin backup tracks)
    const getEnabledTrackIds = () => {
        const checkboxes = controls.querySelectorAll('.track-checkbox:checked');
        if (checkboxes.length === 0) {
            // If no checkboxes (single track) or none checked, play filtered tracks
            // Filter out mandolin backup tracks
            return otf.tracks
                .filter(t => {
                    const isMandolin = t.instrument?.includes('mandolin') || t.id?.includes('mandolin');
                    const isLead = t.role === 'lead' || t.instrument?.includes('banjo');
                    return !isMandolin || isLead;
                })
                .map(t => t.id);
        }
        return Array.from(checkboxes).map(cb => cb.dataset.trackId);
    };

    // Play/stop
    playBtn.addEventListener('click', async () => {
        if (player.isPlaying) {
            player.stop();
            playBtn.textContent = '▶ Play';
            playBtn.classList.remove('playing');
            stopBtn.disabled = true;
            renderer.resetPlaybackVisualization();
        } else {
            playBtn.textContent = '⏸ Pause';
            playBtn.classList.add('playing');
            stopBtn.disabled = false;
            const trackIds = getEnabledTrackIds();
            await player.play(otf, { tempo: currentTempo, transpose: currentCapo, trackIds });
        }
    });

    stopBtn.addEventListener('click', () => {
        player.stop();
        playBtn.textContent = '▶ Play';
        playBtn.classList.remove('playing');
        stopBtn.disabled = true;
        posEl.textContent = '';
        renderer.resetPlaybackVisualization();
    });
}

// ============================================
// EXPORTS
// ============================================

export {
    currentWork,
    activePart,
    availableParts,
    buildPartsFromIndex
};
