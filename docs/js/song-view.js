// Song view and rendering for Bluegrass Songbook

import {
    currentSong,
    currentChordpro,
    compactMode,
    nashvilleMode,
    twoColumnMode,
    chordDisplayMode,
    showSectionLabels,
    showChordProSource,
    fontSizeLevel,
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
    abcTranspose,
    abcScale, setAbcScale,
    abcSynth, setAbcSynth,
    abcTimingCallbacks, setAbcTimingCallbacks,
    abcIsPlaying, setAbcIsPlaying,
    abcPlaybackSession, incrementAbcPlaybackSession,
    // Fullscreen/navigation state
    fullscreenMode, setFullscreenMode,
    listContext, setListContext
} from './state.js';
import { escapeHtml } from './utils.js';
import {
    extractChords, detectKey,
    CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS
} from './chords.js';
import { parseChordPro, renderSectionsHtml } from './renderers/chordpro.js';
import { getSongMetadata, updateSongMetadata } from './lists.js';
import { endSongView } from './analytics.js';
import { setBottomBand, setImmersive } from './shell.js';
import { openWork } from './work-view.js';

// DOM element references (set by init)
let songViewEl = null;
let songContentEl = null;
let resultsDivEl = null;

// Navigation bar elements
let navBarEl = null;
let navPrevBtnEl = null;
let navNextBtnEl = null;
let navPositionEl = null;
let navListNameEl = null;

// Callback references (set by init)
let pushHistoryStateFn = null;
let showViewFn = null;

// ChordPro parsing/section rendering lives in the shared renderer module.
// Re-exported so existing importers (tests, work-view) keep working.
export { parseChordPro };

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
export function stopAbcPlayback() {
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
export function setupAbcPlayback() {
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

// Note: The full-page renderSong() is gone — the unified song page in
// work-view.js owns page chrome (title, pills, part tabs, top/bottom bands).
// This module renders the lead-sheet BODY (chords / ABC notation) into the
// page's content area and owns key-state initialization.

/**
 * Initialize key/transposition state for a song's chordpro content.
 * Sets original/current detected key (respecting list-metadata key
 * overrides) and validates the current key against the chromatic set.
 */
export function initKeyState(song, chordpro, isInitialRender = false) {
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
                // Map metadata key format ("C#/Db") to CHROMATIC_MAJOR_KEYS format
                const keyMap = {
                    'C#/Db': 'C#', 'D#/Eb': 'Eb', 'F#/Gb': 'F#',
                    'G#/Ab': 'Ab', 'A#/Bb': 'Bb'
                };
                setCurrentDetectedKey(keyMap[songMetadata.key] || songMetadata.key);
            }
        }
    }

    // Ensure currentDetectedKey is valid for the available chromatic keys
    const availableKeys = originalDetectedMode === 'minor' ? CHROMATIC_MINOR_KEYS : CHROMATIC_MAJOR_KEYS;
    if (!availableKeys.includes(currentDetectedKey)) {
        setCurrentDetectedKey(originalDetectedKey || detectedKey || availableKeys[0]);
    }
}

/**
 * Render a chordpro lead sheet (chord view and/or ABC notation) into a
 * container. Also manages the bottom band: ABC playback controls when
 * notation is showing, nothing otherwise.
 */
export function renderLeadSheetContent(container, song, chordpro, isInitialRender = false) {
    if (!container) return;

    const { metadata, sections } = parseChordPro(chordpro);
    initKeyState(song, chordpro, isInitialRender);

    // Separate ABC sections from chord sections
    const abcSections = sections.filter(s => s.type === 'abc');
    const chordSections = sections.filter(s => s.type !== 'abc');
    const hasAbc = abcSections.length > 0;
    const hasChords = chordSections.length > 0;
    const abcContent = abcSections.map(s => s.abc).join('\n\n');

    // Detect tempo from ABC content (Q: directive) and set initial BPM
    if (abcContent && isInitialRender) {
        const tempoMatch = abcContent.match(/Q:\s*(?:\d+\/\d+=)?(\d+)/);
        setAbcTempoBpm(tempoMatch ? parseInt(tempoMatch[1], 10) : 120);
    }

    const sectionsHtml = renderSectionsHtml(chordSections, {
        key: originalDetectedKey,
        transposeTo: currentDetectedKey,
        nashville: nashvilleMode,
        chordMode: chordDisplayMode,
        compact: compactMode,
        sectionLabels: showSectionLabels,
        twoColumn: twoColumnMode
    });

    const showAbcView = hasAbc && (!hasChords || showAbcNotation);

    // View toggle only for hybrid songs (both ABC and chords)
    const viewToggleHtml = (hasAbc && hasChords) ? `
        <div class="view-toggle">
            <button id="view-chords-btn" class="toggle-btn ${!showAbcNotation ? 'active' : ''}">Chords</button>
            <button id="view-abc-btn" class="toggle-btn ${showAbcNotation ? 'active' : ''}">Notation</button>
        </div>
    ` : '';

    const abcViewHtml = hasAbc ? `
        <div id="abc-view" class="abc-view ${showAbcView ? '' : 'hidden'}">
            <div id="abc-notation" class="abc-notation"></div>
        </div>
    ` : '';

    const chordViewClass = showAbcView || !hasChords ? 'hidden' : '';

    // Source attribution for bottom of page
    // Link to classic-country home page (individual pages are often broken)
    // For bluegrass-lyrics, use the x_lyrics_url from ChordPro metadata
    const sourceUrl = song?.source === 'classic-country'
        ? 'https://www.classic-country-song-lyrics.com/'
        : (song?.source === 'bluegrass-lyrics' && metadata.x_lyrics_url)
            ? metadata.x_lyrics_url
            : null;
    const bookDisplay = metadata.x_book || song?.book || null;
    const bookUrl = metadata.x_book_url || song?.book_url || null;
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
    let sourceHtml = '';
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

    container.innerHTML = `
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
    `;

    // Bottom band: ABC playback controls when the notation view is up
    if (showAbcView) {
        setBottomBand(buildAbcBandControls());
        setTimeout(() => {
            renderAbcNotation(abcContent, 'abc-notation');
            setupAbcPlayback();
        }, 0);
    } else {
        stopAbcPlayback();
        setBottomBand(null);
    }

    // View toggle handlers (hybrid songs)
    container.querySelector('#view-chords-btn')?.addEventListener('click', () => {
        setShowAbcNotation(false);
        renderLeadSheetContent(container, song, chordpro);
    });
    container.querySelector('#view-abc-btn')?.addEventListener('click', () => {
        setShowAbcNotation(true);
        renderLeadSheetContent(container, song, chordpro);
    });

    // Mark wrapped chord-lyrics lines for visual indicator
    markWrappedLines();
}

/**
 * Bottom-band controls for ABC notation parts: size, tempo, play.
 * setupAbcPlayback() finds #abc-play-btn by id once the band is mounted.
 */
function buildAbcBandControls() {
    const el = document.createElement('div');
    el.className = 'abc-band-controls tab-controls';
    el.innerHTML = `
        <div class="qc-group">
            <button id="abc-size-decrease" class="qc-btn" title="Decrease size">−</button>
            <span class="qc-label">Aa</span>
            <button id="abc-size-increase" class="qc-btn" title="Increase size">+</button>
        </div>
        <div class="qc-group">
            <button id="abc-speed-decrease" class="qc-btn" title="Decrease tempo">−</button>
            <span class="qc-label" id="abc-tempo-label">${abcTempoBpm}</span>
            <button id="abc-speed-increase" class="qc-btn" title="Increase tempo">+</button>
        </div>
        <button id="abc-play-btn" class="qc-toggle-btn" title="Play/Pause">▶ Play</button>
    `;

    // Size controls re-render the notation at the new scale
    const sizeDecrease = el.querySelector('#abc-size-decrease');
    const sizeIncrease = el.querySelector('#abc-size-increase');
    const rerenderAbc = () => {
        if (currentAbcContent) {
            renderAbcNotation(currentAbcContent, 'abc-notation');
            setupAbcPlayback();
        }
    };
    const updateSizeButtons = () => {
        sizeDecrease.disabled = abcScale <= 0.7;
        sizeIncrease.disabled = abcScale >= 1.5;
    };
    sizeDecrease.addEventListener('click', () => {
        if (abcScale > 0.7) {
            setAbcScale(Math.round((abcScale - 0.1) * 10) / 10);
            updateSizeButtons();
            rerenderAbc();
        }
    });
    sizeIncrease.addEventListener('click', () => {
        if (abcScale < 1.5) {
            setAbcScale(Math.round((abcScale + 0.1) * 10) / 10);
            updateSizeButtons();
            rerenderAbc();
        }
    });
    updateSizeButtons();

    // Tempo controls only affect the next playback start
    const speedDecrease = el.querySelector('#abc-speed-decrease');
    const speedIncrease = el.querySelector('#abc-speed-increase');
    const tempoLabel = el.querySelector('#abc-tempo-label');
    const applyTempo = (bpm) => {
        setAbcTempoBpm(Math.max(60, Math.min(240, bpm)));
        tempoLabel.textContent = abcTempoBpm;
        speedDecrease.disabled = abcTempoBpm <= 60;
        speedIncrease.disabled = abcTempoBpm >= 240;
    };
    speedDecrease.addEventListener('click', () => applyTempo(abcTempoBpm - 10));
    speedIncrease.addEventListener('click', () => applyTempo(abcTempoBpm + 10));
    applyTempo(abcTempoBpm);

    return el;
}

/**
 * Open a song — thin alias for the unified song page.
 * exact:true preserves openSong's historical contract of showing THIS
 * version rather than snapping to the group's canonical representative
 * (version pickers and list refs point at specific versions).
 * @param {string} songId - The song ID to open
 * @param {Object} options - {fromList, fromHistory, listId, fromDeepLink}
 */
export async function openSong(songId, options = {}) {
    return openWork(songId, { ...options, exact: true });
}

/**
 * Open song from history navigation (without pushing new state)
 */
export async function openSongFromHistory(songId) {
    return openWork(songId, { fromHistory: true, exact: true });
}

/**
 * Toggle focus mode. Focus is now just the immersive shell: the top band
 * slides away (hover/focus reveals it) while the content, pill row, and
 * bottom band stay — no separate focus header or view fork.
 */
export function toggleFullscreen() {
    const newMode = !fullscreenMode;
    setFullscreenMode(newMode);
    setImmersive(newMode);
    updateFocusButton();
    updateNavBar();
}

// The Focus button is a true toggle — same spot to enter and exit
// (Esc and F still work). Label follows the mode.
function updateFocusButton() {
    const btn = document.getElementById('focus-btn');
    if (btn) btn.innerHTML = fullscreenMode ? '✕ Exit' : '⛶ Focus';
}

/**
 * Exit focus (immersive) mode
 */
export function exitFullscreen() {
    if (fullscreenMode) {
        setFullscreenMode(false);
        setImmersive(false);
        updateFocusButton();

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

    // Keep the body-level list-context flag in sync
    updateListContextClass();
}

/**
 * Keep body.has-list-context in sync with the list context, so CSS can
 * stack the list nav bar and the bottom band.
 */
export function updateListContextClass() {
    const inList = !!(listContext && listContext.songIds && listContext.songIds.length > 0);
    document.body.classList.toggle('has-list-context', inList);
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
        pushHistoryState,
        showView,
        // Navigation elements
        navBar,
        navPrevBtn,
        navNextBtn,
        navPosition,
        navListName
    } = options;

    songViewEl = songView;
    songContentEl = songContent;
    resultsDivEl = resultsDiv;
    pushHistoryStateFn = pushHistoryState;
    showViewFn = showView;

    // Navigation elements
    navBarEl = navBar;
    navPrevBtnEl = navPrevBtn;
    navNextBtnEl = navNextBtn;
    navPositionEl = navPosition;
    navListNameEl = navListName;

    // Setup navigation buttons
    if (navPrevBtnEl) {
        navPrevBtnEl.addEventListener('click', navigatePrev);
    }
    if (navNextBtnEl) {
        navNextBtnEl.addEventListener('click', navigateNext);
    }

    // NOTE: display-preference re-rendering is subscribed in work-view.js
    // (configureWorkPage) — the unified song page owns the render loop.
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
