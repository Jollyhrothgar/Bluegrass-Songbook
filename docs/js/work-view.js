// WorkView - Display works with multiple parts (lead sheets, tablature, etc.)
// Part of the works architecture refactor

import {
    allSongs,
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

import { parseChordPro } from './song-view.js';
import { detectKey, transposeChord, toNashville, getSemitonesBetweenKeys, KEYS } from './chords.js';
import { escapeHtml } from './utils.js';
import { TabRenderer, TabPlayer, INSTRUMENT_ICONS } from './renderers/index.js';

// ============================================
// WORK STATE
// ============================================

let currentWork = null;          // The full work object
let activePart = null;           // Currently displayed part { type, format, file, ... }
let availableParts = [];         // All parts for current work
let tabRenderer = null;          // TabRenderer instance for current tablature

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
        parts.push({
            type: 'lead-sheet',
            format: 'chordpro',
            label: 'Lead Sheet',
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
                default: !song.content  // Default if no lead sheet
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

    // Show the song view panel
    setCurrentView('song');

    // Reset key tracking
    setOriginalDetectedKey(null);
    setOriginalDetectedMode(null);
    setCurrentDetectedKey(null);

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
 * Render work header with metadata
 */
function renderWorkHeader() {
    const header = document.createElement('div');
    header.className = 'work-header';

    const title = currentWork.title || 'Untitled';
    const artist = currentWork.artist || '';
    const key = currentWork.key || '';
    const tempo = currentWork.tempo || currentWork.default_tempo || '';

    let metaHtml = '';
    if (artist) metaHtml += `<span class="work-artist">${escapeHtml(artist)}</span>`;
    if (key) metaHtml += `<span class="work-key">Key: ${escapeHtml(key)}</span>`;
    if (tempo) metaHtml += `<span class="work-tempo">${tempo} BPM</span>`;

    header.innerHTML = `
        <h1 class="work-title">${escapeHtml(title)}</h1>
        ${metaHtml ? `<div class="work-meta">${metaHtml}</div>` : ''}
    `;

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

    // Create controls
    const controls = createLeadSheetControls();
    container.appendChild(controls);

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

        // Create controls
        const controls = createTablatureControls(otf, part);
        container.appendChild(controls);

        // Create tab container
        const tabContainer = document.createElement('div');
        tabContainer.className = 'tablature-container';
        container.appendChild(tabContainer);

        // Render
        const track = otf.tracks[0];
        const notation = otf.notation[track.id];
        tabRenderer = new TabRenderer(tabContainer);
        tabRenderer.render(track, notation, otf.timing?.ticks_per_beat || 480);

        // Set up player
        setupTablaturePlayer(otf, controls, tabRenderer);

    } catch (e) {
        console.error('Error loading tablature:', e);
        container.innerHTML = `<div class="error">Failed to load tablature: ${e.message}</div>`;
    }
}

/**
 * Create tablature controls
 */
function createTablatureControls(otf, part) {
    const defaultTempo = otf.metadata?.tempo || 120;
    const originalKey = currentWork.key || 'G';

    const controls = document.createElement('div');
    controls.className = 'tab-controls';
    controls.innerHTML = `
        <button class="tab-play-btn">▶ Play</button>
        <button class="tab-stop-btn" disabled>⏹ Stop</button>
        <span class="tab-position"></span>
        <label class="tab-metronome-toggle">
            <input type="checkbox" class="tab-metronome-checkbox">
            <span class="tab-metronome-icon">🥁</span>
        </label>
        <div class="tab-key-control">
            <label class="tab-key-label">Key:</label>
            <select class="tab-key-select">
                ${Object.keys(KEYS).filter(k => KEYS[k].mode === 'major').map(k => {
                    const keyList = Object.keys(KEYS).filter(key => KEYS[key].mode === 'major');
                    const capo = (keyList.indexOf(k) - keyList.indexOf(originalKey) + 12) % 12;
                    const capoLabel = capo === 0 ? '' : ` (Capo ${capo})`;
                    return `<option value="${k}" data-capo="${capo}" ${k === originalKey ? 'selected' : ''}>${k}${capoLabel}</option>`;
                }).join('')}
            </select>
            <span class="tab-capo-indicator"></span>
        </div>
        <div class="tab-tempo-control">
            <button class="tab-tempo-btn tab-tempo-down">−</button>
            <input type="number" class="tab-tempo-input" value="${defaultTempo}" min="40" max="280" step="5">
            <button class="tab-tempo-btn tab-tempo-up">+</button>
            <span class="tab-tempo-label">BPM</span>
        </div>
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
    const tempoInput = controls.querySelector('.tab-tempo-input');
    const tempoDown = controls.querySelector('.tab-tempo-down');
    const tempoUp = controls.querySelector('.tab-tempo-up');
    const keySelect = controls.querySelector('.tab-key-select');
    const capoIndicator = controls.querySelector('.tab-capo-indicator');
    const metronomeCheckbox = controls.querySelector('.tab-metronome-checkbox');

    let currentTempo = parseInt(tempoInput.value, 10);
    let currentCapo = 0;

    // Playback visualization callbacks
    player.onTick = (absTick) => renderer.updateBeatCursor(absTick);
    player.onNoteStart = (absTick) => renderer.highlightNote(absTick);
    player.onNoteEnd = (absTick) => renderer.clearNoteHighlight(absTick);

    // Metronome
    metronomeCheckbox.addEventListener('change', () => {
        player.metronomeEnabled = metronomeCheckbox.checked;
    });

    // Tempo controls
    const updateTempoButtons = () => {
        tempoDown.disabled = currentTempo <= 40;
        tempoUp.disabled = currentTempo >= 280;
    };

    const setTempo = (val) => {
        currentTempo = Math.max(40, Math.min(280, val));
        tempoInput.value = currentTempo;
        updateTempoButtons();
    };

    tempoDown.addEventListener('click', () => setTempo(currentTempo - 5));
    tempoUp.addEventListener('click', () => setTempo(currentTempo + 5));
    tempoInput.addEventListener('change', () => setTempo(parseInt(tempoInput.value, 10) || 120));

    // Key/capo
    const updateCapoIndicator = () => {
        capoIndicator.textContent = currentCapo > 0 ? `Capo ${currentCapo}` : '';
    };

    keySelect.addEventListener('change', () => {
        currentCapo = parseInt(keySelect.options[keySelect.selectedIndex].dataset.capo, 10) || 0;
        updateCapoIndicator();
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
            await player.play(otf, { tempo: currentTempo, transpose: currentCapo });
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
