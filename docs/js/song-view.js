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
    showAbcNotation,
    abcjsRendered, setAbcjsRendered,
    currentAbcContent, setCurrentAbcContent,
    abcTempoBpm, setAbcTempoBpm,
    abcTranspose,
    abcScale, setAbcScale, ABC_SCALE_MIN, ABC_SCALE_MAX,
    abcSynth, setAbcSynth,
    abcTimingCallbacks, setAbcTimingCallbacks,
    abcIsPlaying, setAbcIsPlaying,
    abcPlaybackSession, incrementAbcPlaybackSession,
    // The chord chart's layout (Display ▸ Chart) and where it sits
    chartCells, chartBars, chartOrder, chartBeside,
    // Navigation state
    listContext, setListContext,
    allSongs
} from './state.js';
import { escapeHtml, safeUrl, parseItemRef } from './utils.js';
import { prefetchSongContent, getChordChart } from './song-content.js';
import {
    extractChords, detectKey,
    CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS, normalizeKeyForMode
} from './chords.js';
import { parseChordPro, renderSectionsHtml } from './renderers/chordpro.js';
import { getSongMetadata, updateSongMetadata } from './lists.js';
import { endSongView } from './analytics.js';
import { setBottomBand } from './shell.js';
import { sizeControl, tempoControl, readingDock } from './song-dock.js';
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

// Where the song page has room for the chord chart beside the lyrics (G18b2).
// Wider: two columns on the lead sheet. Narrower: a "Chart" part tab. The CSS
// (`.cc-cols`, `.part-tab[data-part-type="chord-chart"]`) mirrors this width.
export const CHART_WIDE_WIDTH = 800;
export const CHART_WIDE_MQ = `(min-width: ${CHART_WIDE_WIDTH}px)`;
export function chartIsWide() {
    return typeof window !== 'undefined' && !!window.matchMedia?.(CHART_WIDE_MQ).matches;
}

// The dock (G19b). work-view.js knows the song's parts and versions, so it
// supplies the controls that need them, and this module asks for the dock
// each time it renders a part:
//   reading({hybrid})  the lyric sheet's and the chart's dock, in full
//   view({hybrid})     just the View control (the ABC dock's last piece)
let dockProvider = null;
export function setDockProvider(provider) { dockProvider = provider; }

// ChordPro parsing/section rendering lives in the shared renderer module.
// Re-exported so existing importers (tests, work-view) keep working.
export { parseChordPro };

/**
 * Detect wrapped chord-lyrics lines and add a visual indicator.
 * A line is "wrapped" if its rendered height exceeds a single chord+lyrics pair.
 * Exported for tests.
 */
export function markWrappedLines() {
    const lines = document.querySelectorAll('.cl-line');
    // Every layout READ first, then every class WRITE. Toggling a class
    // between two measurements invalidates layout, so the old read-write-
    // read-write loop forced a full reflow per line (hundreds per chart).
    const wrapped = [];
    for (const line of lines) {
        // A single unwrapped line has one chord row + one lyrics row.
        // If the element is taller, it wrapped.
        const firstSeg = line.querySelector('.cl-segment');
        if (!firstSeg) continue;
        const singleLineHeight = firstSeg.offsetHeight;
        wrapped.push([line, line.scrollHeight > singleLineHeight + 2]);
    }
    for (const [line, isWrapped] of wrapped) {
        line.classList.toggle('wrapped', isWrapped);
    }
}

const ABCJS_URL = 'https://cdn.jsdelivr.net/npm/abcjs@6/dist/abcjs-basic-min.js';
let abcjsPromise = null;

/**
 * Load abcjs on demand (only ~160 songs use ABC notation, and the library is
 * ~500 KB). One cached promise: concurrent and repeat callers share a single
 * script tag. A failed load clears the cache so the next call can retry.
 * Resolves to the ABCJS global, or null if it could not be loaded.
 */
export function loadAbcjs() {
    if (typeof ABCJS !== 'undefined') return Promise.resolve(ABCJS);
    if (abcjsPromise) return abcjsPromise;
    abcjsPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = ABCJS_URL;
        script.async = true;
        script.onload = () => {
            if (typeof ABCJS === 'undefined') abcjsPromise = null;
            resolve(typeof ABCJS === 'undefined' ? null : ABCJS);
        };
        script.onerror = () => {
            abcjsPromise = null;
            script.remove();
            resolve(null);
        };
        document.head.appendChild(script);
    });
    return abcjsPromise;
}

/**
 * Render ABC notation using ABCJS library (loaded on demand).
 * Returns a promise so callers can run follow-up setup once it has rendered.
 */
async function renderAbcNotation(abcContent, containerId) {
    if (!document.getElementById(containerId)) {
        console.warn('ABC container not found:', containerId);
        return;
    }

    // Store content for re-rendering when settings change
    setCurrentAbcContent(abcContent);

    await loadAbcjs();

    // The view may have changed while the library was loading
    const container = document.getElementById(containerId);
    if (!container) return;

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
                // Stored spellings vary ("D#", "D#/Eb", "A"); map to the key
                // list for this song's mode (minor songs get "Am" etc.)
                const overrideKey = normalizeKeyForMode(songMetadata.key, detectedMode);
                if (overrideKey) setCurrentDetectedKey(overrideKey);
            }
        }
    }

    // Ensure currentDetectedKey is valid for the available chromatic keys
    const availableKeys = originalDetectedMode === 'minor' ? CHROMATIC_MINOR_KEYS : CHROMATIC_MAJOR_KEYS;
    if (!availableKeys.includes(currentDetectedKey)) {
        setCurrentDetectedKey(originalDetectedKey || detectedKey || availableKeys[0]);
    }
}

/** Display ▸ Chart's choices, as the chart view takes them. */
function chartLayout() {
    return { cells: chartCells, bars: chartBars, order: chartOrder };
}

/** The display options every lyric-chart draw uses (renderSectionsHtml's `opts`). */
function lyricRenderOpts() {
    return {
        key: originalDetectedKey,
        transposeTo: currentDetectedKey,
        nashville: nashvilleMode,
        chordMode: chordDisplayMode,
        compact: compactMode,
        sectionLabels: showSectionLabels,
        twoColumn: twoColumnMode
    };
}

/**
 * Draw the work's chord chart into `container` once the lazy view and the
 * chart JSON are in (`draw(view, ctx)`). A draw that was superseded while it
 * loaded (key change, another part, another song) is dropped. A chart that
 * fails to load leaves the page exactly as it was.
 */
let chartDrawSeq = 0;
function drawChordChart(container, song, ctx, draw, onMissing = null) {
    const token = String(++chartDrawSeq);
    container.dataset.chartDraw = token;
    const current = () => container.isConnected && container.dataset.chartDraw === token;
    Promise.all([import('./chord-chart-view.js'), getChordChart(song)]).then(([view, chart]) => {
        if (!current()) return;
        if (chart) draw(view, { ...ctx, chart });
        else onMissing?.();
    }).catch(err => {
        console.warn('chord chart:', err);
        if (current()) onMissing?.();
    });
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
    // What this draw used, so work-view's key subscriber can tell a real
    // transpose (key differs from the drawn one) from a late echo of the
    // write this very render just made.
    container.dataset.renderedKey = String(currentDetectedKey ?? '');

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

    const lyricOpts = lyricRenderOpts();
    const sectionsHtml = renderSectionsHtml(chordSections, lyricOpts);

    const showAbcView = hasAbc && (!hasChords || showAbcNotation);

    const abcViewHtml = hasAbc ? `
        <div id="abc-view" class="abc-view ${showAbcView ? '' : 'hidden'}">
            <div id="abc-notation" class="abc-notation"></div>
        </div>
    ` : '';

    const chordViewClass = showAbcView || !hasChords ? 'hidden' : '';

    // Source attribution for bottom of page
    // Link to classic-country home page (individual pages are often broken)
    // For bluegrass-lyrics, use the x_lyrics_url from ChordPro metadata
    // web-chords charts each came from a different site, so the per-song
    // x_source_url is the only meaningful link.
    const sourceUrl = song?.source === 'classic-country'
        ? 'https://www.classic-country-song-lyrics.com/'
        : (song?.source === 'bluegrass-lyrics' && metadata.x_lyrics_url)
            ? metadata.x_lyrics_url
            : (song?.source === 'web-chords' && metadata.x_source_url)
                ? metadata.x_source_url
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
        'bluegrass-lyrics': 'BluegrassLyrics.com',
        'web-chords': 'Original chord chart'
    };
    // Every URL below is submitter data — x_lyrics_url / x_source_url come
    // straight out of the work's ChordPro metadata, book_url and
    // tunearch_url off the index row. safeUrl drops anything that isn't
    // http(s); a dropped link falls through to the plain-text source name.
    const sourceHref = safeUrl(sourceUrl);
    const bookHref = safeUrl(bookUrl);
    const tunearchHref = safeUrl(song?.tunearch_url);

    let sourceHtml = '';
    if (sourceHref) {
        const sourceName = sourceDisplayNames[song?.source] || 'Source';
        sourceHtml = `<div class="song-source"><span class="source-label">Source:</span> <a href="${sourceHref}" target="_blank" rel="noopener">${escapeHtml(sourceName)}</a></div>`;
    } else if (song?.source === 'golden-standard' && bookHref) {
        const bookName = bookDisplay || 'Golden Standards Collection';
        sourceHtml = `<div class="song-source"><span class="source-label">Source:</span> <a href="${bookHref}" target="_blank" rel="noopener">${escapeHtml(bookName)}</a></div>`;
    } else if (tunearchHref) {
        sourceHtml = `<div class="song-source"><span class="source-label">Source:</span> <a href="${tunearchHref}" target="_blank" rel="noopener">TuneArch.org</a></div>`;
    } else if (song?.source && sourceDisplayNames[song.source]) {
        sourceHtml = `<div class="song-source"><span class="source-label">Source:</span> ${sourceDisplayNames[song.source]}</div>`;
    }

    container.innerHTML = `
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
        <p class="song-edit-nudge"><b>See something wrong? Use <span aria-hidden="true">✏️</span> Edit at the top.</b><br>Every fix makes the book better.</p>
    `;

    // Bottom band: the notation's dock when the notation is up, else the
    // reading dock (Key, Size, View, Display)
    const dockCtx = { hybrid: hasAbc && hasChords };
    if (showAbcView) {
        setBottomBand(buildAbcBandControls(dockProvider?.view({ ...dockCtx, abcShown: true })));
        setTimeout(() => {
            renderAbcNotation(abcContent, 'abc-notation').then(setupAbcPlayback);
        }, 0);
    } else {
        stopAbcPlayback();
        setBottomBand(dockProvider?.reading({ ...dockCtx, abcShown: false }) ?? null);
    }

    // Mark wrapped chord-lyrics lines for visual indicator
    markWrappedLines();

    // The chord chart (G18b): the second column, when the reader chose
    // Lyrics + Chart and there is room for it
    if (song?.chord_chart && hasChords && !showAbcView && chartBeside && chartIsWide()) {
        drawChordChart(container, song,
            { sections: chordSections, opts: lyricOpts, fontScale: FONT_SIZES[fontSizeLevel], layout: chartLayout() },
            (view, ctx) => {
                view.mountLeadSheetChart(container, ctx);
                markWrappedLines();   // the lyrics now have a column's width
            });
    }
}

/**
 * The Chart part (View ▸ Chart): the chord chart alone. Stamps renderedKey
 * like the lead sheet so work-view's key subscriber can tell a real transpose
 * from an echo.
 */
export function renderChartTabContent(container, song, chordpro, isInitialRender = false) {
    if (!container) return;
    const { sections } = parseChordPro(chordpro);
    initKeyState(song, chordpro, isInitialRender);
    container.dataset.renderedKey = String(currentDetectedKey ?? '');
    stopAbcPlayback();
    setBottomBand(dockProvider?.reading({ hybrid: false, abcShown: false }) ?? null);
    container.innerHTML = '<div class="part-loading">Loading chart\u2026</div>';
    drawChordChart(container, song,
        { sections: sections.filter(s => s.type !== 'abc'), opts: lyricRenderOpts(), fontScale: FONT_SIZES[fontSizeLevel], layout: chartLayout() },
        (view, ctx) => view.renderChartTab(container, ctx),
        () => { container.innerHTML = '<div class="part-error"><p>Couldn\'t load this chart.</p></div>'; });
}

/**
 * The ABC dock: ▶ · tempo · Size · View. There is no Key and no Display, because
 * neither applies to notation. setupAbcPlayback() finds #abc-play-btn by id
 * once the band is mounted.
 */
function buildAbcBandControls(viewEl) {
    const tempo = tempoControl({
        n: abcTempoBpm,
        display: { id: 'abc-tempo-label' },
        down: { id: 'abc-speed-decrease' },
        up: { id: 'abc-speed-increase' },
    });
    const play = document.createElement('button');
    play.type = 'button';
    play.id = 'abc-play-btn';
    play.className = 'dock-play';
    play.title = 'Play/Pause';
    play.setAttribute('aria-label', 'Play');
    play.textContent = '▶';

    // Size re-renders the notation at the new scale, and is remembered on its own
    const size = sizeControl({
        id: 'abc-size',
        canStep: (dir) => (dir < 0 ? abcScale > ABC_SCALE_MIN + 0.01 : abcScale < ABC_SCALE_MAX - 0.01),
        step: (dir) => {
            setAbcScale(Math.round((abcScale + dir * 0.1) * 10) / 10);
            if (currentAbcContent) {
                renderAbcNotation(currentAbcContent, 'abc-notation').then(setupAbcPlayback);
            }
        },
    });

    // Tempo only affects the next playback start
    const speedDecrease = tempo.querySelector('#abc-speed-decrease');
    const speedIncrease = tempo.querySelector('#abc-speed-increase');
    const tempoLabel = tempo.querySelector('#abc-tempo-label');
    const applyTempo = (bpm) => {
        setAbcTempoBpm(Math.max(60, Math.min(240, bpm)));
        tempoLabel.textContent = abcTempoBpm;
        speedDecrease.disabled = abcTempoBpm <= 60;
        speedIncrease.disabled = abcTempoBpm >= 240;
    };
    speedDecrease.addEventListener('click', () => applyTempo(abcTempoBpm - 10));
    speedIncrease.addEventListener('click', () => applyTempo(abcTempoBpm + 10));
    applyTempo(abcTempoBpm);

    const dock = readingDock(play, tempo, size, viewEl);
    dock.classList.add('abc-dock');
    return dock;
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

        // List context: the nav bar is the prev/next surface
        navBarEl.classList.remove('hidden');
        navBarEl.classList.add('has-list-context');

        // The next song is the likeliest next tap: have its chart in memory
        // by the time the reader gets there.
        prefetchNextInList(listContext);
    } else {
        // No list context: no nav bar
        navBarEl.classList.remove('has-list-context');
        navBarEl.classList.add('hidden');
        // Clear the content so it doesn't show stale data
        if (navPositionEl) navPositionEl.textContent = '';
        if (navListNameEl) navListNameEl.textContent = '';
    }

    // Keep the body-level list-context flag in sync
    updateListContextClass();
}

/**
 * Warm the ChordPro of the song after the current one in a list. A
 * part-qualified item ("work/banjo") may open a tab instead of the lead
 * sheet, so it is left alone. Exported for tests.
 */
export function prefetchNextInList(context) {
    const next = context?.songIds?.[context.currentIndex + 1];
    if (!next) return;
    const { workId, partId } = parseItemRef(next);
    if (partId) return;
    prefetchSongContent(allSongs.find(s => s.id === workId));
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
