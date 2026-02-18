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
    currentView,
    // Tablature state (for defensive cleanup only)
    activePartTab, setActivePartTab,
    loadedTablature, setLoadedTablature,
    // ABC notation state
    showAbcNotation, setShowAbcNotation,
    abcjsRendered, setAbcjsRendered,
    currentAbcContent, setCurrentAbcContent,
    abcTempoBpm, setAbcTempoBpm,
    abcTranspose, setAbcTranspose,
    abcScale, setAbcScale,
    abcSynth, setAbcSynth,
    abcTimingCallbacks, setAbcTimingCallbacks,
    abcIsPlaying, setAbcIsPlaying,
    abcPlaybackSession, incrementAbcPlaybackSession,
    // Fullscreen/navigation state
    fullscreenMode, setFullscreenMode,
    listContext, setListContext,
    // Reactive state
    subscribe,
    setCurrentView,
    resolveWorkId
} from './state.js';
import { escapeHtml, isTabOnlyWork, isPlaceholder, hasMultipleParts } from './utils.js';
import {
    parseLineWithChords, extractChords, detectKey,
    getSemitonesBetweenKeys, transposeChord, toNashville,
    CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS
} from './chords.js';
import { updateListPickerButton, updateFavoriteButton, clearListView, openNotesSheet, getSongMetadata, updateSongMetadata } from './lists.js';
import { renderTagBadges, getTagCategory, formatTagName } from './tags.js';
import {
    trackSongView, trackTranspose, trackVersionPicker, trackTagVote,
    trackTagSuggest, endSongView, trackTagsExpand
} from './analytics.js';
import { openFlagModal } from './flags.js';
import { openWork } from './work-view.js';

// DOM element references (set by init)
let songViewEl = null;
let songContentEl = null;
let resultsDivEl = null;
let listPickerDropdownEl = null;
let versionModalEl = null;
let versionModalCloseEl = null;
let versionModalTitleEl = null;
let versionListEl = null;

// Navigation bar elements
let navBarEl = null;
let navPrevBtnEl = null;
let navNextBtnEl = null;
let navPositionEl = null;
let navListNameEl = null;
let fullscreenBtnEl = null;

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
 * Render a single line with chords above lyrics using inline segments.
 * Each chord+lyrics chunk is an inline-block so chords wrap with their lyrics.
 */
function renderLine(line, hideChords = false) {
    const { chords, lyrics } = parseLineWithChords(line);

    // No chords mode or hideChords flag - just show lyrics
    if (chords.length === 0 || chordDisplayMode === 'none' || hideChords) {
        return `<div class="song-line"><div class="lyrics-line">${escapeHtml(lyrics)}</div></div>`;
    }

    // Calculate transposition if key was changed
    const semitones = getSemitonesBetweenKeys(originalDetectedKey, currentDetectedKey);

    // Build inline segments: each chord paired with its following lyrics
    const segments = [];
    let lastLyricsPos = 0;

    for (let i = 0; i < chords.length; i++) {
        const { chord, position } = chords[i];
        const nextPos = i + 1 < chords.length ? chords[i + 1].position : lyrics.length;

        // Lyrics before the first chord (no chord above)
        if (i === 0 && position > 0) {
            const prefixLyrics = lyrics.slice(0, position);
            segments.push({ chord: '', lyrics: prefixLyrics });
        }

        const transposedChord = semitones !== 0 ? transposeChord(chord, semitones) : chord;
        const displayChord = nashvilleMode && currentDetectedKey
            ? toNashville(transposedChord, currentDetectedKey)
            : transposedChord;

        const segmentLyrics = lyrics.slice(position, nextPos);
        segments.push({ chord: displayChord, lyrics: segmentLyrics });
        lastLyricsPos = nextPos;
    }

    // Build HTML from segments
    let html = '';
    for (const seg of segments) {
        const chordHtml = seg.chord
            ? `<span class="cl-chord">${escapeHtml(seg.chord)}</span>`
            : `<span class="cl-chord">&nbsp;</span>`;
        const lyricsHtml = escapeHtml(seg.lyrics) || '&nbsp;';
        html += `<span class="cl-segment">${chordHtml}${lyricsHtml}</span>`;
    }

    return `<div class="song-line cl-line">${html}</div>`;
}

/**
 * Detect wrapped chord-lyrics lines and add a visual indicator.
 * A line is "wrapped" if its rendered height exceeds a single chord+lyrics pair.
 */
function markWrappedLines() {
    const lines = document.querySelectorAll('.cl-line');
    for (const line of lines) {
        // A single unwrapped line has one chord row + one lyrics row.
        // If the element is taller, it wrapped.
        const firstSeg = line.querySelector('.cl-segment');
        if (!firstSeg) continue;
        const singleLineHeight = firstSeg.offsetHeight;
        line.classList.toggle('wrapped', line.scrollHeight > singleLineHeight + 2);
    }
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
        // Use smaller minimum for mobile screens
        const containerWidth = container.parentElement?.clientWidth || window.innerWidth - 32;
        const isMobile = window.innerWidth <= 600;
        const minWidth = isMobile ? 280 : 400;
        const staffwidth = Math.max(minWidth, containerWidth - 32);

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
    // Increment session to cancel any pending async playback initialization
    incrementAbcPlaybackSession();

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

        // Capture current session to detect if playback was cancelled during async init
        const startSession = abcPlaybackSession;

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

            // Check if playback was cancelled during init
            if (abcPlaybackSession !== startSession) {
                synth.stop();
                return;
            }

            await synth.prime();

            // Check again after prime
            if (abcPlaybackSession !== startSession) {
                synth.stop();
                return;
            }

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
            // Only log/update UI if this session is still active
            if (abcPlaybackSession === startSession) {
                console.error('Playback error:', e);
                newPlayBtn.textContent = '▶';
                newPlayBtn.disabled = false;
                setAbcIsPlaying(false);
            }
        }
    });
}

// Note: Tablature rendering for song-view has been removed.
// All tablature-only works now route through openWork() in work-view.js.
// Songs with lead sheet content do not have tablature parts in the current dataset.

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

        // Apply key override from list metadata (e.g., capo'd key for setlists)
        if (listContext && listContext.listId && song?.id) {
            const songMetadata = getSongMetadata(listContext.listId, song.id);
            if (songMetadata?.key) {
                // Map metadata key format to CHROMATIC_MAJOR_KEYS format
                // Metadata uses: "C#/Db", "D#/Eb", etc.
                // CHROMATIC_MAJOR_KEYS uses: C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B
                const keyMap = {
                    'C#/Db': 'C#', 'D#/Eb': 'Eb', 'F#/Gb': 'F#',
                    'G#/Ab': 'Ab', 'A#/Bb': 'Bb'
                };
                const metadataKey = keyMap[songMetadata.key] || songMetadata.key;
                setCurrentDetectedKey(metadataKey);
            }
        }
    }

    // Ensure currentDetectedKey is valid for the available chromatic keys
    const availableKeys = originalDetectedMode === 'minor' ? CHROMATIC_MINOR_KEYS : CHROMATIC_MAJOR_KEYS;

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
    // Link to classic-country home page (individual pages are often broken)
    // For bluegrass-lyrics, use the x_lyrics_url from ChordPro metadata
    const sourceUrl = song?.source === 'classic-country'
        ? 'https://www.classic-country-song-lyrics.com/'
        : (song?.source === 'bluegrass-lyrics' && metadata.x_lyrics_url)
            ? metadata.x_lyrics_url
            : null;
    const bookDisplay = metadata.x_book || song?.book || null;
    const bookUrl = metadata.x_book_url || song?.book_url || null;

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

    // Build artists list: primary artist + covering artists (from grassiness data, sorted by tier)
    const allArtists = new Set();
    if (artist) allArtists.add(artist);
    // Add covering artists from index (already deduped and sorted by tier weight in build)
    const coveringArtists = song?.covering_artists || [];
    coveringArtists.forEach(a => allArtists.add(a));
    // Also include other version artists as fallback
    versions.forEach(v => { if (v.artist) allArtists.add(v.artist); });
    const artistsList = Array.from(allArtists);

    // Build info items for the Info disclosure - "Written by" first, then "Artists"
    let infoItems = [];

    // Written by (composer) - shown first
    if (composer) {
        infoItems.push(`<div class="info-item"><span class="info-label">Written by:</span> ${escapeHtml(composer)}</div>`);
    }

    // Artists list with expand/collapse for long lists
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
    if (bookDisplay) {
        const bookHtml = bookUrl
            ? `<a href="${bookUrl}" target="_blank" rel="noopener">${escapeHtml(bookDisplay)}</a>`
            : escapeHtml(bookDisplay);
        infoItems.push(`<div class="info-item"><span class="info-label">From:</span> ${bookHtml}</div>`);
    }

    // Source attribution for bottom of page
    let sourceHtml = '';
    const sourceDisplayNames = {
        'classic-country': 'Classic Country Song Lyrics',
        'golden-standard': 'Golden Standards Collection',
        'tunearch': 'TuneArch.org',
        'manual': 'Community Contribution',
        'trusted-user': 'Community Contribution',
        'pending': 'Community Contribution',
        'banjo-hangout': 'Banjo Hangout',
        'ultimate-guitar': 'Community Contribution',
        'bluegrass-lyrics': 'BluegrassLyrics.com'
    };
    if (sourceUrl) {
        const sourceName = sourceDisplayNames[song?.source] || 'Source';
        sourceHtml = `<div class="song-source"><span class="source-label">Source:</span> <a href="${sourceUrl}" target="_blank" rel="noopener">${sourceName}</a></div>`;
    } else if (song?.source === 'golden-standard' && bookUrl) {
        const bookName = bookDisplay || 'Golden Standards Collection';
        sourceHtml = `<div class="song-source"><span class="source-label">Source:</span> <a href="${bookUrl}" target="_blank" rel="noopener">${escapeHtml(bookName)}</a></div>`;
    } else if (song?.tunearch_url) {
        sourceHtml = `<div class="song-source"><span class="source-label">Source:</span> <a href="${song.tunearch_url}" target="_blank" rel="noopener">TuneArch.org</a></div>`;
    } else if (song?.source && sourceDisplayNames[song.source]) {
        sourceHtml = `<div class="song-source"><span class="source-label">Source:</span> ${sourceDisplayNames[song.source]}</div>`;
    }

    // Tags with voting and "add your own" option
    const songTags = song?.tags || {};
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

    // Info disclosure state
    const infoBarCollapsed = localStorage.getItem('infoBarCollapsed') !== 'false'; // Default collapsed

    // Info disclosure content (artist, composer, book + tags)
    const infoContentHtml = `
        <div id="info-content" class="info-content ${infoBarCollapsed ? 'hidden' : ''}">
            <div class="info-details">
                ${infoItems.join('')}
            </div>
            <div class="info-tags">
                <div class="info-tags-label">Tags:</div>
                <div class="song-tags-row">
                    <span id="song-tags-container" class="song-tags" data-song-id="${song?.id || ''}">${tagsHtml}</span>
                    ${isLoggedIn ? `<button class="add-tags-btn" data-song-id="${song?.id || ''}">+ Add your own</button>` : ''}
                </div>
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

    // Check for tablature parts
    const tabParts = song?.tablature_parts || [];
    const hasTablature = tabParts.length > 0;
    const hasLeadSheet = hasChords || hasAbc;

    // Build part tabs for songs with multiple content types
    let partTabsHtml = '';
    if (hasTablature && hasLeadSheet) {
        const tabLabel = tabParts.length === 1
            ? tabParts[0].label || 'Tab'
            : `Tab (${tabParts.length})`;
        partTabsHtml = `
            <div class="part-tabs">
                <button class="part-tab ${activePartTab === 'lead-sheet' ? 'active' : ''}" data-part="lead-sheet">
                    Lyrics & Chords
                </button>
                <button class="part-tab ${activePartTab === 'tablature' ? 'active' : ''}" data-part="tablature">
                    ${escapeHtml(tabLabel)}
                </button>
            </div>
        `;
    } else if (hasTablature && !hasLeadSheet) {
        // Tablature-only song - no tabs needed, will just show tablature
        setActivePartTab('tablature');
    }

    // Build view toggle only for hybrid songs (both ABC and chords) when in lead-sheet mode
    const showLeadSheet = !hasTablature || activePartTab === 'lead-sheet';
    const viewToggleHtml = (hasAbc && hasChords && showLeadSheet) ? `
        <div class="view-toggle">
            <button id="view-chords-btn" class="toggle-btn ${!showAbcNotation ? 'active' : ''}">Chords</button>
            <button id="view-abc-btn" class="toggle-btn ${showAbcNotation ? 'active' : ''}">Notation</button>
        </div>
    ` : '';

    // ABC notation view HTML
    const showAbcView = hasAbc && (!hasChords || showAbcNotation) && showLeadSheet;

    // Quick controls collapsed state
    const quickBarCollapsed = localStorage.getItem('quickBarCollapsed') === 'true';

    // ABC view - controls are now in the quick controls bar above
    const abcViewHtml = hasAbc ? `
        <div id="abc-view" class="abc-view ${showAbcView ? '' : 'hidden'}">
            <div id="abc-notation" class="abc-notation"></div>
        </div>
    ` : '';

    // Chord view HTML (hide if showing ABC view or no chords)
    // Note: Tablature view removed - all tab works route through work-view.js
    const chordViewClass = showAbcView || !hasChords ? 'hidden' : '';

    // Header controls - disclosure toggles
    // Show Notes button only when viewing from a list context
    const hasListContext = listContext && listContext.listId;
    const songMetadata = hasListContext ? getSongMetadata(listContext.listId, song?.id) : null;
    const hasNotes = songMetadata?.notes && songMetadata.notes.trim();
    const notesButtonHtml = hasListContext
        ? `<button id="song-notes-btn" class="disclosure-btn ${hasNotes ? 'has-notes' : ''}" title="Song notes for this list" data-list-id="${listContext.listId}">📝 Notes</button>`
        : '';
    const headerControlsHtml = `
        <div class="header-controls">
            <button id="flag-btn" class="flag-btn" title="Report an issue">🚩 Report</button>
            ${notesButtonHtml}
            <button id="qc-toggle" class="disclosure-btn" title="Toggle controls">⚙️ Controls <span class="disclosure-arrow">${quickBarCollapsed ? '▼' : '▲'}</span></button>
            <button id="info-toggle" class="disclosure-btn" title="Toggle info">🎵 Info <span class="disclosure-arrow">${infoBarCollapsed ? '▼' : '▲'}</span></button>
        </div>
    `;

    // Quick controls bar HTML - shown below song header, above tags
    // Controls differ based on content type: ABC notation vs chords/lyrics
    const hasStrumMachine = !!song?.strum_machine_url;
    const strumMachineUrl = hasStrumMachine
        ? (currentDetectedKey
            ? `${song.strum_machine_url}?key=${encodeURIComponent(currentDetectedKey)}`
            : song.strum_machine_url)
        : '';

    // ABC-specific controls: Aa (size), Key, Tempo, Play
    const abcControlsHtml = showAbcView ? `
        <div class="qc-group">
            <button id="abc-size-decrease" class="qc-btn" title="Decrease size">−</button>
            <span class="qc-label">Aa</span>
            <button id="abc-size-increase" class="qc-btn" title="Increase size">+</button>
        </div>
        <div class="qc-group qc-key-group">
            <button id="qc-key-down" class="qc-btn" title="Transpose down">−</button>
            <button id="qc-key-select" class="qc-key-btn" title="Select key">
                <span id="qc-key-value">${currentDetectedKey || '—'}</span>
                <span class="qc-dropdown-arrow">▼</span>
            </button>
            <button id="qc-key-up" class="qc-btn" title="Transpose up">+</button>
        </div>
        <div class="qc-group">
            <button id="abc-speed-decrease" class="qc-btn" title="Decrease tempo">−</button>
            <span class="qc-label" id="abc-tempo-label">${abcTempoBpm}</span>
            <button id="abc-speed-increase" class="qc-btn" title="Increase tempo">+</button>
        </div>
        <button id="abc-play-btn" class="qc-toggle-btn" title="Play/Pause">▶ Play</button>
    ` : '';

    // Chord/lyrics controls: Aa, Key, Layout, Nashville
    const chordControlsHtml = !showAbcView ? `
        <div class="qc-group">
            <button id="qc-size-down" class="qc-btn" title="Decrease font size">−</button>
            <span class="qc-label">Aa</span>
            <button id="qc-size-up" class="qc-btn" title="Increase font size">+</button>
        </div>
        <div class="qc-group qc-key-group">
            <button id="qc-key-down" class="qc-btn" title="Transpose down">−</button>
            <button id="qc-key-select" class="qc-key-btn" title="Select key">
                <span id="qc-key-value">${currentDetectedKey || '—'}</span>
                <span class="qc-dropdown-arrow">▼</span>
            </button>
            <button id="qc-key-up" class="qc-btn" title="Transpose up">+</button>
        </div>
        <div class="qc-group qc-dropdown-group">
            <button id="qc-layout-btn" class="qc-dropdown-btn">
                Layout <span class="qc-dropdown-arrow">▼</span>
            </button>
            <div id="qc-layout-dropdown" class="qc-dropdown hidden">
                <label class="qc-checkbox"><input type="checkbox" id="qc-compact" ${compactMode ? 'checked' : ''}> Compact</label>
                <label class="qc-checkbox"><input type="checkbox" id="qc-twocol" ${twoColumnMode ? 'checked' : ''}> Two Columns</label>
                <label class="qc-checkbox"><input type="checkbox" id="qc-sections" ${showSectionLabels ? 'checked' : ''}> Section Labels</label>
                <div class="qc-dropdown-divider"></div>
                <div class="qc-dropdown-row">
                    <label>Chords</label>
                    <select id="qc-chord-mode" class="qc-select">
                        <option value="all" ${chordDisplayMode === 'all' ? 'selected' : ''}>All</option>
                        <option value="first" ${chordDisplayMode === 'first' ? 'selected' : ''}>First Only</option>
                        <option value="none" ${chordDisplayMode === 'none' ? 'selected' : ''}>None</option>
                    </select>
                </div>
            </div>
        </div>
        <button id="qc-nashville" class="qc-toggle-btn ${nashvilleMode ? 'active' : ''}" title="Nashville numbers">Nashville</button>
        <button id="qc-strum" class="qc-icon-btn ${hasStrumMachine ? '' : 'hidden'}" title="Practice on Strum Machine" data-url="${strumMachineUrl}">
            <img src="images/strum_machine.png" alt="Strum Machine" class="qc-strum-icon">
        </button>
    ` : '';

    const quickControlsBarHtml = `
        <div id="quick-controls-content" class="quick-controls-content ${quickBarCollapsed ? 'hidden' : ''}">
            <div class="qc-controls-row">
                ${showAbcView ? abcControlsHtml : chordControlsHtml}
            </div>
            <div id="qc-key-dropdown" class="qc-dropdown qc-key-dropdown hidden"></div>
        </div>
    `;

    // Focus header - shown only in fullscreen mode (via CSS)
    // Check if we have list context and notes metadata for the bottom notes panel
    const focusSongMetadata = hasListContext ? getSongMetadata(listContext.listId, song?.id) : null;
    const focusHasNotes = focusSongMetadata?.notes && focusSongMetadata.notes.trim();

    const focusHeaderHtml = `
        <div class="focus-header">
            <button id="focus-prev-btn" class="focus-list-nav" title="Previous song (←)">←</button>
            <div class="focus-title-area">
                <span class="focus-title">${escapeHtml(title)}</span>
                <span id="focus-position" class="focus-position"></span>
            </div>
            <button id="focus-exit-btn" class="focus-nav-btn" title="Exit focus mode">
                <span>✕</span>
                <span class="focus-btn-label">Exit</span>
            </button>
            <button id="focus-goto-song-btn" class="focus-nav-btn" title="View full song page">
                <span>🎵</span>
                <span class="focus-btn-label">Go to Song</span>
            </button>
            <button id="focus-controls-toggle" class="focus-nav-btn" title="Toggle controls">
                <span>⚙️</span>
                <span class="focus-btn-label">Controls</span>
            </button>
            <button id="focus-next-btn" class="focus-list-nav" title="Next song (→)">→</button>
        </div>
    `;

    // Collapsible notes panel for focus mode (only when viewing from a list)
    const notesCollapsed = localStorage.getItem('focusNotesCollapsed') !== 'false'; // collapsed by default
    const savedPanelHeight = localStorage.getItem('focusNotesPanelHeight');
    const panelHeightStyle = savedPanelHeight ? `style="--panel-height: ${savedPanelHeight}px"` : '';
    const focusNotesMetadata = focusSongMetadata || {};
    const focusNotesPanelHtml = hasListContext ? `
        <div id="focus-notes-panel" class="focus-notes-panel ${notesCollapsed ? 'collapsed' : ''}" data-list-id="${listContext.listId}" data-song-id="${song?.id}" ${panelHeightStyle}>
            <div id="focus-notes-drag-handle" class="focus-notes-drag-handle" title="Drag to resize">
                <span class="drag-handle-bar"></span>
            </div>
            <button id="focus-notes-toggle" class="focus-notes-toggle" title="Toggle notes panel">
                <span class="focus-notes-toggle-icon">${notesCollapsed ? '▲' : '▼'}</span>
                <span class="focus-notes-toggle-label">Notes</span>
                ${focusHasNotes ? '<span class="focus-notes-indicator">•</span>' : ''}
            </button>
            <div class="focus-notes-content">
                <div class="focus-notes-fields">
                    <div class="focus-notes-field">
                        <label>Key</label>
                        <select id="focus-notes-key">
                            <option value="">--</option>
                            ${['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'].map(k =>
                                `<option value="${k}" ${focusNotesMetadata.key === k ? 'selected' : ''}>${k}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="focus-notes-field">
                        <label>Tempo</label>
                        <input type="number" id="focus-notes-tempo" min="40" max="300" value="${focusNotesMetadata.tempo || ''}" placeholder="BPM">
                    </div>
                </div>
                <div class="focus-notes-textarea-wrapper">
                    <textarea id="focus-notes-text" placeholder="Add notes for this song in this list...">${escapeHtml(focusNotesMetadata.notes || '')}</textarea>
                </div>
            </div>
        </div>
    ` : '';

    songContentEl.innerHTML = `
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
        ${quickControlsBarHtml}
        ${infoContentHtml}
        ${partTabsHtml}
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
        ${sourceHtml}
        ${focusNotesPanelHtml}
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
    setupPartTabListeners(song, chordpro);

    // Update quick controls bar
    if (typeof window.updateQuickControls === 'function') {
        window.updateQuickControls();
    }

    // Mark wrapped chord-lyrics lines for visual indicator
    markWrappedLines();
}

/**
 * Setup event listeners for part tab switching
 */
function setupPartTabListeners(song, chordpro) {
    const partTabs = songContentEl?.querySelectorAll('.part-tab');
    if (!partTabs || partTabs.length === 0) return;

    partTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const part = tab.dataset.part;
            if (part === activePartTab) return;

            // Stop any playback when switching
            stopAbcPlayback();

            // Update state and re-render
            setActivePartTab(part);
            renderSong(song, chordpro);
        });
    });
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
            const newKey = e.target.value;
            if (song && currentDetectedKey !== newKey) {
                trackTranspose(song.id, currentDetectedKey, newKey);
            }
            setCurrentDetectedKey(newKey);
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

    // Tags collapse/expand handler
    const tagsCollapsed = document.getElementById('tags-collapsed');
    const tagsExpanded = document.getElementById('tags-expanded');
    if (tagsCollapsed && tagsExpanded) {
        // Expand when collapsed is clicked
        tagsCollapsed.addEventListener('click', () => {
            tagsCollapsed.classList.add('hidden');
            tagsExpanded.classList.add('expanded');
            trackTagsExpand(true);
        });

        // Collapse when header is clicked
        const tagsHeader = tagsExpanded.querySelector('.tags-header');
        if (tagsHeader) {
            tagsHeader.addEventListener('click', () => {
                tagsExpanded.classList.remove('expanded');
                tagsCollapsed.classList.remove('hidden');
                trackTagsExpand(false);
            });
        }
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

    // Flag button opens flag modal
    const flagBtn = document.getElementById('flag-btn');
    if (flagBtn) {
        flagBtn.addEventListener('click', () => {
            openFlagModal(song);
        });
    }

    // Notes button opens notes sheet (when in list context)
    const songNotesBtn = document.getElementById('song-notes-btn');
    if (songNotesBtn && listContext && listContext.listId) {
        songNotesBtn.addEventListener('click', () => {
            openNotesSheet(listContext.listId, song?.id, song?.title);
        });
    }

    // Focus header buttons
    const focusExitBtn = document.getElementById('focus-exit-btn');
    if (focusExitBtn) {
        focusExitBtn.addEventListener('click', () => {
            exitFullscreen();
        });
    }

    const focusGotoSongBtn = document.getElementById('focus-goto-song-btn');
    if (focusGotoSongBtn) {
        focusGotoSongBtn.addEventListener('click', () => {
            // Exit focus mode and navigate to work view
            setFullscreenMode(false);
            document.body.classList.remove('fullscreen-mode');
            document.body.classList.remove('has-list-context');

            // Save the return URL so the back button can return to the list
            if (listContext && listContext.listId) {
                const returnUrl = `#list/${listContext.listId}/${song?.id || ''}`;
                sessionStorage.setItem('songbook-return-url', returnUrl);
            }

            // Clear list view state and hide list header
            clearListView();
            // Navigate to work view
            window.location.hash = `#work/${song?.id || ''}`;
        });
    }

    const focusPrevBtn = document.getElementById('focus-prev-btn');
    if (focusPrevBtn) {
        focusPrevBtn.addEventListener('click', () => {
            navigatePrev();
        });
    }

    const focusNextBtn = document.getElementById('focus-next-btn');
    if (focusNextBtn) {
        focusNextBtn.addEventListener('click', () => {
            navigateNext();
        });
    }

    const focusControlsToggle = document.getElementById('focus-controls-toggle');
    if (focusControlsToggle) {
        focusControlsToggle.addEventListener('click', () => {
            const qcContent = document.getElementById('quick-controls-content');
            if (qcContent) {
                const isHidden = qcContent.classList.toggle('hidden');
                // Update localStorage so re-renders preserve the state
                localStorage.setItem('quickBarCollapsed', isHidden);
            }
        });
    }

    // Setup focus notes panel event listeners
    setupFocusNotesPanelListeners(song);

    // Update focus header based on list context
    updateFocusHeader();
}

/**
 * Toggle the focus notes panel collapsed/expanded state
 */
function toggleFocusNotesPanel() {
    const panel = document.getElementById('focus-notes-panel');
    const toggleIcon = panel?.querySelector('.focus-notes-toggle-icon');
    if (!panel) return;

    const isCollapsed = panel.classList.toggle('collapsed');
    localStorage.setItem('focusNotesCollapsed', isCollapsed);

    if (toggleIcon) {
        toggleIcon.textContent = isCollapsed ? '▲' : '▼';
    }
}

/**
 * Setup event listeners for the focus notes panel
 */
function setupFocusNotesPanelListeners(song) {
    const panel = document.getElementById('focus-notes-panel');
    if (!panel) return;

    const listId = panel.dataset.listId;
    const songId = panel.dataset.songId;

    // Toggle button
    const toggleBtn = document.getElementById('focus-notes-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleFocusNotesPanel);
    }

    // Debounce helper for saving
    let saveTimeout = null;
    const debouncedSave = () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            const key = document.getElementById('focus-notes-key')?.value || '';
            const tempo = document.getElementById('focus-notes-tempo')?.value || '';
            const notes = document.getElementById('focus-notes-text')?.value || '';

            updateSongMetadata(listId, songId, {
                key: key || undefined,
                tempo: tempo ? parseInt(tempo, 10) : undefined,
                notes: notes || undefined
            });

            // Update the indicator
            const indicator = panel.querySelector('.focus-notes-indicator');
            if (notes.trim()) {
                if (!indicator) {
                    const toggleBtn = document.getElementById('focus-notes-toggle');
                    if (toggleBtn) {
                        const indicatorEl = document.createElement('span');
                        indicatorEl.className = 'focus-notes-indicator';
                        indicatorEl.textContent = '•';
                        toggleBtn.appendChild(indicatorEl);
                    }
                }
            } else if (indicator) {
                indicator.remove();
            }
        }, 500);
    };

    // Field change listeners
    const keySelect = document.getElementById('focus-notes-key');
    const tempoInput = document.getElementById('focus-notes-tempo');
    const notesTextarea = document.getElementById('focus-notes-text');

    if (keySelect) keySelect.addEventListener('change', debouncedSave);
    if (tempoInput) tempoInput.addEventListener('input', debouncedSave);
    if (notesTextarea) notesTextarea.addEventListener('input', debouncedSave);

    // Drag handle for resizing
    const dragHandle = document.getElementById('focus-notes-drag-handle');
    if (dragHandle) {
        let isDragging = false;
        let startY = 0;
        let startHeight = 0;

        const onMouseDown = (e) => {
            // Don't start drag if panel is collapsed
            if (panel.classList.contains('collapsed')) return;

            isDragging = true;
            startY = e.clientY || e.touches?.[0]?.clientY;
            startHeight = panel.offsetHeight;
            document.body.classList.add('resizing-notes-panel');
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;

            const clientY = e.clientY || e.touches?.[0]?.clientY;
            const deltaY = startY - clientY; // Negative because dragging up increases height
            const newHeight = Math.max(100, Math.min(window.innerHeight * 0.8, startHeight + deltaY));

            panel.style.setProperty('--panel-height', `${newHeight}px`);
        };

        const onMouseUp = () => {
            if (!isDragging) return;

            isDragging = false;
            document.body.classList.remove('resizing-notes-panel');

            // Save the height to localStorage
            const currentHeight = panel.offsetHeight;
            localStorage.setItem('focusNotesPanelHeight', currentHeight);
        };

        // Mouse events
        dragHandle.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Touch events for mobile
        dragHandle.addEventListener('touchstart', onMouseDown, { passive: false });
        document.addEventListener('touchmove', onMouseMove, { passive: false });
        document.addEventListener('touchend', onMouseUp);
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

    // Mobile: make ABC controls fieldset collapsible
    const abcFieldset = document.querySelector('.render-options-fieldset');
    if (abcFieldset) {
        const legend = abcFieldset.querySelector('legend');
        if (legend) {
            legend.addEventListener('click', () => {
                abcFieldset.classList.toggle('collapsed');
            });
        }
    }
}

/**
 * Open a song
 * @param {string} songId - The song ID to open
 * @param {Object} options - Options for opening the song
 * @param {boolean} options.fromList - Whether opening from a list view (auto-enters fullscreen)
 * @param {boolean} options.fromHistory - Whether opening from browser history navigation
 */
export async function openSong(songId, options = {}) {
    if (!songViewEl || !resultsDivEl) return;

    // Show Work button when in song-view (hidden on work dashboard)
    const workViewBtn = document.getElementById('work-view-btn');
    if (workViewBtn) workViewBtn.classList.remove('hidden');

    // Resolve redirected work IDs (merged duplicates)
    songId = resolveWorkId(songId);

    const { fromList = false, fromHistory = false, listId = null, fromDeepLink = false } = options;

    // Clear chordpro content FIRST to prevent stale render from subscribers
    // This must happen before any state changes that trigger reactive re-renders
    setCurrentChordpro(null);

    if (pushHistoryStateFn && !fromHistory) {
        // Include listId in URL if we're in a list context
        const effectiveListId = listId || (listContext ? listContext.listId : null);
        // Use replace for deep links to avoid duplicate history entries
        pushHistoryStateFn('song', { songId, listId: effectiveListId }, fromDeepLink);
    }

    // Update view state - triggers DOM update via subscriber
    setCurrentView('song');

    // Reset key tracking for new song
    setOriginalDetectedKey(null);
    setOriginalDetectedMode(null);
    setCurrentDetectedKey(null);

    // Reset tablature state for new song (defensive cleanup)
    setActivePartTab('lead-sheet');
    setLoadedTablature(null);

    const song = allSongs.find(s => s.id === songId);
    setCurrentSong(song);

    // Handle song not found
    if (!song) {
        songContentEl.innerHTML = `<div class="loading">Song not found: "${escapeHtml(songId)}"</div>`;
        return;
    }

    // Update list context index if we're navigating within a list
    if (listContext && listContext.songIds) {
        const idx = listContext.songIds.indexOf(songId);
        if (idx !== -1) {
            setListContext({
                ...listContext,
                currentIndex: idx
            });
        } else if (!fromList) {
            // Song is not in the current list and we're not explicitly navigating from a list
            // Clear the stale list context
            setListContext(null);
        }
    }
    updateNavBar();

    // Auto-enter fullscreen when opening from a list
    if (fromList && listContext) {
        setFullscreenMode(true);
        document.body.classList.add('fullscreen-mode');
        // Also add list context class for corner nav buttons
        document.body.classList.add('has-list-context');
    }

    // Track song view in analytics
    if (song) {
        trackSongView(songId, 'search', song.group_id);
    }

    // Track song view in Google Analytics
    if (typeof gtag === 'function' && song) {
        gtag('event', 'page_view', {
            page_title: `${song.title} - ${song.artist || 'Unknown'}`,
            page_location: `${window.location.origin}/song/${songId}`,
            page_path: `/song/${songId}`
        });
    }

    // Restore header buttons that work-view may have hidden for placeholders
    const editBtnEl = document.getElementById('edit-song-btn');
    const exportWrapperEl = document.getElementById('export-btn')?.closest('.export-wrapper');
    if (editBtnEl) editBtnEl.classList.remove('hidden');
    if (exportWrapperEl) exportWrapperEl.classList.remove('hidden');

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

    // Clear chordpro content FIRST to prevent stale render from subscribers
    setCurrentChordpro(null);

    // Update view state - triggers DOM update via subscriber
    setCurrentView('song');

    setOriginalDetectedKey(null);
    setOriginalDetectedMode(null);
    setCurrentDetectedKey(null);

    // Reset tablature state for new song (defensive cleanup)
    setActivePartTab('lead-sheet');
    setLoadedTablature(null);

    const song = allSongs.find(s => s.id === songId);
    setCurrentSong(song);

    // Track song view from history/deep link
    if (song) {
        trackSongView(songId, 'deep_link', song.group_id);
    }

    updateFavoriteButton();
    updateListPickerButton();

    if (song && song.content) {
        setCurrentChordpro(song.content);
        renderSong(song, song.content, true);
    }
}

/**
 * Show version picker modal
 * @param {string} groupId - The group ID for versions
 * @param {Object} options - Options to pass through to openSong
 */
export async function showVersionPicker(groupId, options = {}) {
    if (!versionModalEl || !versionListEl) return;

    // Store options to pass through when a version is selected
    const openOptions = options;

    const versions = songGroups[groupId] || [];
    if (versions.length === 0) return;

    trackVersionPicker(groupId, 'open');

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

        // Build version label - prefer tab author for tab-only songs
        const tabPart = song.tablature_parts?.[0];
        const hasTabOnly = isTabOnlyWork(song);
        let versionLabel = song.version_label;

        // Check for title variations (e.g., "Angeline Baker (C)" vs "Angeline Baker (D)")
        // Extract any parenthetical suffix that differs from the base title
        const baseTitle = versions[0].title;
        const titleSuffix = song.title !== baseTitle ? song.title.replace(baseTitle, '').trim() : '';

        if (!versionLabel) {
            if (titleSuffix) {
                // Use title variation as the label (e.g., "(C)", "(D)")
                versionLabel = titleSuffix;
                if (hasTabOnly && tabPart?.author) {
                    versionLabel += ` • Tab by ${tabPart.author}`;
                }
            } else if (hasTabOnly && tabPart?.author) {
                versionLabel = `Tab by ${tabPart.author}`;
            } else if (song.abc_content) {
                // ABC notation works - show as notation
                versionLabel = 'Fiddle notation';
            } else if (song.key) {
                versionLabel = `Key of ${song.key}`;
            } else {
                versionLabel = 'Original';
            }
        }

        // Build version meta - show content type indicators
        const metaParts = [];
        if (song.arrangement_by) metaParts.push(`by ${song.arrangement_by}`);

        // Only show tablature metadata for tab-only works
        if (hasTabOnly) {
            if (tabPart?.source === 'banjo-hangout') metaParts.push('Banjo Hangout');
            if (tabPart?.instrument) metaParts.push(tabPart.instrument);
        } else if (song.abc_content) {
            // Show ABC/notation indicator for works with ABC content
            metaParts.push('Notation');
            if (song.source === 'tunearch') metaParts.push('TuneArch');
        }

        if (song.key) metaParts.push(`Key: ${song.key}`);
        if (song.version_type) metaParts.push(song.version_type);
        if (song.nashville?.length > 0) metaParts.push(`${song.nashville.length} chords`);
        const versionMeta = metaParts.join(' • ');

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
            const songId = item.dataset.songId;
            trackVersionPicker(groupId, 'select', songId);
            closeVersionPicker();
            // Dashboard for: placeholders, tab-only, and multi-part works.
            // Single-part songs with content go to song-view.
            const song = allSongs.find(s => s.id === songId);
            if (isPlaceholder(song) || isTabOnlyWork(song) || hasMultipleParts(song)) {
                openWork(songId);
            } else {
                openSong(songId, openOptions);
            }
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
 * Toggle fullscreen mode
 */
export function toggleFullscreen() {
    const newMode = !fullscreenMode;
    setFullscreenMode(newMode);
    document.body.classList.toggle('fullscreen-mode', newMode);

    // Update nav bar visibility and content
    updateNavBar();
}

/**
 * Exit fullscreen mode
 */
export function exitFullscreen() {
    if (fullscreenMode) {
        setFullscreenMode(false);
        document.body.classList.remove('fullscreen-mode');

        // If we came from a list, go back to list view
        if (listContext && listContext.listId) {
            // Use history.back() to return to list view
            if (historyInitialized && history.state) {
                history.back();
            }
        }

        updateNavBar();
    }
}

/**
 * Open bottom sheet with song controls (mobile)
 */
export function openSongControls() {
    // Call the global openBottomSheet function set up by main.js
    if (typeof window.openBottomSheet === 'function') {
        window.openBottomSheet();
    }
}

/**
 * Update navigation bar based on list context
 */
export function updateNavBar() {
    if (!navBarEl) return;

    // Update exit button label based on context
    const exitBtn = document.getElementById('exit-fullscreen-btn');
    if (exitBtn) {
        const labelSpan = exitBtn.querySelector('.nav-label');
        const arrowSpan = exitBtn.querySelector('.nav-arrow');
        if (listContext && listContext.listId) {
            // In list context: show "List" to return to list view
            if (labelSpan) labelSpan.textContent = 'List';
            if (arrowSpan) arrowSpan.textContent = '☰';
            exitBtn.title = 'Back to list';
        } else {
            // No list context: show "Exit" to exit fullscreen
            if (labelSpan) labelSpan.textContent = 'Exit';
            if (arrowSpan) arrowSpan.textContent = '✕';
            exitBtn.title = 'Exit focus mode (Esc)';
        }
    }

    // Show nav bar if we have a list context (regardless of fullscreen)
    // But in fullscreen mode, it's always shown via CSS
    if (listContext && listContext.songIds && listContext.songIds.length > 0) {
        const idx = listContext.currentIndex;
        const total = listContext.songIds.length;

        // Update position text
        if (navPositionEl) {
            navPositionEl.textContent = `${idx + 1} of ${total}`;
        }

        // Update list name
        if (navListNameEl) {
            navListNameEl.textContent = listContext.listName || '';
        }

        // Update button states
        if (navPrevBtnEl) {
            navPrevBtnEl.disabled = idx <= 0;
        }
        if (navNextBtnEl) {
            navNextBtnEl.disabled = idx >= total - 1;
        }

        // Show nav bar in fullscreen mode (CSS handles this)
        // In non-fullscreen, show it if we have context
        if (fullscreenMode) {
            navBarEl.classList.remove('hidden');
        }
        // Add class to indicate we have list context (for CSS)
        navBarEl.classList.add('has-list-context');
    } else {
        // No list context - remove list context class
        navBarEl.classList.remove('has-list-context');
        // Show nav bar in fullscreen mode (for Song button access)
        // Hide only if NOT in fullscreen
        if (fullscreenMode) {
            navBarEl.classList.remove('hidden');
        } else {
            navBarEl.classList.add('hidden');
        }
        // Clear the content so it doesn't show stale data
        if (navPositionEl) navPositionEl.textContent = '';
        if (navListNameEl) navListNameEl.textContent = '';
    }

    // Also update focus header
    updateFocusHeader();
}

/**
 * Update focus header based on list context
 */
export function updateFocusHeader() {
    const focusPrevBtn = document.getElementById('focus-prev-btn');
    const focusNextBtn = document.getElementById('focus-next-btn');
    const focusPositionEl = document.getElementById('focus-position');

    if (listContext && listContext.songIds && listContext.songIds.length > 0) {
        const idx = listContext.currentIndex;
        const total = listContext.songIds.length;

        // Update position text
        if (focusPositionEl) {
            const listName = listContext.listName ? ` · ${listContext.listName}` : '';
            focusPositionEl.textContent = `${idx + 1} of ${total}${listName}`;
        }

        // Update button states
        if (focusPrevBtn) {
            focusPrevBtn.disabled = idx <= 0;
        }
        if (focusNextBtn) {
            focusNextBtn.disabled = idx >= total - 1;
        }

        // Add class to body for CSS
        document.body.classList.add('has-list-context');
    } else {
        // No list context
        if (focusPositionEl) focusPositionEl.textContent = '';
        document.body.classList.remove('has-list-context');
    }
}

/**
 * Pluggable navigation router for list item navigation.
 * Set by main.js to smart-route between openSong/openWork based on item type.
 */
let listItemRouter = null;
export function setListItemRouter(fn) { listItemRouter = fn; }

/**
 * Navigate to previous song in list
 */
export function navigatePrev() {
    if (!listContext || listContext.currentIndex <= 0) return;

    const newIndex = listContext.currentIndex - 1;
    const itemRef = listContext.songIds[newIndex];

    setListContext({
        ...listContext,
        currentIndex: newIndex
    });

    if (listItemRouter) {
        listItemRouter(itemRef);
    } else {
        openSong(itemRef);
    }
}

/**
 * Navigate to next song in list
 */
export function navigateNext() {
    if (!listContext || listContext.currentIndex >= listContext.songIds.length - 1) return;

    const newIndex = listContext.currentIndex + 1;
    const itemRef = listContext.songIds[newIndex];

    setListContext({
        ...listContext,
        currentIndex: newIndex
    });

    if (listItemRouter) {
        listItemRouter(itemRef);
    } else {
        openSong(itemRef);
    }
}

/**
 * Go back to results
 */
export function goBack() {
    // Track time spent on song before navigating away
    endSongView();

    // Exit fullscreen mode
    exitFullscreen();

    // Close list picker dropdown when navigating away
    if (listPickerDropdownEl) listPickerDropdownEl.classList.add('hidden');

    // Check for a saved return URL (e.g., when coming from a list via "Go to Song")
    const returnUrl = sessionStorage.getItem('songbook-return-url');
    if (returnUrl) {
        sessionStorage.removeItem('songbook-return-url');
        window.location.hash = returnUrl;
        return;
    }

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
        backBtn,
        // Navigation elements
        navBar,
        navPrevBtn,
        navNextBtn,
        navPosition,
        navListName,
        fullscreenBtn
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

    // Navigation elements
    navBarEl = navBar;
    navPrevBtnEl = navPrevBtn;
    navNextBtnEl = navNextBtn;
    navPositionEl = navPosition;
    navListNameEl = navListName;
    fullscreenBtnEl = fullscreenBtn;

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

    // Setup fullscreen button
    if (fullscreenBtnEl) {
        fullscreenBtnEl.addEventListener('click', toggleFullscreen);
    }

    // Setup navigation buttons
    if (navPrevBtnEl) {
        navPrevBtnEl.addEventListener('click', navigatePrev);
    }
    if (navNextBtnEl) {
        navNextBtnEl.addEventListener('click', navigateNext);
    }

    // Subscribe to display preference changes for reactive re-rendering
    const displayPrefKeys = [
        'compactMode',
        'nashvilleMode',
        'twoColumnMode',
        'chordDisplayMode',
        'showSectionLabels',
        'fontSizeLevel',
        'currentDetectedKey'
    ];

    displayPrefKeys.forEach(key => {
        subscribe(key, () => {
            // Only re-render if we're viewing a song
            if (currentView === 'song' && currentSong && currentChordpro) {
                renderSong(currentSong, currentChordpro);
            }
        });
    });
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
