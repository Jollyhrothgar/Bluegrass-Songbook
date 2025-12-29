// Song view and rendering for Bluegrass Songbook

import {
    currentSong, setCurrentSong,
    currentChordpro, setCurrentChordpro,
    allSongs, songGroups,
    compactMode, setCompactMode,
    nashvilleMode, setNashvilleMode,
    twoColumnMode, setTwoColumnMode,
    chordDisplayMode, setChordDisplayMode,
    seenChordPatterns, clearSeenChordPatterns, addSeenChordPattern,
    showSectionLabels, setShowSectionLabels,
    showChordProSource, setShowChordProSource,
    fontSizeLevel, setFontSizeLevel,
    FONT_SIZES,
    currentDetectedKey, setCurrentDetectedKey,
    originalDetectedKey, setOriginalDetectedKey,
    originalDetectedMode, setOriginalDetectedMode,
    historyInitialized,
    // ABC notation state
    showAbcNotation, setShowAbcNotation,
    abcjsRendered, setAbcjsRendered,
    currentAbcContent, setCurrentAbcContent,
    abcTempoBpm, setAbcTempoBpm,
    abcTranspose, setAbcTranspose,
    abcScale, setAbcScale,
    abcSynth, setAbcSynth,
    abcTimingCallbacks, setAbcTimingCallbacks,
    abcIsPlaying, setAbcIsPlaying
} from './state.js';
import { escapeHtml } from './utils.js';
import {
    parseLineWithChords, extractChords, detectKey,
    getSemitonesBetweenKeys, transposeChord, toNashville
} from './chords.js';
import { updateFavoriteButton } from './favorites.js';
import { updateListPickerButton } from './lists.js';
import { renderTagBadges, getTagCategory, formatTagName } from './tags.js';

// DOM element references (set by init)
let songViewEl = null;
let songContentEl = null;
let resultsDivEl = null;
let listPickerDropdownEl = null;
let versionModalEl = null;
let versionModalCloseEl = null;
let versionModalTitleEl = null;
let versionListEl = null;

// Callback references (set by init)
let pushHistoryStateFn = null;
let showViewFn = null;

/**
 * Parse ChordPro content into structured sections
 */
export function parseChordPro(chordpro) {
    const lines = chordpro.split('\n');
    const metadata = {};
    const sections = [];
    let currentSection = null;
    let inAbcBlock = false;
    let abcLines = [];

    for (const line of lines) {
        // Handle ABC notation blocks
        if (line.match(/\{start_of_abc\}/i)) {
            inAbcBlock = true;
            abcLines = [];
            continue;
        }

        if (line.match(/\{end_of_abc\}/i)) {
            inAbcBlock = false;
            // Store ABC as a special section
            if (abcLines.length > 0) {
                sections.push({
                    type: 'abc',
                    label: 'Notation',
                    abc: abcLines.join('\n')
                });
            }
            continue;
        }

        if (inAbcBlock) {
            abcLines.push(line);
            continue;
        }

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

/**
 * Render a single line with chords above lyrics
 */
function renderLine(line, hideChords = false) {
    const { chords, lyrics } = parseLineWithChords(line);

    // No chords mode or hideChords flag - just show lyrics
    if (chords.length === 0 || chordDisplayMode === 'none' || hideChords) {
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

/**
 * Extract chord pattern from a section
 */
function getSectionChordPattern(section) {
    const chords = [];
    for (const line of section.lines) {
        const { chords: lineChords } = parseLineWithChords(line);
        for (const { chord } of lineChords) {
            chords.push(chord);
        }
    }
    return chords.join('-');
}

/**
 * Render a section (verse, chorus, etc.)
 */
function renderSection(section, isRepeatedSection = false, hideChords = false) {
    const lines = section.lines.map(line => renderLine(line, hideChords)).join('');
    const shouldIndent = section.type === 'chorus' || isRepeatedSection;
    const indentClass = shouldIndent ? 'section-indent' : '';
    const labelHtml = showSectionLabels ? `<div class="section-label">${escapeHtml(section.label)}</div>` : '';

    return `
        <div class="song-section ${indentClass}">
            ${labelHtml}
            <div class="section-content">${lines}</div>
        </div>
    `;
}

/**
 * Render a repeat indicator (for compact mode)
 */
function renderRepeatIndicator(label, count, shouldIndent) {
    const indentClass = shouldIndent ? 'section-indent' : '';
    const repeatText = count > 1 ? `(Repeat ${label} ×${count})` : `(Repeat ${label})`;
    return `<div class="section-repeat ${indentClass}">${repeatText}</div>`;
}

/**
 * Render ABC notation using ABCJS library
 */
function renderAbcNotation(abcContent, containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn('ABC container not found:', containerId);
        return;
    }

    // Store content for re-rendering when settings change
    setCurrentAbcContent(abcContent);

    // Check if ABCJS is loaded
    if (typeof ABCJS === 'undefined') {
        console.warn('ABCJS not loaded, showing raw ABC');
        container.innerHTML = `<pre class="abc-fallback">${escapeHtml(abcContent)}</pre>`;
        return;
    }

    try {
        // Clear previous content and reset styles
        container.innerHTML = '';
        container.style.width = '';
        container.style.height = '';

        // Calculate staffwidth to fill container (minus padding)
        const containerWidth = container.parentElement.clientWidth - 32;
        const staffwidth = Math.max(400, containerWidth - 20);

        // Render ABC notation with current settings
        const rendered = ABCJS.renderAbc(containerId, abcContent, {
            staffwidth: staffwidth,
            scale: abcScale,
            add_classes: true,
            visualTranspose: abcTranspose,
            wrap: {
                minSpacing: 1.5,
                maxSpacing: 2.5,
                preferredMeasuresPerLine: 4
            },
            paddingleft: 0,
            paddingright: 0,
            paddingbottom: 30
        });
        setAbcjsRendered(rendered);
    } catch (e) {
        console.error('ABC rendering error:', e);
        container.innerHTML = `<pre class="abc-fallback">${escapeHtml(abcContent)}</pre>`;
    }
}

/**
 * Stop and clean up any existing ABC playback
 */
function stopAbcPlayback() {
    if (abcSynth) {
        abcSynth.stop();
        setAbcSynth(null);
    }
    if (abcTimingCallbacks) {
        abcTimingCallbacks.stop();
        setAbcTimingCallbacks(null);
    }
    setAbcIsPlaying(false);
    // Clear any highlighting
    document.querySelectorAll('.abcjs-playing').forEach(el => {
        el.classList.remove('abcjs-playing');
    });
    // Reset play button
    const playBtn = document.getElementById('abc-play-btn');
    if (playBtn) {
        playBtn.textContent = '▶';
        playBtn.disabled = false;
    }
}

/**
 * Setup ABC playback controls
 */
function setupAbcPlayback() {
    const playBtn = document.getElementById('abc-play-btn');

    if (!playBtn || typeof ABCJS === 'undefined' || !abcjsRendered) {
        return;
    }

    // Stop any existing playback when setting up new controls
    stopAbcPlayback();

    // Clear any previous highlighting
    function clearHighlights() {
        document.querySelectorAll('.abcjs-playing').forEach(el => {
            el.classList.remove('abcjs-playing');
        });
    }

    // Highlight notes during playback
    function onEvent(event) {
        clearHighlights();
        if (event && event.elements) {
            event.elements.forEach(noteElements => {
                noteElements.forEach(el => {
                    el.classList.add('abcjs-playing');
                });
            });
        }
    }

    // Clone button to remove old event listeners
    const newPlayBtn = playBtn.cloneNode(true);
    playBtn.parentNode.replaceChild(newPlayBtn, playBtn);

    newPlayBtn.addEventListener('click', async () => {
        // Toggle: if playing, stop; if stopped, play
        if (abcIsPlaying) {
            stopAbcPlayback();
            return;
        }

        const synth = new ABCJS.synth.CreateSynth();
        setAbcSynth(synth);

        try {
            newPlayBtn.textContent = '⏳';
            newPlayBtn.disabled = true;

            const visualObj = abcjsRendered[0];

            // For tempo control, re-render with tempo directive in ABC
            let playbackAbc = currentAbcContent;
            playbackAbc = playbackAbc.replace(/^Q:.*$/m, '');
            playbackAbc = playbackAbc.replace(/(K:[^\n]*\n)/, `$1Q:1/4=${abcTempoBpm}\n`);

            const playbackVisual = ABCJS.renderAbc('*', playbackAbc, {})[0];

            await synth.init({
                visualObj: playbackVisual,
                options: {
                    soundFontUrl: 'https://paulrosen.github.io/midi-js-soundfonts/abcjs/',
                    midiTranspose: abcTranspose
                }
            });

            await synth.prime();

            // Set up timing callbacks for note highlighting
            const timingCallbacks = new ABCJS.TimingCallbacks(visualObj, {
                eventCallback: onEvent,
                beatCallback: null,
                qpm: abcTempoBpm
            });
            setAbcTimingCallbacks(timingCallbacks);

            synth.start();
            timingCallbacks.start();
            setAbcIsPlaying(true);
            newPlayBtn.textContent = '■';
            newPlayBtn.disabled = false;
        } catch (e) {
            console.error('Playback error:', e);
            newPlayBtn.textContent = '▶';
            newPlayBtn.disabled = false;
            setAbcIsPlaying(false);
        }
    });
}

/**
 * Render song with chords above lyrics
 */
export function renderSong(song, chordpro, isInitialRender = false) {
    if (!songContentEl) return;

    // Reset seen chord patterns for 'first' mode
    clearSeenChordPatterns();

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
    if (isInitialRender || originalDetectedKey === null) {
        setOriginalDetectedKey(detectedKey);
        setOriginalDetectedMode(detectedMode);
        setCurrentDetectedKey(detectedKey);
    }

    // Ensure currentDetectedKey is valid for the available keys
    const majorKeys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'];
    const minorKeys = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm'];
    const availableKeys = originalDetectedMode === 'minor' ? minorKeys : majorKeys;

    if (!availableKeys.includes(currentDetectedKey)) {
        setCurrentDetectedKey(originalDetectedKey || detectedKey || availableKeys[0]);
    }

    // Separate ABC sections from chord sections
    const abcSections = sections.filter(s => s.type === 'abc');
    const chordSections = sections.filter(s => s.type !== 'abc');
    const hasAbc = abcSections.length > 0;
    const hasChords = chordSections.length > 0;

    // Collect ABC content for rendering
    const abcContent = abcSections.map(s => s.abc).join('\n\n');

    // Detect tempo from ABC content (Q: directive) and set initial BPM
    if (abcContent && isInitialRender) {
        const tempoMatch = abcContent.match(/Q:\s*(?:\d+\/\d+=)?(\d+)/);
        setAbcTempoBpm(tempoMatch ? parseInt(tempoMatch[1], 10) : 120);
    }

    const totalCounts = {};
    for (const section of chordSections) {
        totalCounts[section.label] = (totalCounts[section.label] || 0) + 1;
    }

    const seenSections = new Set();
    let sectionsHtml = '';
    let i = 0;

    while (i < chordSections.length) {
        const section = chordSections[i];
        const sectionKey = section.label;
        const isRepeatedSection = totalCounts[sectionKey] > 1;
        const shouldIndent = section.type === 'chorus' || isRepeatedSection;

        // In 'first' mode, check if we've seen this chord pattern before
        let hideChords = false;
        if (chordDisplayMode === 'first') {
            const chordPattern = getSectionChordPattern(section);
            if (chordPattern) {
                if (seenChordPatterns.has(chordPattern)) {
                    hideChords = true;
                } else {
                    addSeenChordPattern(chordPattern);
                }
            }
        }

        if (!seenSections.has(sectionKey)) {
            seenSections.add(sectionKey);
            sectionsHtml += renderSection(section, isRepeatedSection, hideChords);
            i++;
        } else if (compactMode) {
            let consecutiveCount = 0;
            while (i < chordSections.length && chordSections[i].label === sectionKey) {
                consecutiveCount++;
                i++;
            }
            sectionsHtml += renderRepeatIndicator(sectionKey, consecutiveCount, shouldIndent);
        } else {
            sectionsHtml += renderSection(section, isRepeatedSection, hideChords);
            i++;
        }
    }

    const title = metadata.title || song?.title || 'Unknown Title';
    const artist = metadata.artist || song?.artist || '';
    const composer = metadata.writer || metadata.composer || song?.composer || '';
    const sourceUrl = song?.source === 'classic-country' && song?.id
        ? `https://www.classic-country-song-lyrics.com/${song.id}.html`
        : null;
    const bookDisplay = song?.book || null;

    // Build key dropdown options
    const keyOptions = availableKeys.map(k => {
        const isDetected = k === originalDetectedKey;
        const label = isDetected ? `${k} (detected)` : k;
        const selected = k === currentDetectedKey ? 'selected' : '';
        return `<option value="${k}" ${selected}>${label}</option>`;
    }).join('');

    // Check for multiple versions
    const groupId = song?.group_id;
    const versions = groupId ? (songGroups[groupId] || []) : [];
    const otherVersionCount = versions.length - 1;
    const versionHtml = otherVersionCount > 0
        ? `<button class="see-versions-btn" data-group-id="${groupId}">See ${otherVersionCount} other version${otherVersionCount > 1 ? 's' : ''}</button>`
        : '';

    let metaHtml = '';
    if (artist) {
        metaHtml += `<div class="meta-item"><span class="meta-label">Artist:</span> ${escapeHtml(artist)}</div>`;
    }
    if (composer) {
        metaHtml += `<div class="meta-item"><span class="meta-label">Written by:</span> ${escapeHtml(composer)}</div>`;
    }
    if (bookDisplay) {
        const bookUrl = song?.book_url || null;
        const bookHtml = bookUrl
            ? `<a href="${bookUrl}" target="_blank" rel="noopener">${escapeHtml(bookDisplay)}</a>`
            : escapeHtml(bookDisplay);
        metaHtml += `<div class="meta-item"><span class="meta-label">From:</span> ${bookHtml}</div>`;
    }
    if (sourceUrl) {
        metaHtml += `<div class="meta-item"><span class="meta-label">Source:</span> <a href="${sourceUrl}" target="_blank" rel="noopener">${escapeHtml(song.id)}</a></div>`;
    }

    // TuneArch attribution link
    if (song?.tunearch_url) {
        metaHtml += `<div class="meta-item"><span class="meta-label">From:</span> <a href="${song.tunearch_url}" target="_blank" rel="noopener">TuneArch.org</a></div>`;
    }

    // Tags with voting and "add your own" option
    const songTags = song.tags || {};
    const tagNames = Object.keys(songTags);
    const isLoggedIn = window.SupabaseAuth?.isLoggedIn?.() || false;

    // Render tags with voting controls (scores populated async)
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

    // Tags section (separate from meta, full width)
    const tagsRowHtml = `
        <div class="song-tags-section">
            <div class="song-tags-row">
                <span id="song-tags-container" class="song-tags" data-song-id="${song.id}">${tagsHtml}</span>
                ${isLoggedIn ? `<button class="add-tags-btn" data-song-id="${song.id}">+ Add your own</button>` : ''}
            </div>
            <div id="add-tags-form" class="add-tags-form hidden">
                <div class="add-tags-header">Add your own tags (comma-separated)</div>
                <div class="add-tags-input-row">
                    <input type="text" id="genre-suggestion-input"
                           placeholder="e.g., driving, lonesome, parking lot jam"
                           maxlength="200">
                    <button id="submit-tags-btn">Submit</button>
                </div>
                <div id="tag-preview" class="tag-preview hidden"></div>
                <div id="tag-error" class="tag-error hidden"></div>
                <div class="add-tags-note">
                    We're learning how bluegrass players describe their music.
                    Your suggestions help shape future categories.
                </div>
            </div>
        </div>
    `;

    // Build view toggle only for hybrid songs (both ABC and chords)
    const viewToggleHtml = (hasAbc && hasChords) ? `
        <div class="view-toggle">
            <button id="view-chords-btn" class="toggle-btn ${!showAbcNotation ? 'active' : ''}">Chords</button>
            <button id="view-abc-btn" class="toggle-btn ${showAbcNotation ? 'active' : ''}">Notation</button>
        </div>
    ` : '';

    // ABC notation view HTML
    const showAbcView = hasAbc && (!hasChords || showAbcNotation);

    // Build transpose options (+6 to -6 semitones)
    const transposeOptions = [];
    for (let t = 6; t >= -6; t--) {
        const label = t === 0 ? 'Original' : (t > 0 ? `+${t}` : `${t}`);
        transposeOptions.push(`<option value="${t}" ${abcTranspose === t ? 'selected' : ''}>${label}</option>`);
    }

    const abcViewHtml = hasAbc ? `
        <div id="abc-view" class="abc-view ${showAbcView ? '' : 'hidden'}">
            <fieldset class="render-options-fieldset">
                <legend>Controls</legend>
                <div class="render-options">
                    <div class="control-box">
                        <span class="control-box-label">Transpose</span>
                        <select id="abc-transpose-select" class="abc-select">${transposeOptions.join('')}</select>
                    </div>
                    <div class="control-box">
                        <span class="control-box-label">Size</span>
                        <div class="font-size-buttons">
                            <button id="abc-size-decrease" class="font-btn" ${abcScale <= 0.7 ? 'disabled' : ''}>−</button>
                            <span id="abc-size-display" class="size-display">${Math.round(abcScale * 100)}%</span>
                            <button id="abc-size-increase" class="font-btn" ${abcScale >= 1.5 ? 'disabled' : ''}>+</button>
                        </div>
                    </div>
                    <div class="control-box">
                        <span class="control-box-label">Tempo</span>
                        <div class="font-size-buttons">
                            <button id="abc-speed-decrease" class="font-btn" ${abcTempoBpm <= 60 ? 'disabled' : ''}>−</button>
                            <input type="number" id="abc-speed-display" class="tempo-input" value="${abcTempoBpm}" min="60" max="240">
                            <button id="abc-speed-increase" class="font-btn" ${abcTempoBpm >= 240 ? 'disabled' : ''}>+</button>
                        </div>
                    </div>
                    <div class="control-box">
                        <span class="control-box-label">Playback</span>
                        <button id="abc-play-btn" class="abc-btn abc-play-btn">▶ Play</button>
                    </div>
                </div>
            </fieldset>
            <div id="abc-notation" class="abc-notation"></div>
        </div>
    ` : '';

    // Chord view HTML (hide if showing ABC view, or if no chords at all)
    const chordViewClass = showAbcView || !hasChords ? 'hidden' : '';

    // Header controls HTML (all display options)
    const headerControlsHtml = hasChords ? `
        <div class="header-controls">
            <div class="header-control-group">
                <span class="header-control-label">Key</span>
                <select id="key-select" class="key-select">${keyOptions}</select>
            </div>
            <div class="header-control-group">
                <span class="header-control-label">Size</span>
                <div class="font-size-buttons">
                    <button id="font-decrease" class="font-btn" ${fontSizeLevel <= -2 ? 'disabled' : ''}>−</button>
                    <button id="font-increase" class="font-btn" ${fontSizeLevel >= 2 ? 'disabled' : ''}>+</button>
                </div>
            </div>
            <div class="header-control-group">
                <span class="header-control-label">Chords</span>
                <select id="chord-mode-select" class="chord-mode-select">
                    <option value="all" ${chordDisplayMode === 'all' ? 'selected' : ''}>All</option>
                    <option value="first" ${chordDisplayMode === 'first' ? 'selected' : ''}>First</option>
                    <option value="none" ${chordDisplayMode === 'none' ? 'selected' : ''}>None</option>
                </select>
            </div>
            <div class="header-control-group">
                <span class="header-control-label">Layout</span>
                <div class="header-checkboxes">
                    <label class="header-checkbox" title="Compact layout">
                        <input type="checkbox" id="compact-checkbox" ${compactMode ? 'checked' : ''}>
                        <span>Compact</span>
                    </label>
                    <label class="header-checkbox" title="Nashville numbers">
                        <input type="checkbox" id="nashville-checkbox" ${nashvilleMode ? 'checked' : ''}>
                        <span>Nashville</span>
                    </label>
                    <label class="header-checkbox" title="Two columns">
                        <input type="checkbox" id="twocol-checkbox" ${twoColumnMode ? 'checked' : ''}>
                        <span>2-Col</span>
                    </label>
                    <label class="header-checkbox" title="Section labels">
                        <input type="checkbox" id="labels-checkbox" ${showSectionLabels ? 'checked' : ''}>
                        <span>Labels</span>
                    </label>
                    <label class="header-checkbox" title="Show source">
                        <input type="checkbox" id="source-checkbox" ${showChordProSource ? 'checked' : ''}>
                        <span>Source</span>
                    </label>
                </div>
            </div>
        </div>
    ` : '';

    songContentEl.innerHTML = `
        <div class="song-header">
            <div class="song-header-left">
                <div class="song-title">${escapeHtml(title)}${versionHtml}</div>
                <div class="song-meta">${metaHtml}</div>
            </div>
            ${headerControlsHtml}
        </div>
        ${tagsRowHtml}
        ${viewToggleHtml}
        ${abcViewHtml}
        <div id="chord-view" class="${chordViewClass}">
            ${showChordProSource ? `
            <div class="source-view">
                <div class="source-pane">
                    <div class="source-header">ChordPro Source</div>
                    <pre class="chordpro-source">${escapeHtml(chordpro)}</pre>
                </div>
                <div class="rendered-pane">
                    <div class="source-header">Rendered</div>
                    <div class="song-body" style="font-size: ${FONT_SIZES[fontSizeLevel]}em">${sectionsHtml}</div>
                </div>
            </div>
            ` : `
            <div class="song-body ${twoColumnMode ? 'two-column' : ''}" style="font-size: ${FONT_SIZES[fontSizeLevel]}em">${sectionsHtml}</div>
            `}
            ${!hasChords && hasAbc ? '<div class="instrumental-notice"><em>Instrumental tune - see notation above</em></div>' : ''}
        </div>
    `;

    // Render ABC notation if showing
    if (showAbcView) {
        setTimeout(() => {
            renderAbcNotation(abcContent, 'abc-notation');
            setupAbcPlayback();
        }, 0);
    }

    // Add event listeners
    setupRenderOptionsListeners(song, chordpro);
    setupAbcControlListeners(song, chordpro, abcContent);
}

/**
 * Load and display tag vote counts
 */
async function loadTagVotes(songId) {
    const container = document.getElementById('song-tags-container');
    if (!container) return;

    // Fetch vote counts and user votes in parallel
    const [votesResult, userVotesResult] = await Promise.all([
        window.SupabaseAuth.fetchTagVotes(songId),
        window.SupabaseAuth.fetchUserTagVotes(songId)
    ]);

    const votes = votesResult.data || {};
    const userVotes = userVotesResult.data || {};

    // Update each tag with vote counts and user vote state
    container.querySelectorAll('.votable-tag').forEach(tagEl => {
        const tagName = tagEl.dataset.tag?.toLowerCase();
        if (!tagName) return;

        const voteData = votes[tagName] || { net: 0, up: 0, down: 0 };
        const userVote = userVotes[tagName] || 0;

        // Update score display
        const scoreEl = tagEl.querySelector('.vote-score');
        if (scoreEl) {
            const net = voteData.net || 0;
            scoreEl.textContent = net === 0 ? '·' : (net > 0 ? `+${net}` : String(net));
            scoreEl.title = `${voteData.up || 0} up, ${voteData.down || 0} down`;
        }

        // Store user's current vote
        tagEl.dataset.userVote = String(userVote);

        // Highlight user's vote
        const upBtn = tagEl.querySelector('.vote-up');
        const downBtn = tagEl.querySelector('.vote-down');
        if (upBtn) upBtn.classList.toggle('voted', userVote === 1);
        if (downBtn) downBtn.classList.toggle('voted', userVote === -1);
    });
}

/**
 * Setup event listeners for render options
 */
function setupRenderOptionsListeners(song, chordpro) {
    const keySelect = document.getElementById('key-select');
    if (keySelect) {
        keySelect.addEventListener('change', (e) => {
            setCurrentDetectedKey(e.target.value);
            renderSong(song, chordpro);
        });
    }

    const seeVersionsBtn = songContentEl.querySelector('.see-versions-btn');
    if (seeVersionsBtn) {
        seeVersionsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showVersionPicker(seeVersionsBtn.dataset.groupId);
        });
    }

    // Genre suggestion handlers
    const addTagsBtn = songContentEl.querySelector('.add-tags-btn');
    if (addTagsBtn) {
        addTagsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const form = document.getElementById('add-tags-form');
            const input = document.getElementById('genre-suggestion-input');
            if (form) {
                form.classList.remove('hidden');
                if (input) input.focus();
            }
        });
    }

    // Helper to parse and clean tags - be forgiving, show what we understood
    function parseTagInput(raw) {
        // Split on commas, semicolons, or multiple spaces
        const parts = raw.split(/[,;]+|\s{2,}/)
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0);

        const cleanedTags = [];
        const warnings = [];

        for (const part of parts) {
            // Strip anything that's not letters, numbers, spaces, or hyphens
            // (no apostrophes, quotes, semicolons, or other SQL-risky chars)
            let cleaned = part.replace(/[^a-z0-9\s\-]/g, '').trim();
            // Collapse multiple spaces
            cleaned = cleaned.replace(/\s+/g, ' ');

            if (cleaned.length === 0) continue;

            // Truncate long tags
            if (cleaned.length > 30) {
                cleaned = cleaned.slice(0, 30).trim();
            }

            // Avoid duplicates
            if (!cleanedTags.includes(cleaned)) {
                cleanedTags.push(cleaned);
            }
        }

        // Limit to 5 tags
        if (cleanedTags.length > 5) {
            warnings.push(`Showing first 5 of ${cleanedTags.length} tags`);
        }

        return { tags: cleanedTags.slice(0, 5), warnings };
    }

    // Live preview as user types
    const suggestionInput = document.getElementById('genre-suggestion-input');
    if (suggestionInput) {
        suggestionInput.addEventListener('input', () => {
            const preview = document.getElementById('tag-preview');
            const errorDiv = document.getElementById('tag-error');
            const raw = suggestionInput.value.trim();

            if (!raw) {
                preview?.classList.add('hidden');
                errorDiv?.classList.add('hidden');
                return;
            }

            const { tags, warnings } = parseTagInput(raw);

            // Show preview - this is the key feedback
            if (tags.length > 0 && preview) {
                preview.innerHTML = '<span class="preview-label">We\'ll add:</span> ' +
                    tags.map(t => `<span class="tag-badge tag-other">${escapeHtml(t)}</span>`).join(' ');
                preview.classList.remove('hidden');
            } else {
                preview?.classList.add('hidden');
            }

            // Show warnings (not errors - just info)
            if (warnings.length > 0 && errorDiv) {
                errorDiv.textContent = warnings[0];
                errorDiv.classList.remove('hidden');
            } else {
                errorDiv?.classList.add('hidden');
            }
        });
    }

    const submitTagsBtn = document.getElementById('submit-tags-btn');
    if (submitTagsBtn) {
        submitTagsBtn.addEventListener('click', async () => {
            const input = document.getElementById('genre-suggestion-input');
            const addBtn = songContentEl.querySelector('.add-tags-btn');
            const errorDiv = document.getElementById('tag-error');
            const raw = input?.value?.trim() || '';

            if (!raw) {
                if (errorDiv) {
                    errorDiv.textContent = 'Type something first!';
                    errorDiv.classList.remove('hidden');
                }
                return;
            }

            const { tags } = parseTagInput(raw);

            if (tags.length === 0) {
                if (errorDiv) {
                    errorDiv.textContent = 'No valid tags found - try words like "driving" or "lonesome"';
                    errorDiv.classList.remove('hidden');
                }
                return;
            }

            const songId = addBtn?.dataset?.songId;
            if (!songId) return;

            // Disable button during submission
            submitTagsBtn.disabled = true;
            submitTagsBtn.textContent = 'Sending...';

            const { error } = await window.SupabaseAuth.submitGenreSuggestions(songId, tags);

            submitTagsBtn.disabled = false;
            submitTagsBtn.textContent = 'Submit';

            if (error) {
                if (errorDiv) {
                    errorDiv.textContent = 'Error: ' + error.message;
                    errorDiv.classList.remove('hidden');
                }
                return;
            }

            // Success feedback
            input.value = '';
            document.getElementById('add-tags-form').classList.add('hidden');
            document.getElementById('tag-preview')?.classList.add('hidden');
            errorDiv?.classList.add('hidden');

            // Brief confirmation
            if (addBtn) {
                const originalText = addBtn.textContent;
                addBtn.textContent = 'Thanks!';
                addBtn.disabled = true;
                setTimeout(() => {
                    addBtn.textContent = originalText;
                    addBtn.disabled = false;
                }, 2000);
            }
        });
    }

    // Tag voting handlers
    const tagsContainer = document.getElementById('song-tags-container');
    if (tagsContainer && window.SupabaseAuth?.isLoggedIn?.()) {
        const songId = tagsContainer.dataset.songId;

        // Fetch and display vote counts
        loadTagVotes(songId);

        // Handle vote button clicks
        tagsContainer.addEventListener('click', async (e) => {
            const voteBtn = e.target.closest('.vote-btn');
            if (!voteBtn) return;

            e.preventDefault();
            const tagEl = voteBtn.closest('.votable-tag');
            const tagName = tagEl?.dataset.tag;
            const voteValue = parseInt(voteBtn.dataset.vote, 10);

            if (!tagName || !songId) return;

            // Get current user vote for this tag
            const currentVote = parseInt(tagEl.dataset.userVote || '0', 10);

            if (currentVote === voteValue) {
                // Clicking same vote removes it
                const { error } = await window.SupabaseAuth.removeTagVote(songId, tagName);
                if (!error) {
                    tagEl.dataset.userVote = '0';
                    loadTagVotes(songId);  // Refresh counts
                }
            } else {
                // Cast new vote
                const { error } = await window.SupabaseAuth.castTagVote(songId, tagName, voteValue);
                if (!error) {
                    tagEl.dataset.userVote = String(voteValue);
                    loadTagVotes(songId);  // Refresh counts
                }
            }
        });
    }

    const chordModeSelect = document.getElementById('chord-mode-select');
    if (chordModeSelect) {
        chordModeSelect.addEventListener('change', (e) => {
            setChordDisplayMode(e.target.value);
            if (chordDisplayMode === 'none') setShowChordProSource(false);
            renderSong(song, chordpro);
        });
    }

    const compactCheckbox = document.getElementById('compact-checkbox');
    if (compactCheckbox) {
        compactCheckbox.addEventListener('change', (e) => {
            setCompactMode(e.target.checked);
            if (compactMode) setShowChordProSource(false);
            renderSong(song, chordpro);
        });
    }

    const nashvilleCheckbox = document.getElementById('nashville-checkbox');
    if (nashvilleCheckbox) {
        nashvilleCheckbox.addEventListener('change', (e) => {
            setNashvilleMode(e.target.checked);
            if (nashvilleMode) setShowChordProSource(false);
            renderSong(song, chordpro);
        });
    }

    const twocolCheckbox = document.getElementById('twocol-checkbox');
    if (twocolCheckbox) {
        twocolCheckbox.addEventListener('change', (e) => {
            setTwoColumnMode(e.target.checked);
            if (twoColumnMode) setShowChordProSource(false);
            renderSong(song, chordpro);
        });
    }

    const labelsCheckbox = document.getElementById('labels-checkbox');
    if (labelsCheckbox) {
        labelsCheckbox.addEventListener('change', (e) => {
            setShowSectionLabels(e.target.checked);
            if (!showSectionLabels) setShowChordProSource(false);
            renderSong(song, chordpro);
        });
    }

    const sourceCheckbox = document.getElementById('source-checkbox');
    if (sourceCheckbox) {
        sourceCheckbox.addEventListener('change', (e) => {
            setShowChordProSource(e.target.checked);
            if (showChordProSource) {
                setChordDisplayMode('all');
                setShowSectionLabels(true);
                setCompactMode(false);
                setNashvilleMode(false);
                setTwoColumnMode(false);
            }
            renderSong(song, chordpro);
        });
    }

    const fontDecrease = document.getElementById('font-decrease');
    if (fontDecrease) {
        fontDecrease.addEventListener('click', () => {
            if (fontSizeLevel > -2) {
                setFontSizeLevel(fontSizeLevel - 1);
                renderSong(song, chordpro);
            }
        });
    }

    const fontIncrease = document.getElementById('font-increase');
    if (fontIncrease) {
        fontIncrease.addEventListener('click', () => {
            if (fontSizeLevel < 2) {
                setFontSizeLevel(fontSizeLevel + 1);
                renderSong(song, chordpro);
            }
        });
    }
}

/**
 * Setup event listeners for ABC controls
 */
function setupAbcControlListeners(song, chordpro, abcContent) {
    // View toggle handlers
    const viewChordsBtn = document.getElementById('view-chords-btn');
    const viewAbcBtn = document.getElementById('view-abc-btn');
    if (viewChordsBtn && viewAbcBtn) {
        viewChordsBtn.addEventListener('click', () => {
            setShowAbcNotation(false);
            renderSong(song, chordpro);
        });
        viewAbcBtn.addEventListener('click', () => {
            setShowAbcNotation(true);
            renderSong(song, chordpro);
        });
    }

    // ABC transpose
    const abcTransposeSelect = document.getElementById('abc-transpose-select');
    if (abcTransposeSelect) {
        abcTransposeSelect.addEventListener('change', (e) => {
            setAbcTranspose(parseInt(e.target.value, 10));
            if (currentAbcContent) {
                renderAbcNotation(currentAbcContent, 'abc-notation');
                setupAbcPlayback();
            }
        });
    }

    // ABC size controls
    const abcSizeDecrease = document.getElementById('abc-size-decrease');
    const abcSizeIncrease = document.getElementById('abc-size-increase');
    const abcSizeDisplay = document.getElementById('abc-size-display');
    if (abcSizeDecrease && abcSizeIncrease) {
        abcSizeDecrease.addEventListener('click', () => {
            if (abcScale > 0.7) {
                setAbcScale(Math.round((abcScale - 0.1) * 10) / 10);
                if (abcSizeDisplay) abcSizeDisplay.textContent = `${Math.round(abcScale * 100)}%`;
                abcSizeDecrease.disabled = abcScale <= 0.7;
                abcSizeIncrease.disabled = abcScale >= 1.5;
                if (currentAbcContent) {
                    renderAbcNotation(currentAbcContent, 'abc-notation');
                    setupAbcPlayback();
                }
            }
        });
        abcSizeIncrease.addEventListener('click', () => {
            if (abcScale < 1.5) {
                setAbcScale(Math.round((abcScale + 0.1) * 10) / 10);
                if (abcSizeDisplay) abcSizeDisplay.textContent = `${Math.round(abcScale * 100)}%`;
                abcSizeDecrease.disabled = abcScale <= 0.7;
                abcSizeIncrease.disabled = abcScale >= 1.5;
                if (currentAbcContent) {
                    renderAbcNotation(currentAbcContent, 'abc-notation');
                    setupAbcPlayback();
                }
            }
        });
    }

    // ABC tempo controls
    const abcSpeedDecrease = document.getElementById('abc-speed-decrease');
    const abcSpeedIncrease = document.getElementById('abc-speed-increase');
    const abcSpeedDisplay = document.getElementById('abc-speed-display');
    if (abcSpeedDecrease && abcSpeedIncrease && abcSpeedDisplay) {
        abcSpeedDecrease.addEventListener('click', () => {
            if (abcTempoBpm > 60) {
                setAbcTempoBpm(abcTempoBpm - 10);
                abcSpeedDisplay.value = abcTempoBpm;
                abcSpeedDecrease.disabled = abcTempoBpm <= 60;
                abcSpeedIncrease.disabled = abcTempoBpm >= 240;
            }
        });
        abcSpeedIncrease.addEventListener('click', () => {
            if (abcTempoBpm < 240) {
                setAbcTempoBpm(abcTempoBpm + 10);
                abcSpeedDisplay.value = abcTempoBpm;
                abcSpeedDecrease.disabled = abcTempoBpm <= 60;
                abcSpeedIncrease.disabled = abcTempoBpm >= 240;
            }
        });
        abcSpeedDisplay.addEventListener('change', () => {
            let val = parseInt(abcSpeedDisplay.value, 10);
            if (isNaN(val)) val = 120;
            val = Math.max(60, Math.min(240, val));
            setAbcTempoBpm(val);
            abcSpeedDisplay.value = val;
            abcSpeedDecrease.disabled = abcTempoBpm <= 60;
            abcSpeedIncrease.disabled = abcTempoBpm >= 240;
        });
    }
}

/**
 * Open a song
 */
export async function openSong(songId) {
    if (!songViewEl || !resultsDivEl) return;

    if (pushHistoryStateFn) {
        pushHistoryStateFn('song', { songId });
    }

    songViewEl.classList.remove('hidden');
    resultsDivEl.classList.add('hidden');
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    // Reset key tracking for new song
    setOriginalDetectedKey(null);
    setOriginalDetectedMode(null);
    setCurrentDetectedKey(null);

    const song = allSongs.find(s => s.id === songId);
    setCurrentSong(song);

    // Track song view in Google Analytics
    if (typeof gtag === 'function' && song) {
        gtag('event', 'page_view', {
            page_title: `${song.title} - ${song.artist || 'Unknown'}`,
            page_location: `${window.location.origin}/song/${songId}`,
            page_path: `/song/${songId}`
        });
    }
    updateFavoriteButton();
    updateListPickerButton();

    if (song && song.content) {
        setCurrentChordpro(song.content);
        renderSong(song, song.content, true);
        return;
    }

    songContentEl.innerHTML = '<div class="loading">Loading song...</div>';

    try {
        let response = await fetch(`data/sources/${songId}.pro`);
        if (!response.ok) {
            response = await fetch(`../sources/classic-country/parsed/${songId}.pro`);
        }
        const chordpro = await response.text();
        setCurrentChordpro(chordpro);
        renderSong(song, chordpro, true);
    } catch (error) {
        songContentEl.innerHTML = `<div class="loading">Error loading song: ${error.message}</div>`;
    }
}

/**
 * Open song from history navigation (without pushing new state)
 */
export async function openSongFromHistory(songId) {
    if (!songViewEl || !resultsDivEl) return;

    songViewEl.classList.remove('hidden');
    resultsDivEl.classList.add('hidden');
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    setOriginalDetectedKey(null);
    setOriginalDetectedMode(null);
    setCurrentDetectedKey(null);

    const song = allSongs.find(s => s.id === songId);
    setCurrentSong(song);
    updateFavoriteButton();
    updateListPickerButton();

    if (song && song.content) {
        setCurrentChordpro(song.content);
        renderSong(song, song.content, true);
    }
}

/**
 * Show version picker modal
 */
export async function showVersionPicker(groupId) {
    if (!versionModalEl || !versionListEl) return;

    const versions = songGroups[groupId] || [];
    if (versions.length === 0) return;

    // Get vote counts for this group
    let voteCounts = {};
    let userVotes = {};

    if (typeof SupabaseAuth !== 'undefined') {
        const { data } = await SupabaseAuth.fetchGroupVotes(groupId);
        voteCounts = data || {};

        if (SupabaseAuth.isLoggedIn()) {
            const songIds = versions.map(v => v.id);
            const { data: uv } = await SupabaseAuth.fetchUserVotes(songIds);
            userVotes = uv || {};
        }
    }

    // Sort versions by vote count (highest first)
    const sortedVersions = [...versions].sort((a, b) => {
        return (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0);
    });

    // Update modal title
    if (versionModalTitleEl) {
        versionModalTitleEl.textContent = versions[0].title || 'Select Version';
    }

    // Render version list
    const currentSongId = currentSong?.id;
    versionListEl.innerHTML = sortedVersions.map(song => {
        const voteCount = voteCounts[song.id] || 0;
        const hasVoted = userVotes[song.id] ? 'voted' : '';
        const isCurrent = song.id === currentSongId;
        const versionLabel = song.version_label || (song.key ? `Key of ${song.key}` : 'Original');
        const versionMeta = [
            song.arrangement_by ? `by ${song.arrangement_by}` : '',
            song.key ? `Key: ${song.key}` : '',
            song.version_type ? song.version_type : '',
            song.nashville ? `${song.nashville.length} chords` : ''
        ].filter(Boolean).join(' • ');

        const firstLine = song.first_line ? song.first_line.substring(0, 60) + (song.first_line.length > 60 ? '...' : '') : '';

        return `
            <div class="version-item ${isCurrent ? 'current' : ''}" data-song-id="${song.id}" data-group-id="${groupId}">
                <div class="version-info">
                    <div class="version-label">${escapeHtml(versionLabel)}${isCurrent ? '<span class="current-badge">viewing</span>' : ''}</div>
                    <div class="version-meta">${escapeHtml(versionMeta)}</div>
                    ${firstLine ? `<div class="version-first-line">"${escapeHtml(firstLine)}"</div>` : ''}
                    ${song.version_notes ? `<div class="version-notes">${escapeHtml(song.version_notes)}</div>` : ''}
                </div>
                <div class="version-votes">
                    <button class="vote-btn ${hasVoted}" data-song-id="${song.id}" data-group-id="${groupId}" title="Vote for this version">
                        <span class="vote-arrow">▲</span>
                    </button>
                    <span class="vote-count">${voteCount}</span>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers for version items
    versionListEl.querySelectorAll('.version-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.vote-btn')) return;
            closeVersionPicker();
            openSong(item.dataset.songId);
        });
    });

    // Add click handlers for vote buttons
    versionListEl.querySelectorAll('.vote-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();

            if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
                alert('Please sign in to vote');
                return;
            }

            const songId = btn.dataset.songId;
            const gId = btn.dataset.groupId;
            const hasVoted = btn.classList.contains('voted');

            if (hasVoted) {
                await SupabaseAuth.removeVote(songId);
                btn.classList.remove('voted');
                const countEl = btn.nextElementSibling;
                countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1);
            } else {
                await SupabaseAuth.castVote(songId, gId);
                btn.classList.add('voted');
                const countEl = btn.nextElementSibling;
                countEl.textContent = parseInt(countEl.textContent) + 1;
            }
        });
    });

    // Show modal
    versionModalEl.classList.remove('hidden');
}

/**
 * Close version picker modal
 */
export function closeVersionPicker() {
    if (versionModalEl) {
        versionModalEl.classList.add('hidden');
    }
}

/**
 * Go back to results
 */
export function goBack() {
    // Close list picker dropdown when navigating away
    if (listPickerDropdownEl) listPickerDropdownEl.classList.add('hidden');

    if (historyInitialized && history.state) {
        history.back();
    } else {
        // Fallback for when there's no history
        if (showViewFn) showViewFn('search');
        if (pushHistoryStateFn) pushHistoryStateFn('search');
    }
}

/**
 * Initialize song view module with DOM elements and callbacks
 */
export function initSongView(options) {
    const {
        songView,
        songContent,
        resultsDiv,
        listPickerDropdown,
        versionModal,
        versionModalClose,
        versionModalTitle,
        versionList,
        pushHistoryState,
        showView,
        backBtn
    } = options;

    songViewEl = songView;
    songContentEl = songContent;
    resultsDivEl = resultsDiv;
    listPickerDropdownEl = listPickerDropdown;
    versionModalEl = versionModal;
    versionModalCloseEl = versionModalClose;
    versionModalTitleEl = versionModalTitle;
    versionListEl = versionList;
    pushHistoryStateFn = pushHistoryState;
    showViewFn = showView;

    // Setup version modal close handlers
    if (versionModalCloseEl) {
        versionModalCloseEl.addEventListener('click', closeVersionPicker);
    }
    if (versionModalEl) {
        versionModalEl.addEventListener('click', (e) => {
            if (e.target === versionModalEl) closeVersionPicker();
        });
    }

    // Setup back button
    if (backBtn) {
        backBtn.addEventListener('click', goBack);
    }
}

/**
 * Get current song (exported for use by other modules)
 */
export function getCurrentSong() {
    return currentSong;
}

/**
 * Get current chordpro (exported for use by other modules)
 */
export function getCurrentChordpro() {
    return currentChordpro;
}
